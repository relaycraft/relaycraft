use crate::logging;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

use super::EngineInner;

pub(super) fn spawn_crash_watcher(inner: Arc<EngineInner>, app: AppHandle) {
    std::thread::Builder::new()
        .name("rc-crash-watcher".into())
        .spawn(move || {
            loop {
                thread::sleep(Duration::from_secs(2));
                let mut lock = match inner.child.lock() {
                    Ok(l) => l,
                    Err(_) => break,
                };

                if let Some(mut child) = lock.take() {
                    match child.try_wait() {
                        Ok(Some(status)) => {
                            // Process exited
                            if !inner.is_stopping.load(Ordering::SeqCst) {
                                let msg = format!(
                                    "Proxy engine (PID {}) exited unexpectedly with status: {}. Check engine.log for details.",
                                    child.id(),
                                    status
                                );
                                log::error!("{}", msg);
                                logging::write_domain_log("crash", &msg).ok();
                                // Notify the frontend so the UI can surface the crash.
                                let _ = app.emit("proxy-engine-crashed", &msg);
                            }
                            // Clean up
                            if let Ok(mut active) = inner.active_scripts.lock() {
                                active.clear();
                            }
                            break;
                        }
                        Ok(None) => {
                            // Still running, put it back
                            *lock = Some(child);
                        }
                        Err(e) => {
                            let msg = format!("Error watching proxy process: {}", e);
                            logging::write_domain_log("crash", &msg).ok();
                            break;
                        }
                    }
                } else {
                    // No child to watch
                    break;
                }
            }
        })
        .ok();
}
