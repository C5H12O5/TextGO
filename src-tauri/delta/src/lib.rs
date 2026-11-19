//! Decode release patches against the installed executable. The caller authenticates
//! the patch before decoding and the complete updater artifact before installation.
use base64::{engine::general_purpose::STANDARD, Engine};
use minisign_verify::{PublicKey, Signature};
use sha2::{Digest, Sha256};
use std::io::{self, ErrorKind, Read};

pub const MAX_FILE: usize = 192 << 20;
pub const MAX_PATCH: usize = 64 << 20;
const MAGIC: &[u8; 8] = b"TGDELTA1";

fn invalid(message: &'static str) -> io::Error {
    io::Error::new(ErrorKind::InvalidData, message)
}

fn size(bytes: &[u8]) -> usize {
    u32::from_le_bytes(bytes.try_into().expect("four-byte size field")) as usize
}

/// Tauri's signer emits a Base64-wrapped Minisign signature with an authenticated version.
pub fn verify_release(key: &str, signature: &[u8], data: &[u8], version: &str) -> io::Result<()> {
    let decode = |bytes: &[u8]| {
        String::from_utf8(
            STANDARD
                .decode(bytes)
                .map_err(|_| invalid("invalid signature encoding"))?,
        )
        .map_err(|_| invalid("invalid signature text"))
    };
    let key =
        PublicKey::decode(&decode(key.as_bytes())?).map_err(|_| invalid("invalid updater key"))?;
    let sig =
        Signature::decode(&decode(signature)?).map_err(|_| invalid("invalid release signature"))?;
    key.verify(data, &sig, false)
        .map_err(|_| invalid("release signature verification failed"))?;
    if !sig
        .trusted_comment()
        .split('\t')
        .any(|field| field.strip_prefix("version:") == Some(version))
    {
        return Err(invalid(
            "delta signature does not match the announced version",
        ));
    }
    Ok(())
}

pub fn open_envelope<'a>(bytes: &'a [u8], key: &str, version: &str) -> io::Result<&'a [u8]> {
    let split = bytes
        .iter()
        .take(2048)
        .position(|&b| b == b'\n')
        .ok_or(invalid("missing delta signature"))?;
    let patch = &bytes[split + 1..];
    if patch.len() > MAX_PATCH {
        return Err(invalid("oversized delta"));
    }
    verify_release(key, &bytes[..split], patch, version)?;
    Ok(patch)
}

pub fn restore(base: &[u8], patch: &[u8], platform: &str) -> io::Result<Vec<u8>> {
    // magic, base SHA-256, artifact SHA-256, normalized size, artifact size, zstd frame
    if patch.len() <= 80 || patch.len() > MAX_PATCH || !patch.starts_with(MAGIC) {
        return Err(invalid("invalid delta header"));
    }
    if base.len() > MAX_FILE || Sha256::digest(base)[..] != patch[8..40] {
        return Err(invalid(
            "installed executable differs from the release base",
        ));
    }
    let normalized_size = size(&patch[72..76]);
    let artifact_size = size(&patch[76..80]);
    if !(1..=MAX_FILE).contains(&normalized_size) || !(1..=MAX_FILE).contains(&artifact_size) {
        return Err(invalid("invalid release size"));
    }
    let mut decoder = zstd::stream::read::Decoder::with_ref_prefix(&patch[80..], base)?;
    decoder.window_log_max(27)?;
    let mut data = vec![0; normalized_size];
    decoder.read_exact(&mut data)?;
    if decoder.read(&mut [0])? != 0 {
        return Err(invalid("unexpected data after delta output"));
    }
    drop(decoder);
    let artifact = match platform {
        #[cfg(target_os = "macos")]
        "darwin" => gzip_tar(&data, artifact_size)?,
        #[cfg(any(target_os = "windows", feature = "nsis"))]
        "windows" => nsis(&data, artifact_size)?,
        _ => return Err(invalid("unsupported release codec")),
    };
    if artifact.len() != artifact_size || Sha256::digest(&artifact)[..] != patch[40..72] {
        return Err(invalid(
            "reconstructed artifact digest differs from the release",
        ));
    }
    Ok(artifact)
}

#[cfg(target_os = "macos")]
fn gzip_tar(mut tar: &[u8], artifact_size: usize) -> io::Result<Vec<u8>> {
    use release_flate2::{write::GzEncoder, Compression};
    use std::io::Write;
    // The pinned encoder retries a zero-length write while writing its gzip trailer.
    // Report a full destination as an error even when only part of the trailer fits.
    struct Output<'a>(&'a mut [u8]);
    impl Write for Output<'_> {
        fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
            self.0.write_all(bytes)?;
            Ok(bytes.len())
        }
        fn flush(&mut self) -> io::Result<()> {
            Ok(())
        }
    }
    // Reproduce tar::Builder's writes into the release bundler's gzip encoder.
    // Compressing the exact same tar in differently sized writes changes DEFLATE bytes.
    let mut artifact = vec![0; artifact_size];
    let mut gzip = GzEncoder::new(Output(&mut artifact), Compression::default());
    while tar != [0; 1024] {
        let (header, rest) = tar
            .split_at_checked(512)
            .ok_or(invalid("short tar header"))?;
        let octal =
            std::str::from_utf8(&header[124..136]).map_err(|_| invalid("invalid tar size"))?;
        let len = usize::from_str_radix(octal.trim_matches(['\0', ' ']), 8)
            .map_err(|_| invalid("invalid tar size"))?;
        let (contents, rest) = rest
            .split_at_checked(len)
            .ok_or(invalid("short tar entry"))?;
        let (padding, rest) = rest
            .split_at_checked((512 - len % 512) % 512)
            .ok_or(invalid("short tar padding"))?;
        gzip.write_all(header)?;
        for chunk in contents.chunks(8192) {
            gzip.write_all(chunk)?;
        }
        gzip.write_all(padding)?;
        tar = rest;
    }
    gzip.write_all(tar)?;
    if !gzip.finish()?.0.is_empty() {
        return Err(invalid("unexpected gzip size"));
    }
    Ok(artifact)
}

#[cfg(any(target_os = "windows", feature = "nsis"))]
fn nsis(data: &[u8], artifact_size: usize) -> io::Result<Vec<u8>> {
    unsafe extern "C" {
        fn textgo_nsis_encode(
            input: *const u8,
            input_size: u32,
            output: *mut u8,
            output_size: u32,
        ) -> bool;
    }
    let header = data
        .get(..8)
        .ok_or(invalid("missing NSIS stream lengths"))?;
    let prefix_len = size(&header[..4]);
    let suffix_len = size(&header[4..]);
    let (prefix, rest) = data[8..]
        .split_at_checked(prefix_len)
        .ok_or(invalid("invalid NSIS prefix"))?;
    let (suffix, payload) = rest
        .split_at_checked(suffix_len)
        .ok_or(invalid("invalid NSIS suffix"))?;
    let stream_end = artifact_size
        .checked_sub(suffix_len)
        .ok_or(invalid("invalid NSIS size"))?;
    if prefix_len >= stream_end || payload.is_empty() {
        return Err(invalid("empty NSIS stream"));
    }
    let mut artifact = vec![0; artifact_size];
    artifact[..prefix_len].copy_from_slice(prefix);
    artifact[stream_end..].copy_from_slice(suffix);
    let stream = &mut artifact[prefix_len..stream_end];
    // Both slices live until the encoder returns and MAX_FILE bounds both lengths below u32::MAX.
    if !unsafe {
        textgo_nsis_encode(
            payload.as_ptr(),
            payload.len() as u32,
            stream.as_mut_ptr(),
            stream.len() as u32,
        )
    } {
        return Err(invalid("NSIS encoder could not reproduce this stream"));
    }
    Ok(artifact)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn check_reconstruction(platform: &str, normalized: &[u8], expected: &str) {
        let base = b"previous executable";
        let expected = STANDARD.decode(expected).unwrap();
        let mut header = MAGIC.to_vec();
        header.extend(Sha256::digest(base));
        header.extend(Sha256::digest(&expected));
        header.extend((normalized.len() as u32).to_le_bytes());
        header.extend((expected.len() as u32).to_le_bytes());
        let mut encoder = zstd::stream::Encoder::with_ref_prefix(header, 1, base).unwrap();
        encoder.write_all(normalized).unwrap();
        let mut patch = encoder.finish().unwrap();
        assert_eq!(restore(base, &patch, platform).unwrap(), expected);
        patch[40] ^= 1;
        assert!(restore(base, &patch, platform).is_err());
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn reconstructs_an_empty_tar_gz() {
        check_reconstruction(
            "darwin",
            &[0; 1024],
            "H4sIAAAAAAAA/2NgGAWjYBQwjFAAAC6vte8ABAAA",
        );
        assert!(gzip_tar(&[0; 1024], 29).is_err());
    }

    #[cfg(any(target_os = "windows", feature = "nsis"))]
    #[test]
    fn reconstructs_nsis_stream_with_original_prefix_and_trailer() {
        check_reconstruction(
            "windows",
            b"\x02\0\0\0\x03\0\0\0MZCRChello TextGO",
            "TVpdAACAAAA0GUnujekN+ZKQKRm6G8w1//8vvAAAQ1JD",
        );
    }

    #[test]
    fn authenticates_payload_and_version_before_decoding() {
        // Public material from a disposable test key, signed with the Tauri CLI.
        const KEY: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDc4MzU2NTA5OEJDNUVDOEMKUldTTTdNV0xDV1UxZUloQ3hrdDFBbjlZdEJJTXpUZUk2Vnh0R2U4ZFEyaWlBSE9UMTd5UENyaG4K";
        let mut envelope = b"dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIHRhdXJpIHNlY3JldCBrZXkKUlVTTTdNV0xDV1UxZUlNOHZOWTJjeFBXaWNMNHo1VkFORHFSOVp0N2RpS2hYVnZnNlNnZXZqbzYvdFhzbUQ2cEgyd1p0RlBQdlFtdkZUVmVDV0VmczRSK0RObXpDa3FMS1F3PQp0cnVzdGVkIGNvbW1lbnQ6IHRpbWVzdGFtcDoxNzk1MDczNTY4CWZpbGU6ZGVsdGEtdGVzdAl2ZXJzaW9uOjEuMi4zCjhRTXhmWDB5SVlsS3R5eEJIZUJPQ3o3eHErWmxkMkV1aXYrZmU3R05IRXRQRnBia3RoSUJyU1hqZlV3SEt0dTdWV1BNbnZod2lwbXd4T1RxV0ljWEFnPT0K\nTextGO delta fixture".to_vec();
        assert_eq!(
            open_envelope(&envelope, KEY, "1.2.3").unwrap(),
            b"TextGO delta fixture"
        );
        assert!(open_envelope(&envelope, KEY, "1.2.4").is_err());
        *envelope.last_mut().unwrap() ^= 1;
        assert!(open_envelope(&envelope, KEY, "1.2.3").is_err());
        assert!(open_envelope(&[], KEY, "1.2.3").is_err());
    }

    #[test]
    fn rejects_wrong_source_and_unbounded_output() {
        let mut patch = vec![0; 81];
        patch[..8].copy_from_slice(MAGIC);
        assert!(restore(b"old", &patch, "darwin")
            .unwrap_err()
            .to_string()
            .contains("base"));
        patch[8..40].copy_from_slice(&Sha256::digest(b"old"));
        patch[72..80].fill(255);
        assert!(restore(b"old", &patch, "darwin")
            .unwrap_err()
            .to_string()
            .contains("size"));
    }
}
