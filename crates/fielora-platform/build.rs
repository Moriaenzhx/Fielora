fn main() {
    println!("cargo:rerun-if-changed=src/computer_preview_macos.m");
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        cc::Build::new()
            .file("src/computer_preview_macos.m")
            .flag("-fobjc-arc")
            .flag("-fblocks")
            .warnings(true)
            .compile("fielora_computer_preview");
        println!("cargo:rustc-link-lib=framework=AppKit");
        println!("cargo:rustc-link-lib=framework=ImageIO");
    }
}
