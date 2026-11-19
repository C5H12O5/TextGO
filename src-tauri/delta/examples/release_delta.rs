//! Called by scripts/release_delta.py on each native release runner.
use sha2::{Digest, Sha256};
use std::{
    env, fs,
    io::{self, Write},
    path::Path,
};
use textgo_delta::{open_envelope, restore, verify_release, MAX_FILE, MAX_PATCH};

fn create(
    platform: &str,
    base: &[u8],
    normalized: &[u8],
    full: &[u8],
) -> io::Result<Option<Vec<u8>>> {
    if [base.len(), normalized.len(), full.len()]
        .into_iter()
        .any(|size| size == 0 || size > MAX_FILE)
    {
        return Err(io::Error::other("unsupported release size"));
    }
    let mut header = b"TGDELTA1".to_vec();
    header.extend(Sha256::digest(base));
    header.extend(Sha256::digest(full));
    header.extend((normalized.len() as u32).to_le_bytes());
    header.extend((full.len() as u32).to_le_bytes());
    // --patch-from treats the entire old executable as a reference prefix.
    let mut encoder = zstd::stream::Encoder::with_ref_prefix(header, 10, base)?;
    encoder.window_log(27)?;
    encoder.long_distance_matching(true)?;
    encoder.set_pledged_src_size(Some(normalized.len() as u64))?;
    encoder.write_all(normalized)?;
    let patch = encoder.finish()?;
    if patch.len() + 2048 >= full.len() || patch.len() > MAX_PATCH {
        println!("Full update is preferable for this release pair");
        return Ok(None);
    }
    if restore(base, &patch, platform)? != full {
        return Err(io::Error::other("round-trip verification failed"));
    }
    println!(
        "Verified delta: {} bytes / {} full",
        patch.len(),
        full.len()
    );
    Ok(Some(patch))
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<_> = env::args().skip(1).collect();
    match args
        .iter()
        .map(String::as_str)
        .collect::<Vec<_>>()
        .as_slice()
    {
        ["verify", artifact, signature, version, key] => {
            verify_release(
                key,
                fs::read_to_string(signature)?.trim().as_bytes(),
                &fs::read(artifact)?,
                version,
            )?;
        }
        ["create", platform, base, normalized, full, output] => {
            if let Some(patch) = create(
                platform,
                &fs::read(base)?,
                &fs::read(normalized)?,
                &fs::read(full)?,
            )? {
                fs::write(output, patch)?;
            }
        }
        ["seal", patch, signature, version, key, output] => {
            let mut bytes = fs::read_to_string(signature)?.trim().as_bytes().to_vec();
            bytes.push(b'\n');
            bytes.extend(fs::read(patch)?);
            open_envelope(&bytes, key, version)?;
            fs::write(Path::new(output), bytes)?;
        }
        _ => return Err("expected verify, create or seal with release arguments".into()),
    }
    Ok(())
}
