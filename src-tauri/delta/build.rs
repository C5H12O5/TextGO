fn main() {
    let windows = std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows");
    if !windows && std::env::var_os("CARGO_FEATURE_NSIS").is_none() {
        return;
    }
    let root = std::path::Path::new("vendor/nsis");
    let mut build = cc::Build::new();
    build
        .cpp(true)
        .opt_level(2)
        .warnings(false)
        .include(root)
        .define("COMPRESS_MF_BT", None)
        .define("COMPRESS_MF_BT4", None)
        .flag_if_supported("/EHsc")
        .file("src/nsis.cpp");
    for file in [
        "clzma.cpp",
        "7zip/7zGuids.cpp",
        "7zip/7zip/Common/OutBuffer.cpp",
        "7zip/7zip/Common/StreamUtils.cpp",
        "7zip/7zip/Compress/LZ/LZInWindow.cpp",
        "7zip/7zip/Compress/LZMA/LZMAEncoder.cpp",
        "7zip/7zip/Compress/RangeCoder/RangeCoderBit.cpp",
        "7zip/Common/Alloc.cpp",
        "7zip/Common/CRC.cpp",
    ] {
        build.file(root.join(file));
    }
    println!("cargo:rerun-if-changed=vendor/nsis");
    println!("cargo:rerun-if-changed=src/nsis.cpp");
    build.compile("textgo_nsis_lzma");
}
