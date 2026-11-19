# Incremental updater artifacts

The release workflow creates one patch per platform and CPU for the previous public stable release. The client finds it beside the full artifact named in Tauri’s update manifest. Skipping a release, modifying the installed executable, or failing patch verification falls back to the full Tauri download. A client first acquires this capability by installing a build that contains it.

The patch uses the installed TextGO executable as a Zstandard reference prefix. On macOS the decoded bytes are the target tar archive. On Windows they contain the original installer prefix and trailer plus the uncompressed NSIS payload. The platform encoder reproduces the complete release artifact, including any original signing data. The runtime needs only the executable, the patch, and the public updater metadata.

The v1 asset starts with a Base64 Tauri signature and a newline. The signed payload contains `TGDELTA1`, the SHA-256 digests of the installed executable and target artifact, two little-endian 32-bit sizes (decoded data and final artifact), and a Zstandard frame. The client verifies the patch signature and signed target version before decoding. Tauri verifies the reconstructed artifact against the official release signature before installation.

The release job verifies the signatures and versions of both release artifacts before unpacking them. It checks byte-for-byte reconstruction before signing and uploading a patch. Keep the v1 compression recipes compatible with shipped clients. If a bundler changes its output, verify the codec against real release artifacts before changing it. A new incompatible recipe requires a new format and asset name.
