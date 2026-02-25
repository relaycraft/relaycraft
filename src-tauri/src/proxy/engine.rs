use crate::common::error::AppError;
use crate::config::AppConfig;
use crate::logging;
use crate::proxy::paths::get_engine_path;
use crate::scripts::storage::ScriptStorage;
use std::path::PathBuf;
use std::process::{Child, Command as StdCommand, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Manager};

/// Summary of proxy status
pub struct ProxyStatus {
    pub running: bool,
    pub active: bool, // Whether traffic is being processed
    pub active_scripts: Vec<String>,
}

pub struct EngineStats {
    pub memory_usage: u64,
    pub cpu_usage: f32,
    pub up_time: u64,
    #[allow(dead_code)]
    pub rx_speed: u64,
    #[allow(dead_code)]
    pub tx_speed: u64,
}

/// Abstract trait for a proxy engine
pub trait ProxyEngine: Send + Sync {
    fn start(&self, app: &AppHandle, config: &AppConfig) -> Result<(), AppError>;
    fn stop(&self) -> Result<(), AppError>;
    fn terminate(&self) -> Result<(), AppError>;
    fn get_status(&self) -> ProxyStatus;
    fn get_stats(&self, system: &mut sysinfo::System) -> Result<EngineStats, AppError>;
    fn set_active(&self, active: bool) -> Result<(), AppError>;
}

struct EngineInner {
    pub child: Mutex<Option<Child>>,
    pub active_scripts: Mutex<Vec<String>>,
    pub last_port: Mutex<Option<u16>>,
    pub is_stopping: AtomicBool,
    pub cached_pids: Mutex<Vec<sysinfo::Pid>>,
    pub last_pid_refresh: Mutex<std::time::Instant>,
    /// Traffic processing state
    pub traffic_active: AtomicBool,
}

/// Mitmproxy-based engine implementation
pub struct MitmproxyEngine {
    inner: Arc<EngineInner>,
}

impl MitmproxyEngine {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(EngineInner {
                child: Mutex::new(None),
                active_scripts: Mutex::new(Vec::new()),
                last_port: Mutex::new(None),
                is_stopping: AtomicBool::new(false),
                cached_pids: Mutex::new(Vec::new()),
                last_pid_refresh: Mutex::new(
                    std::time::Instant::now() - std::time::Duration::from_secs(60),
                ),
                traffic_active: AtomicBool::new(false),
            }),
        }
    }
}

impl ProxyEngine for MitmproxyEngine {
    fn start(&self, app: &AppHandle, config: &AppConfig) -> Result<(), AppError> {
        let mut child_lock = self
            .inner
            .child
            .lock()
            .map_err(|_| AppError::Config("Lock poisoned".into()))?;

        // Check if already running
        if let Some(child) = child_lock.as_mut() {
            if child.try_wait()?.is_none() {
                return Err(AppError::Config("Proxy is already running".into()));
            }
        }

        let engine_path = get_engine_path(app).map_err(AppError::Config)?;
        if !engine_path.exists() {
            return Err(AppError::NotFound(format!(
                "Engine not found: {:?}",
                engine_path
            )));
        }

        // Get addon files
        let addon_file = self.get_addon_path(app)?;
        let rules_dir = crate::rules::get_rules_dir_path().map_err(AppError::Config)?;
        std::env::set_var("RELAYCRAFT_RULES_DIR", &rules_dir);

        // Pass data and rules directory to Python engine
        let data_dir = crate::config::get_data_dir().map_err(|e| AppError::Config(e))?;
        std::env::set_var("RELAYCRAFT_DATA_DIR", &data_dir);

        // Set certs directory (confdir)
        let cert_dir = crate::certificate::get_cert_dir().map_err(|e| AppError::Config(e))?;

        let mut args = vec![
            "--flow-detail".to_string(),
            "0".to_string(),
            "-s".to_string(),
            addon_file.to_string_lossy().to_string(),
            "-p".to_string(),
            config.proxy_port.to_string(),
        ];

        // Setup arguments (Note: mitmdump doesn't support --web-port)
        if config.ssl_insecure {
            args.push("--ssl-insecure".to_string());
        }
        if config.upstream_proxy.enabled && !config.upstream_proxy.url.is_empty() {
            args.extend_from_slice(&[
                "--mode".to_string(),
                format!("upstream:{}", config.upstream_proxy.url),
            ]);
        }

        // Scripts
        let script_storage =
            ScriptStorage::from_config().map_err(|e| AppError::Config(e.to_string()))?;
        let user_scripts = script_storage
            .get_enabled_script_paths()
            .map_err(|e| AppError::Config(e.to_string()))?;

        let user_scripts_joined = user_scripts
            .iter()
            .map(|p| p.to_string_lossy().to_string())
            .collect::<Vec<String>>()
            .join(";");

        {
            let mut active_lock = self
                .inner
                .active_scripts
                .lock()
                .map_err(|_| AppError::Config("Lock poisoned".into()))?;
            *active_lock = user_scripts
                .iter()
                .map(|p| p.to_string_lossy().to_string())
                .collect();
        }

        // Add anchor script as the final capture step
        let addon_dir = self.get_addon_path(app)?.parent().unwrap().to_path_buf();
        let anchor_path = addon_dir.join("anchor.py");
        if anchor_path.exists() {
            args.extend_from_slice(&["-s".to_string(), anchor_path.to_string_lossy().to_string()]);
        }

        // Spawn
        let mut cmd = StdCommand::new(&engine_path);

        // Point mitmproxy to our certs directory
        cmd.env("MITMPROXY_CONFDIR", &cert_dir);

        // Provide user scripts for internal loading
        cmd.env("RELAYCRAFT_USER_SCRIPTS", &user_scripts_joined);

        cmd.args(&args)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }

        log::info!("Proxy engine spawning at: {:?}", engine_path);
        let mut child = cmd.spawn()?;
        log::info!("Proxy engine spawned with PID: {}", child.id());

        // Log forwarding
        self.spawn_log_forwarder(child.stdout.take(), "proxy");
        self.spawn_log_forwarder(child.stderr.take(), "proxy");

        self.inner.is_stopping.store(false, Ordering::SeqCst);
        *child_lock = Some(child);

        let port = config.proxy_port;

        // Save port for stop verification
        if let Ok(mut port_lock) = self.inner.last_port.lock() {
            *port_lock = Some(port);
        }

        // Wait for port to be ready
        let start_time = std::time::Instant::now();
        let mut last_log_time = std::time::Instant::now();
        let timeout = Duration::from_secs(120); // 120s for macOS Gatekeeper verification
        let mut ready = false;

        log::info!("Waiting for proxy port {} to be ready...", port);

        while start_time.elapsed() < timeout {
            if std::net::TcpStream::connect(format!("127.0.0.1:{}", port)).is_ok() {
                ready = true;
                log::info!(
                    "Proxy port {} is ready (took {}ms)",
                    port,
                    start_time.elapsed().as_millis()
                );
                break;
            }

            // Check if process crashed while waiting
            if let Some(child) = child_lock.as_mut() {
                if let Ok(Some(status)) = child.try_wait() {
                    // Crash detected
                    *child_lock = None; // Clear the dead child
                    let err_msg = format!("Engine crashed during startup with status: {}", status);
                    log::error!("{}", err_msg);
                    return Err(AppError::Config(err_msg));
                }
            }

            // Periodic logging every 2 seconds
            if last_log_time.elapsed().as_secs() >= 2 {
                let elapsed = start_time.elapsed().as_secs();
                log::info!("Still waiting for proxy engine... ({}s elapsed)", elapsed);

                #[cfg(target_os = "macos")]
                if elapsed == 10 {
                    log::warn!("Startup is taking longer than usual. macOS might be scanning the application (Gatekeeper). Please wait...");
                }

                last_log_time = std::time::Instant::now();
            }

            std::thread::sleep(Duration::from_millis(200));
        }

        if !ready {
            // Timeout occurred - cleanup the zombie process
            if let Some(mut child) = child_lock.take() {
                #[cfg(target_os = "windows")]
                {
                    let _ = child.kill();
                }
                #[cfg(not(target_os = "windows"))]
                {
                    let _ = child.kill();
                }
                let _ = child.wait();
            }
            return Err(AppError::Config("Timeout waiting for proxy engine to start (30s). Check if something is blocking port or if antivirus is interfering.".into()));
        }

        // Spawn crash watcher
        self.spawn_crash_watcher();

        Ok(())
    }

    fn stop(&self) -> Result<(), AppError> {
        self.inner.is_stopping.store(true, Ordering::SeqCst);
        let mut child_lock = self
            .inner
            .child
            .lock()
            .map_err(|_| AppError::Config("Lock poisoned".into()))?;

        let port = self.inner.last_port.lock().ok().and_then(|p| *p);

        if let Some(mut child) = child_lock.take() {
            #[cfg(target_os = "windows")]
            {
                let pid = child.id();
                let mut cmd = StdCommand::new("taskkill");
                cmd.args(["/F", "/T", "/PID", &pid.to_string()]);
                {
                    use std::os::windows::process::CommandExt;
                    const CREATE_NO_WINDOW: u32 = 0x08000000;
                    cmd.creation_flags(CREATE_NO_WINDOW);
                }
                let _ = cmd.output();
            }
            #[cfg(not(target_os = "windows"))]
            {
                let _ = child.kill();
            }
            let _ = child.wait();
        }

        // Wait for port to be released
        if let Some(p) = port {
            let start_time = std::time::Instant::now();
            let timeout = Duration::from_secs(5);
            while start_time.elapsed() < timeout {
                if std::net::TcpStream::connect(format!("127.0.0.1:{}", p)).is_err() {
                    // Port is closed
                    break;
                }
                std::thread::sleep(Duration::from_millis(100));
            }
        }

        if let Ok(mut active) = self.inner.active_scripts.lock() {
            active.clear();
        }

        // Clean up temp scripts
        let temp_dir = std::env::temp_dir().join("relaycraft_scripts");
        if temp_dir.exists() {
            let _ = std::fs::remove_dir_all(&temp_dir);
        }

        Ok(())
    }

    fn terminate(&self) -> Result<(), AppError> {
        self.inner.is_stopping.store(true, Ordering::SeqCst);
        let mut child_lock = self
            .inner
            .child
            .lock()
            .map_err(|_| AppError::Config("Lock poisoned".into()))?;

        // Immediate kill without waiting for port release
        if let Some(mut child) = child_lock.take() {
            #[cfg(target_os = "windows")]
            {
                let pid = child.id();
                let mut cmd = StdCommand::new("taskkill");
                cmd.args(["/F", "/T", "/PID", &pid.to_string()]);
                {
                    use std::os::windows::process::CommandExt;
                    const CREATE_NO_WINDOW: u32 = 0x08000000;
                    cmd.creation_flags(CREATE_NO_WINDOW);
                }
                let _ = cmd.output();
            }
            #[cfg(not(target_os = "windows"))]
            {
                let _ = child.kill();
            }
            // Wait for killed process to exit
            let _ = child.wait();
        }

        if let Ok(mut active) = self.inner.active_scripts.lock() {
            active.clear();
        }

        // Skip temp dir cleanup on terminate for speed

        Ok(())
    }

    fn get_status(&self) -> ProxyStatus {
        let mut child_lock = self.inner.child.lock().unwrap();
        let active_lock = self.inner.active_scripts.lock().unwrap();

        let running = if let Some(child) = child_lock.as_mut() {
            child.try_wait().map(|s| s.is_none()).unwrap_or(false)
        } else {
            false
        };

        if !running && child_lock.is_some() {
            *child_lock = None;
        }

        let active = self.inner.traffic_active.load(Ordering::SeqCst);

        ProxyStatus {
            running,
            active,
            active_scripts: if running { active_lock.clone() } else { vec![] },
        }
    }

    fn set_active(&self, active: bool) -> Result<(), AppError> {
        self.inner.traffic_active.store(active, Ordering::SeqCst);
        log::info!("Traffic active state changed to: {}", active);

        // Notify Python engine via HTTP API
        let port = self
            .inner
            .last_port
            .lock()
            .map_err(|_| AppError::Config("Lock poisoned".into()))?;
        if let Some(port) = *port {
            let url = format!("http://127.0.0.1:{}/_relay/traffic_active", port);
            let body = serde_json::json!({"active": active}).to_string();

            // Use reqwest in a spawned task (async)
            let url_clone = url.clone();
            let body_clone = body.clone();
            tauri::async_runtime::spawn(async move {
                let client = reqwest::Client::new();
                match client
                    .post(&url_clone)
                    .header("Content-Type", "application/json")
                    .body(body_clone)
                    .timeout(std::time::Duration::from_secs(5))
                    .send()
                    .await
                {
                    Ok(resp) => log::debug!("Traffic active API response: {:?}", resp.status()),
                    Err(e) => {
                        log::warn!("Failed to notify Python about traffic active state: {}", e)
                    }
                }
            });
        }

        Ok(())
    }

    fn get_stats(&self, sys: &mut sysinfo::System) -> Result<EngineStats, AppError> {
        use std::time::{Duration, Instant};
        use sysinfo::ProcessesToUpdate;

        let mut cached_pids_lock = self.inner.cached_pids.lock().unwrap();
        let mut last_refresh_lock = self.inner.last_pid_refresh.lock().unwrap();
        let now = Instant::now();

        // Refresh PID tree cache periodically
        if cached_pids_lock.is_empty()
            || now.duration_since(*last_refresh_lock) > Duration::from_secs(30)
        {
            // Full refresh to discover new processes (WebView2, Proxy, etc.)
            sys.refresh_processes(ProcessesToUpdate::All, true);

            // Strategy A: Find all descendants starting from the Current Process (Main App)
            let main_pid = sysinfo::get_current_pid().unwrap();
            let mut pids = vec![main_pid];
            let mut queue = vec![main_pid];

            // Breadth-First Search for all descendants
            while let Some(parent_pid) = queue.pop() {
                for (pid, process) in sys.processes() {
                    if let Some(ppid) = process.parent() {
                        if ppid == parent_pid {
                            queue.push(*pid);
                            pids.push(*pid);
                        }
                    }
                }
            }

            *cached_pids_lock = pids;
            *last_refresh_lock = now;
            log::debug!(
                "Refreshed application PID tree cache: {} processes found",
                cached_pids_lock.len()
            );
        } else {
            // Targeted refresh of cached PIDs
            sys.refresh_processes(ProcessesToUpdate::Some(&cached_pids_lock), true);
        }

        let mut total_memory = 0;
        let mut total_cpu = 0.0;
        let mut uptime = 0;
        let main_pid = sysinfo::get_current_pid().unwrap();
        let num_cpus = sys.cpus().len() as f32;

        for pid in &*cached_pids_lock {
            if let Some(process) = sys.process(*pid) {
                total_memory += process.memory();
                total_cpu += process.cpu_usage();
                if *pid == main_pid {
                    uptime = process.run_time();
                }
            }
        }

        // Normalize CPU usage to total system percentage
        if num_cpus > 0.0 {
            total_cpu /= num_cpus;
        }

        Ok(EngineStats {
            memory_usage: total_memory,
            cpu_usage: total_cpu,
            up_time: uptime,
            rx_speed: 0,
            tx_speed: 0,
        })
    }
}

impl MitmproxyEngine {
    fn get_addon_path(&self, app: &AppHandle) -> Result<PathBuf, AppError> {
        if cfg!(debug_assertions) {
            let current_dir = std::env::current_dir()?;
            let project_root = if current_dir.ends_with("src-tauri") {
                current_dir.parent().unwrap().to_path_buf()
            } else {
                current_dir
            };
            // Directly use engine-core/addons in debug mode for hot reloading
            Ok(project_root
                .join("engine-core")
                .join("addons")
                .join("entry.py"))
        } else {
            let resource_dir = app
                .path()
                .resource_dir()
                .map_err(|e| AppError::Config(e.to_string()))?;
            let candidates = vec![
                resource_dir
                    .join("resources")
                    .join("addons")
                    .join("entry.py"),
                resource_dir.join("addons").join("entry.py"),
                resource_dir.join("entry.py"),
            ];
            candidates
                .into_iter()
                .find(|p| p.exists())
                .ok_or_else(|| AppError::NotFound("entry.py not found".into()))
        }
    }

    fn spawn_log_forwarder(
        &self,
        stream: Option<impl std::io::Read + Send + 'static>,
        _domain: &'static str,
    ) {
        if let Some(s) = stream {
            let reader = std::io::BufReader::new(s);
            std::thread::spawn(move || {
                use std::io::BufRead;
                for line in reader.lines().flatten() {
                    // Classify log domain based on content markers
                    let domain = if line.contains("[SCRIPT]")
                        || line.contains("[RELAYCRAFT][SCRIPT]")
                        || line.contains("._rc_")
                        || line.contains("_rc_record_hit")
                        || line.contains("_rc_log") {
                        "script"
                    } else if line.contains("[PLUGIN]") {
                        "plugin"
                    } else if line.contains("[AUDIT]") {
                        "audit"
                    } else if line.contains("[CRASH]") || line.contains("Traceback") {
                        "crash"
                    } else {
                        "proxy"
                    };
                    logging::write_domain_log(domain, &line).ok();
                }
            });
        }
    }

    fn spawn_crash_watcher(&self) {
        let inner = self.inner.clone();
        std::thread::spawn(move || {
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
        });
    }
}
