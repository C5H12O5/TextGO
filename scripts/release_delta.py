"""Build a signed, round-trip-verified patch for the previous public release."""
import argparse
import gzip
import json
import lzma
import os
from pathlib import Path
import re
import shutil
import struct
import subprocess
import tarfile
import tempfile

ROOT = Path(__file__).resolve().parents[1]
CONFIG = ROOT / 'src-tauri' / 'tauri.conf.json'
REPO = os.environ.get('GITHUB_REPOSITORY', 'C5H12O5/TextGO')
PLATFORMS = {
    'darwin-aarch64': 'TextGO_aarch64.app.tar.gz',
    'darwin-x86_64': 'TextGO_x64.app.tar.gz',
    'windows-x86_64': 'TextGO_{version}_x64-setup.exe',
}


def run(*args, **kwargs):
    return subprocess.run(args, cwd=ROOT, check=True, **kwargs)


def previous_tag(target):
    releases = json.loads(run(
        'gh', 'release', 'list', '--repo', REPO, '--exclude-drafts', '--exclude-pre-releases',
        '--limit', '100', '--json', 'tagName', capture_output=True
    ).stdout)
    def version(tag):
        return tuple(map(int, tag[1:].split('.')))
    tags = [r['tagName'] for r in releases if re.fullmatch(r'v\d+\.\d+\.\d+', r['tagName'])]
    return max((t for t in tags if version(t) < version(target)), key=version, default=None)


def prepare_inputs(platform, old, new, base, normalized):
    if platform == 'darwin':
        with tarfile.open(old, 'r:gz') as archive, base.open('wb') as out:
            member = archive.getmember('TextGO.app/Contents/MacOS/TextGO')
            if not member.isfile():
                raise ValueError('missing installed executable')
            with archive.extractfile(member) as executable:
                shutil.copyfileobj(executable, out)
        with gzip.open(new, 'rb') as archive, normalized.open('wb') as out:
            shutil.copyfileobj(archive, out)
        return

    with base.open('wb') as out:
        run('7z', 'e', '-so', old, 'TextGO.exe', stdout=out)
    # Preserve the original PE stub, NSIS first header, CRC, and any signing trailer.
    installer = new.read_bytes()
    marker = bytes.fromhex('efbeadde') + b'NullsoftInst'
    header = installer.index(marker) - 4
    start = header + 28
    if header % 512 or installer[start:start + 5] != bytes.fromhex('5d00008000'):
        raise ValueError('unsupported NSIS compression format')
    codec = lzma.LZMADecompressor(lzma.FORMAT_RAW, filters=[
        dict(id=lzma.FILTER_LZMA1, dict_size=8 << 20, lc=3, lp=0, pb=2)
    ])
    payload = codec.decompress(installer[start + 5:], max_length=(192 << 20) + 1)
    if not codec.eof:
        raise ValueError('incomplete or oversized NSIS payload')
    with normalized.open('wb') as out:
        out.write(struct.pack('<II', start, len(codec.unused_data)))
        out.write(installer[:start])
        out.write(codec.unused_data)
        out.write(payload)


def publish(target, tag, folder):
    config = json.loads(CONFIG.read_text())
    if tag != 'v' + config['version'] or not re.fullmatch(r'v\d+\.\d+\.\d+', tag):
        raise ValueError('release tag must match tauri.conf.json')
    previous = previous_tag(tag)
    if previous is None:
        print('First public release; only the full update is needed.')
        return
    template = PLATFORMS[target]
    tool = ['cargo', 'run', '--quiet', '--locked', '--release', '--manifest-path',
            ROOT / 'src-tauri/Cargo.toml', '-p', 'textgo-delta', '--example', 'release_delta', '--']
    key = config['plugins']['updater']['pubkey']
    for release in (previous, tag):
        name = template.format(version=release[1:])
        run('gh', 'release', 'download', release, '--repo', REPO, '--dir', folder / release,
            '--pattern', name, '--pattern', name + '.sig')
        artifact = folder / release / name
        run(*tool, 'verify', artifact, str(artifact) + '.sig', release[1:], key)
    old = folder / previous / template.format(version=previous[1:])
    full = folder / tag / template.format(version=tag[1:])
    platform = target.split('-')[0]
    base, normalized = folder / 'base', folder / 'normalized'
    prepare_inputs(platform, old, full, base, normalized)
    payload = folder / 'payload'
    run(*tool, 'create', platform, base, normalized, full, payload)
    if not payload.exists():
        return
    # No private signing material is passed in argv. The CLI reads the CI signing environment.
    run(shutil.which('pnpm') or 'pnpm', 'exec', 'tauri', 'signer', 'sign', '--app-version', tag[1:], payload)
    asset = folder / f'TextGO-delta-v1-{target}-from-{previous[1:]}.patch'
    run(*tool, 'seal', payload, str(payload) + '.sig', tag[1:], key, asset)
    run('gh', 'release', 'upload', tag, asset, '--repo', REPO, '--clobber')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('platform', choices=PLATFORMS)
    parser.add_argument('tag')
    options = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix='textgo-release-delta-') as temp:
        publish(options.platform, options.tag, Path(temp))
