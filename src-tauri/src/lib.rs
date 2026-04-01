mod ai;
mod certificate;
mod common;
mod config;
mod mcp;
pub mod plugins;
mod proxy;
mod rules;
mod session;
mod traffic;

use std::sync::{Arc, Mutex};
use tauri::{Emitter, Manager};

mod logging;
mod scripts;

/// Warnings detected during startup that the frontend should surface to the user.
pub struct StartupWarnings {
    pub config_was_reset: bool,
}

#[tauri::command]
fn get_startup_warnings(state: tauri::State<'_, StartupWarnings>) -> bool {
    state.config_was_reset
}

/// Handle file-open requests from the OS (double-click on .rcplugin / .rctheme).
/// Installs the file and emits an event so the frontend can refresh & notify.
fn handle_file_open<R: tauri::Runtime>(app: &tauri::AppHandle<R>, paths: &[std::path::PathBuf]) {
    let app_root = match config::get_app_root_dir() {
        Ok(d) => d,
        Err(e) => {
            log::error!("[FileOpen] Cannot resolve app root: {}", e);
            return;
        }
    };

    for path in paths {
        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_lowercase();
        if ext != "rcplugin" && ext != "rctheme" {
            continue;
        }
        log::info!("[FileOpen] Installing from OS file association: {:?}", path);

        match plugins::install_plugin_from_zip(path, &app_root) {
            Ok(id) => {
                log::info!("[FileOpen] Installed successfully: {}", id);
                let _ = logging::write_domain_log(
                    "audit",
                    &format!("Installed via file association: {}", id),
                );
                let _ = app.emit("plugin-installed-from-file", &id);
            }
            Err(e) => {
                log::error!("[FileOpen] Installation failed: {}", e);
                let _ = app.emit("plugin-install-failed-from-file", &e);
            }
        }
    }
}

/// Extract installable file paths (.rcplugin / .rctheme) from CLI arguments.
fn extract_file_paths_from_args(args: &[String]) -> Vec<std::path::PathBuf> {
    args.iter()
        .filter_map(|arg| {
            let p = std::path::PathBuf::from(arg);
            let ext = p.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
            if (ext == "rcplugin" || ext == "rctheme") && p.exists() {
                Some(p)
            } else {
                None
            }
        })
        .collect()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {

    // Load existing config or use default; detect corruption so we can notify the user.
    let config_load_result = config::load_config();
    let config_was_reset = config_load_result.is_err();
    if config_was_reset {
        log::error!(
            "Failed to load config ({}), resetting to defaults",
            config_load_result.as_ref().err().unwrap()
        );
    }
    let mut app_config = config_load_result.unwrap_or_default();

    // Ensure local loopback bypasses system proxies
    let current_no_proxy = std::env::var("NO_PROXY").unwrap_or_default();
    let loopback_bypass = "localhost,127.0.0.1,::1";
    let new_no_proxy = if current_no_proxy.is_empty() {
        loopback_bypass.to_string()
    } else if !current_no_proxy.contains("127.0.0.1") {
        format!("{},{}", current_no_proxy, loopback_bypass)
    } else {
        current_no_proxy
    };
    std::env::set_var("NO_PROXY", &new_no_proxy);
    std::env::set_var("no_proxy", &new_no_proxy);
    log::info!("Applied global loopback bypass: NO_PROXY={}", new_no_proxy);

    // Apply upstream proxy
    apply_upstream_proxy(&app_config);

    // Load API key from local storage
    match ai::crypto::retrieve_api_key(&app_config.ai_config.provider) {
        Ok(key) => {
            if !key.is_empty() {
                log::info!("Successfully loaded AI API key from local storage");
                app_config.ai_config.api_key = key;
            } else {
                log::info!("AI API key in local storage is empty");
            }
        }
        Err(e) => {
            log::info!("No AI API key found in local storage: {}", e);
        }
    }

    // Initialize specialized logging
    if let Ok(root_dir) = config::get_app_root_dir() {
        logging::init_log_dir(root_dir);
        logging::setup_panic_hook();
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            // Focus existing window on second instance
            let windows = app.webview_windows();
            if let Some(window) = windows.values().next() {
                let _ = window.set_focus();
                let _ = window.unminimize();
            }
            // Handle file associations passed as CLI args (Windows/Linux hot start)
            let paths = extract_file_paths_from_args(&args);
            if !paths.is_empty() {
                handle_file_open(app, &paths);
            }
        }))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init())
        .plugin(
            tauri_plugin_log::Builder::default()
                .level(if app_config.verbose_logging {
                    log::LevelFilter::Debug
                } else {
                    log::LevelFilter::Info
                })
                .level_for(
                    "relaycraft",
                    if app_config.verbose_logging {
                        log::LevelFilter::Trace
                    } else {
                        log::LevelFilter::Debug
                    },
                )
                .targets([
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout),
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Folder {
                        path: config::get_app_root_dir().unwrap_or_default().join("logs"),
                        file_name: Some("app".to_string()),
                    }),
                ])
                .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepOne)
                .timezone_strategy(tauri_plugin_log::TimezoneStrategy::UseLocal)
                .format(|out, message, record| {
                    out.finish(format_args!(
                        "[{}] [{}] [{}] {}",
                        chrono::Local::now().format("%Y-%m-%d %H:%M:%S"),
                        record.level(),
                        record.target(),
                        message
                    ))
                })
                .build(),
        )
        .plugin(tauri_plugin_fs::init())
        .manage(proxy::ProxyState {
            engine: Arc::new(proxy::MitmproxyEngine::new()),
            system: Mutex::new(sysinfo::System::new_all()),
            networks: Mutex::new(sysinfo::Networks::new_with_refreshed_list()),
            last_rx: Mutex::new(0),
            last_tx: Mutex::new(0),
            last_update: Mutex::new(std::time::Instant::now()),
        })
        .manage(ai::AIState {
            config: Mutex::new(app_config.ai_config.clone()),
        })
        .manage(StartupWarnings { config_was_reset })
        .manage(plugins::PluginCache::default())
        .manage(mcp::McpState::default())
        .setup(move |app| {
            // Delegate window setup to common::window (handles macOS vibrancy and cross-platform decor)
            if let Some(window) = app.get_webview_window("main") {
                common::window::setup_window(&window);
            }

            #[cfg(target_os = "macos")]
            {
                // On macOS (WebKit), show the splash window from Rust immediately.
                if let Some(splash) = app.get_webview_window("splashscreen") {
                    let _ = splash.show();
                }
            }

            #[cfg(not(any(target_os = "macos", target_os = "windows")))]
            {
                if let Some(splash) = app.get_webview_window("splashscreen") {
                    let _ = splash.show();
                }
            }

            // Apply Always on Top if enabled
            if app_config.always_on_top {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.set_always_on_top(true);
                }
            }
            // Ensure CA certificate exists
            if let Ok(cert_dir) = certificate::get_cert_dir() {
                let _ = certificate::ensure_ca_exists(&cert_dir);
            }

            // Kill stale engine processes
            #[cfg(target_os = "windows")]
            {
                use std::os::windows::process::CommandExt;
                use std::process::Command;
                const CREATE_NO_WINDOW: u32 = 0x08000000;

                let targets = [
                    "engine.exe",
                    "engine-x86_64-pc-windows-msvc.exe",
                    "mitmdump.exe",
                ];
                for im in targets {
                    let _ = Command::new("taskkill")
                        .args(["/F", "/IM", im])
                        .creation_flags(CREATE_NO_WINDOW)
                        .output();
                }
            }

            // Allow themes directory in asset scope
            if let Ok(themes_dir) = config::get_themes_dir() {
                let scope = app.asset_protocol_scope();
                let _ = scope.allow_directory(&themes_dir, true);
                log::info!("Allowed themes directory in asset scope: {:?}", themes_dir);
            }

            // Auto-start proxy engine
            let proxy_state = app.state::<proxy::ProxyState>();
            let app_handle: tauri::AppHandle = app.handle().clone();
            match proxy_state.engine.start(&app_handle, &app_config) {
                Ok(()) => {
                    log::info!("Proxy engine started as background service");
                    // Don't set active here - let frontend control it via startProxy()
                    // This ensures TrafficMonitor is properly initialized
                }
                Err(e) => {
                    log::error!("Failed to start proxy engine on app launch: {:?}", e);
                }
            }

            // Auto-start MCP Server if enabled in config
            if app_config.mcp_config.enabled {
                let mcp_state = app.state::<mcp::McpState>();
                mcp::start(&mcp_state, app_config.mcp_config.port, app_config.proxy_port, app.handle().clone());
            }

            // Cold start: handle file association from CLI args (Windows/Linux)
            #[cfg(not(target_os = "macos"))]
            {
                let args: Vec<String> = std::env::args().collect();
                let paths = extract_file_paths_from_args(&args);
                if !paths.is_empty() {
                    let handle = app.handle().clone();
                    // Delay briefly so the frontend has time to mount its event listeners
                    std::thread::spawn(move || {
                        std::thread::sleep(std::time::Duration::from_secs(2));
                        handle_file_open(&handle, &paths);
                    });
                }
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            proxy::start_proxy,
            proxy::stop_proxy,
            proxy::restart_proxy,
            proxy::get_proxy_status,
            proxy::set_proxy_active,
            proxy::prepare_update_install,
            proxy::get_process_stats,
            common::utils::get_local_ip,
            certificate::get_cert_path,
            certificate::open_cert_dir,
            certificate::check_cert_installed,
            certificate::get_detailed_cert_info,
            certificate::install_cert_automated,
            certificate::remove_cert_automated,
            certificate::regenerate_root_ca,
            config::load_config,
            config::save_config,
            config::open_config_dir,
            config::open_data_dir,
            config::open_logs_dir,
            scripts::commands::list_scripts,
            scripts::commands::get_script_content,
            scripts::commands::save_script,
            scripts::commands::delete_script,
            scripts::commands::set_script_enabled,
            scripts::commands::rename_script,
            scripts::commands::move_script,
            ai::commands::load_ai_config,
            ai::commands::save_ai_config,
            ai::commands::test_ai_connection,
            ai::commands::ai_chat_completion,
            ai::commands::ai_chat_completion_stream,
            ai::commands::get_api_key,
            plugins::commands::get_plugins,
            plugins::commands::toggle_plugin,
            plugins::commands::read_plugin_file,
            plugins::commands::get_themes,
            plugins::commands::read_theme_file,
            plugins::commands::get_plugin_config,
            plugins::commands::save_plugin_config,
            plugins::commands::uninstall_plugin,
            plugins::commands::uninstall_theme,
            plugins::commands::plugin_install_local_zip,
            plugins::market::plugin_market_fetch,
            plugins::market::plugin_market_install,
            plugins::market::plugin_market_load_cache,
            plugins::bridge::plugin_call,
            common::utils::check_regex_match,
            common::utils::get_system_info,
            traffic::replay_request,
            traffic::check_proxy_connectivity,
            session::save_session,
            session::har::export_har,
            rules::load_all_rules,
            rules::save_rule,
            rules::save_all_rules,
            rules::delete_rule,
            rules::load_groups,
            rules::save_groups,
            rules::export_rules_bundle,
            rules::import_rules_bundle,
            common::window::set_window_vibrancy,
            rules::get_rules_dir_path,
            rules::export_rules_zip,
            rules::import_rules_zip,
            logging::log_domain_event,
            logging::get_logs,
            get_startup_warnings,
            mcp::get_mcp_status,
            mcp::get_mcp_token,
            mcp::apply_mcp_config,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| match event {
            tauri::RunEvent::Exit | tauri::RunEvent::ExitRequested { .. } => {
                log::info!("Application exiting/requested exit, cleaning up engine process...");

                // Try to kill the child process gracefully via state
                if let Some(state) = app_handle.try_state::<proxy::ProxyState>() {
                    // Use terminate() to skip waiting for port release
                    let _ = state.engine.terminate();
                    log::info!("Child process stopped via engine abstraction");
                }
                // Force kill remaining engine processes as fallback
                #[cfg(target_os = "windows")]
                {
                    use std::os::windows::process::CommandExt;
                    use std::process::Command;
                    const CREATE_NO_WINDOW: u32 = 0x08000000;

                    let targets = [
                        "engine.exe",
                        "engine-x86_64-pc-windows-msvc.exe",
                        "mitmdump.exe",
                    ];
                    for im in targets {
                        let _ = Command::new("taskkill")
                            .args(["/F", "/IM", im])
                            .creation_flags(CREATE_NO_WINDOW)
                            .output();
                    }
                }

                #[cfg(target_os = "macos")]
                {
                    use std::process::Command;
                    let _ = Command::new("pkill").args(&["-f", "engine"]).output();
                    let _ = Command::new("pkill").args(&["-f", "mitmdump"]).output();
                }

                log::info!("Cleanup complete");
            }
            // macOS: handle file-open events (double-click .rcplugin/.rctheme, or cold start)
            #[cfg(target_os = "macos")]
            tauri::RunEvent::Opened { urls } => {
                let paths: Vec<std::path::PathBuf> = urls
                    .iter()
                    .filter_map(|u| u.to_file_path().ok())
                    .collect();
                if !paths.is_empty() {
                    handle_file_open(app_handle, &paths);
                }
            }
            _ => {}
        });
}



fn apply_upstream_proxy(config: &config::AppConfig) {
    if config.upstream_proxy.enabled && !config.upstream_proxy.url.trim().is_empty() {
        let proxy_url = config.upstream_proxy.url.trim();
        log::info!("Applying upstream proxy to environment: {}", proxy_url);
        std::env::set_var("HTTP_PROXY", proxy_url);
        std::env::set_var("HTTPS_PROXY", proxy_url);
        std::env::set_var("ALL_PROXY", proxy_url);

        let bypass = if config.upstream_proxy.bypass_domains.is_empty() {
            "localhost,127.0.0.1,::1".to_string()
        } else {
            config.upstream_proxy.bypass_domains.clone()
        };

        std::env::set_var("NO_PROXY", bypass);
    } else {
        let loopback_bypass = "localhost,127.0.0.1,::1";
        std::env::set_var("NO_PROXY", loopback_bypass);
        std::env::set_var("no_proxy", loopback_bypass);

        std::env::remove_var("HTTP_PROXY");
        std::env::remove_var("HTTPS_PROXY");
        std::env::remove_var("ALL_PROXY");
    }
}
