import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { createContext, runInContext } from 'node:vm';
import createDOMPurify from 'dompurify';
import ts from 'typescript';

const { parse } = createRequire(import.meta.url)('svelte/compiler');
const iconSource = readFileSync(new URL('../src/lib/components/Icon.svelte', import.meta.url), 'utf8');
// run the production module script without the unrelated Phosphor component imports
const moduleCode = parse(iconSource, { modern: true })
  .module.content.body.filter(
    (node) => node.type !== 'ImportDeclaration' && !(node.type === 'ExportNamedDeclaration' && node.source)
  )
  .map((node) => iconSource.slice(node.start, node.end))
  .join('\n');
const { outputText } = ts.transpileModule(moduleCode, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
});
const iconExports = {};
new Function('exports', 'createDOMPurify', outputText)(iconExports, createDOMPurify);
const { createCustomIconDataURL, MAX_ICON_BYTES, parseCustomIcon } = iconExports;

const png = readFileSync(new URL('../src-tauri/icons/32x32.png', import.meta.url));
const ico = readFileSync(new URL('../src-tauri/icons/icon.ico', import.meta.url));
// two-frame looping GIF with a red frame followed by a blue frame
const gif = Buffer.from(
  '47494638396102000100800000ff00000000ff21ff0b4e45545343415045322e300301000000' +
    '21f904000a0000002c0000000002000100000202040a00' +
    '21f904000a0000002c00000000020001000002024c0a003b',
  'hex'
);

for (const [format, bytes, mimeType] of [
  ['PNG', png, 'image/png'],
  ['ICO', ico, 'image/x-icon'],
  ['animated GIF', gif, 'image/gif']
]) {
  test(`${format} survives embedding and settings JSON round trips without changing bytes`, () => {
    const src = createCustomIconDataURL(bytes);
    assert.ok(src.startsWith(`data:${mimeType};base64,`));
    assert.deepEqual(Buffer.from(src.split(',')[1], 'base64'), bytes);
    const restored = JSON.parse(JSON.stringify({ icon: src }));
    assert.deepEqual(parseCustomIcon(restored.icon), { src, useTextColor: false });
  });
}

test('detects JPEG, WebP, BMP and both GIF versions from bytes, independently of file names', () => {
  for (const [header, mimeType] of [
    ['ffd8ffe0', 'image/jpeg'],
    ['52494646000000005745425056503820', 'image/webp'],
    ['424d', 'image/bmp'],
    ['474946383761', 'image/gif'],
    ['474946383961', 'image/gif']
  ]) {
    assert.ok(createCustomIconDataURL(Buffer.from(header, 'hex')).startsWith(`data:${mimeType};base64,`));
  }
});

test('rejects empty, unknown and unsupported image formats', () => {
  for (const bytes of [Buffer.alloc(0), Buffer.from('not an image'), Buffer.from('49492a00', 'hex')]) {
    assert.equal(createCustomIconDataURL(bytes), undefined);
  }
});

test('enforces the 128 KiB limit before encoding and after decoding saved icons', () => {
  assert.equal(MAX_ICON_BYTES, 128 * 1024);
  const bytes = Buffer.alloc(MAX_ICON_BYTES + 1);
  png.copy(bytes);
  const allowed = createCustomIconDataURL(bytes.subarray(0, MAX_ICON_BYTES));
  assert.ok(allowed);
  assert.ok(parseCustomIcon(allowed));
  assert.equal(createCustomIconDataURL(bytes), undefined);
  // this extra byte fits in the same padded base64 length, so decoded size must also be checked
  const oversized = `data:image/png;base64,${bytes.toString('base64')}`;
  assert.equal(allowed.length, oversized.length);
  assert.equal(parseCustomIcon(oversized), undefined);
  assert.equal(parseCustomIcon(`data:image/gif;base64,${'A'.repeat(MAX_ICON_BYTES * 2)}`), undefined);
});

test('rejects external URLs, malformed base64, disallowed MIME types and disguised SVG', () => {
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>').toString('base64');
  for (const source of [
    'https://example.com/icon.png',
    'file:///tmp/icon.png',
    'data:image/png;base64,',
    'data:image/png;base64,A',
    'data:image/png;base64,%%%%',
    `data:image/png;base64,${svg}`,
    `data:image/gif;base64,${png.toString('base64')}`,
    `data:text/html;base64,${svg}`,
    'data:image/svg+xml,<svg onload="alert(1)"/>',
    `${createCustomIconDataURL(png)}");background:url(https://example.com)`
  ]) {
    assert.equal(parseCustomIcon(source), undefined, source.slice(0, 80));
  }
});

// exercise the actual upload handler with only filesystem, dialog and image decoding APIs stubbed
const selector = readFileSync(new URL('../src/lib/components/IconSelector.svelte', import.meta.url), 'utf8');
const functions = parse(selector, { modern: true }).instance.content.body;
const uploadCode = ['handleImageUpload', 'cancelUpload']
  .map((name) => {
    const fn = functions.find((node) => node.type === 'FunctionDeclaration' && node.id.name === name);
    return selector.slice(fn.start, fn.end);
  })
  .join('\n');

/**
 * Create an upload handler fixture with stubbed filesystem and image decoding APIs.
 *
 * @param options - uploaded file size and image decoding behavior
 * @returns upload handler, captured alerts and file read count
 */
function uploadFixture({ size = png.length, decode = async () => {} } = {}) {
  const alerts = [];
  let reads = 0;
  const context = createContext({
    open: async () => '/selected/icon.png',
    stat: async () => ({ isFile: true, size }),
    readFile: async () => {
      reads++;
      return png;
    },
    createCustomIconDataURL,
    MAX_ICON_BYTES,
    ICON_EXTENSIONS: [],
    Image: class {
      decode = decode;
    },
    alert: (value) => alerts.push(value.message),
    m: {
      custom_image: () => 'Custom image',
      image_file_invalid: () => 'Invalid image',
      image_read_failed: () => 'Read failed'
    },
    console
  });
  const uploader = runInContext(
    `let icon = 'Star'; let uploading = false; let uploadRequest = 0;
     ${uploadCode}
     ({ upload: handleImageUpload, cancel: cancelUpload,
        get icon() { return icon; }, get uploading() { return uploading; } })`,
    context
  );
  return {
    uploader,
    alerts,
    get reads() {
      return reads;
    }
  };
}

test('oversized uploads are rejected before reading the file and preserve the existing icon', async () => {
  const f = uploadFixture({ size: MAX_ICON_BYTES + 1 });
  await f.uploader.upload();
  assert.equal(f.reads, 0);
  assert.equal(f.uploader.icon, 'Star');
  assert.deepEqual(f.alerts, ['Invalid image']);
  assert.equal(f.uploader.uploading, false);
});

test('decode failures keep the existing icon and restore upload controls', async () => {
  const f = uploadFixture({
    decode: async () => {
      throw new Error('Corrupt image');
    }
  });
  await f.uploader.upload();
  assert.equal(f.uploader.icon, 'Star');
  assert.deepEqual(f.alerts, ['Invalid image']);
  assert.equal(f.uploader.uploading, false);
});

test('closing the selector prevents a pending decode from replacing the icon', async () => {
  let finishDecode;
  let startDecode;
  const started = new Promise((resolve) => {
    startDecode = resolve;
  });
  const pending = new Promise((resolve) => {
    finishDecode = resolve;
  });
  const f = uploadFixture({
    decode: () => {
      startDecode();
      return pending;
    }
  });
  const upload = f.uploader.upload();
  await started;
  assert.equal(f.uploader.uploading, true);
  f.uploader.cancel();
  finishDecode();
  await upload;
  assert.equal(f.uploader.icon, 'Star');
  assert.equal(f.uploader.uploading, false);
  assert.deepEqual(f.alerts, []);
});

test('a successfully decoded image becomes the selected icon', async () => {
  const f = uploadFixture();
  await f.uploader.upload();
  assert.equal(f.uploader.icon, createCustomIconDataURL(png));
  assert.equal(f.uploader.uploading, false);
  assert.deepEqual(f.alerts, []);
});
