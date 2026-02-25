fn main() {
    println!(
        "cargo:rustc-env=BUILD_DATE={}",
        chrono::Local::now().format("%Y-%m-%d %H:%M:%S")
    );
    tauri_build::build()
}
