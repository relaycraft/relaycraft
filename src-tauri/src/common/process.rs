use std::path::Path;

/// Kill running processes whose executable path exactly matches `engine_path`.
///
/// This is the fallback cleanup for engine sidecars left behind by crashed
/// sessions (they share our install path). Name-based matching
/// (`pkill -f engine`, `taskkill /IM engine.exe`) is deliberately NOT used:
/// it would kill any third-party process that happens to have "engine" in
/// its command line or image name.
pub fn kill_engine_processes_by_path(engine_path: &Path) {
    let target = normalize_exe_path(engine_path);
    let mut sys = sysinfo::System::new();
    sys.refresh_processes(sysinfo::ProcessesToUpdate::All, true);
    for process in sys.processes().values() {
        let Some(exe) = process.exe() else {
            continue;
        };
        if normalize_exe_path(exe) == target {
            log::info!(
                "Killing leftover engine process (pid {}) at {:?}",
                process.pid(),
                exe
            );
            let _ = process.kill();
        }
    }
}

/// Canonicalize and normalize for comparison: strip Windows verbatim
/// prefixes (`\\?\`) and compare case-insensitively (NTFS/APFS defaults).
fn normalize_exe_path(path: &Path) -> String {
    let canonical = std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    canonical
        .to_string_lossy()
        .trim_start_matches(r"\\?\")
        .to_lowercase()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_strips_verbatim_prefix_and_case() {
        let p = normalize_exe_path(Path::new(r"\\?\C:\Apps\RelayCraft\Engine.EXE"));
        assert_eq!(p, r"c:\apps\relaycraft\engine.exe");
    }

    #[test]
    fn normalize_is_case_insensitive() {
        assert_eq!(
            normalize_exe_path(Path::new("/nonexistent-a/relaycraft/engine")),
            normalize_exe_path(Path::new("/nonexistent-a/RelayCraft/Engine"))
        );
    }
}
