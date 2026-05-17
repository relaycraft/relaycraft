#[cfg(target_os = "windows")]
pub fn kill_processes_by_image_names(targets: &[&str]) {
    use std::os::windows::process::CommandExt;
    use std::process::Command;

    const CREATE_NO_WINDOW: u32 = 0x08000000;

    for target in targets {
        let _ = Command::new("taskkill")
            .args(["/F", "/IM", target])
            .creation_flags(CREATE_NO_WINDOW)
            .output();
    }
}

#[cfg(target_os = "windows")]
pub fn kill_known_engine_processes() {
    kill_processes_by_image_names(&[
        "engine.exe",
        "engine-x86_64-pc-windows-msvc.exe",
        "mitmdump.exe",
    ]);
}
