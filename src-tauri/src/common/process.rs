use std::path::Path;

/// Kill running processes whose executable path exactly matches `engine_path`,
/// plus their descendants. Name-based matching (`pkill -f engine`) is
/// deliberately NOT used.
pub fn kill_engine_processes_by_path(engine_path: &Path) {
    let target = normalize_exe_path(engine_path);
    let mut sys = sysinfo::System::new();
    sys.refresh_processes(sysinfo::ProcessesToUpdate::All, true);

    let mut matched: Vec<sysinfo::Pid> = Vec::new();
    for process in sys.processes().values() {
        let Some(exe) = process.exe() else {
            continue;
        };
        if normalize_exe_path(exe) == target {
            matched.push(process.pid());
        }
    }

    let mut to_kill = matched.clone();
    for root in &matched {
        collect_descendants(&sys, *root, &mut to_kill);
    }

    for pid in to_kill {
        log::info!("Killing leftover engine process (pid {pid})");
        terminate_pid(pid.as_u32());
    }
}

/// Collect child processes of `root` into `out` (BFS, no duplicates).
fn collect_descendants(sys: &sysinfo::System, root: sysinfo::Pid, out: &mut Vec<sysinfo::Pid>) {
    let mut queue = vec![root];
    while let Some(parent_pid) = queue.pop() {
        for (pid, process) in sys.processes() {
            if process.parent() == Some(parent_pid) && !out.contains(pid) {
                out.push(*pid);
                queue.push(*pid);
            }
        }
    }
}

/// Kill `pid`. On Unix, if it is a process-group leader (typical after
/// `setsid` at spawn), kill the whole group. On Windows, `taskkill /T`
/// tears down the tree.
pub fn terminate_pid(pid: u32) {
    #[cfg(unix)]
    {
        terminate_unix_pid(pid);
    }
    #[cfg(windows)]
    {
        let mut cmd = std::process::Command::new("taskkill");
        cmd.args(["/F", "/T", "/PID", &pid.to_string()]);
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }
        let _ = cmd.output();
    }
    #[cfg(not(any(unix, windows)))]
    {
        let _ = pid;
    }
}

#[cfg(unix)]
fn terminate_unix_pid(pid: u32) {
    let raw = pid as i32;
    if raw <= 0 {
        return;
    }
    unsafe {
        let pgid = libc::getpgid(raw);
        // Only killpg when the pid is the group leader. Otherwise killpg
        // would signal the inherited parent group (e.g. the app itself).
        if pgid == raw {
            let _ = libc::killpg(pgid, libc::SIGKILL);
        } else {
            let _ = libc::kill(raw, libc::SIGKILL);
        }
    }
}

/// Put the child in its own session so later `killpg` cannot hit RelayCraft.
#[cfg(unix)]
pub fn detach_child_session(cmd: &mut std::process::Command) {
    use std::os::unix::process::CommandExt;
    unsafe {
        cmd.pre_exec(|| {
            if libc::setsid() == -1 {
                return Err(std::io::Error::last_os_error());
            }
            Ok(())
        });
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

    #[cfg(unix)]
    #[test]
    fn current_process_has_a_pgid() {
        let pid = std::process::id() as i32;
        let pgid = unsafe { libc::getpgid(pid) };
        assert!(pgid > 0);
    }
}
