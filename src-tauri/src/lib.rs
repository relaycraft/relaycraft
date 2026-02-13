mod ai;
mod certificate;
mod common;
mod config;
pub mod plugins;
mod proxy;
mod rules;
mod session;
mod traffic;

use std::sync::{Arc, Mutex};
use tauri::Manager;

mod logging;
mod scripts;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Load existing config or use default
    let mut app_config = config::load_config().unwrap_or_default();

    // Ensure local loopback always bypasses system proxies
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

    // Apply upstream proxy to environment if enabled
    apply_upstream_proxy(&app_config);

    // Try to load API key from local storage on startup
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

    // Initialize Specialized Logging (Crash, Audit, Script)
    if let Ok(root_dir) = config::get_app_root_dir() {
        logging::init_log_dir(root_dir);
        logging::setup_panic_hook();
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // When a second instance is launched, focus the existing window
            let windows = app.webview_windows();
            if let Some(window) = windows.values().next() {
                let _ = window.set_focus();
                let _ = window.unminimize();
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
        .manage(plugins::PluginCache::default())
        .setup(move |app| {
            #[cfg(target_os = "macos")]
            {
                use tauri::Manager;
                if let Some(window) = app.get_webview_window("main") {
                    setup_macos_window(&window);
                }
            }

            // On Windows, disable decorations to allow our custom TitleBar
            #[cfg(target_os = "windows")]
            {
                use tauri::Manager;
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.set_decorations(false);
                }
            }

            // Apply Always on Top if enabled in config
            if app_config.always_on_top {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.set_always_on_top(true);
                }
            }
            // Ensure CA certificate exists on startup
            if let Ok(cert_dir) = certificate::get_cert_dir() {
                let _ = certificate::ensure_ca_exists(&cert_dir);
            }

            // Aggressive Cleanup on Startup: Kill any stale engine processes
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

            // Securely allow the themes directory in the asset protocol scope at runtime
            if let Ok(themes_dir) = config::get_themes_dir() {
                let scope = app.asset_protocol_scope();
                let _ = scope.allow_directory(&themes_dir, true);
                log::info!("Allowed themes directory in asset scope: {:?}", themes_dir);
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            proxy::start_proxy,
            proxy::stop_proxy,
            proxy::get_proxy_status,
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
            session::load_session,
            session::har::export_har,
            session::har::import_har,
            rules::load_all_rules,
            rules::save_rule,
            rules::delete_rule,
            rules::load_groups,
            rules::save_groups,
            rules::export_rules_bundle,
            rules::import_rules_bundle,
            rules::get_rules_dir_path,
            rules::export_rules_zip,
            rules::import_rules_zip,
            logging::log_domain_event,
            logging::get_logs,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| match event {
            tauri::RunEvent::Exit | tauri::RunEvent::ExitRequested { .. } => {
                log::info!("Application exiting/requested exit, cleaning up engine process...");

                // Try to kill the child process gracefully first via state
                if let Some(state) = app_handle.try_state::<proxy::ProxyState>() {
                    // Use terminate() to skip waiting for port release
                    let _ = state.engine.terminate();
                    log::info!("Child process stopped via engine abstraction");
                }
                // Force kill any remaining engine processes as fallback
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
            _ => {}
        });
}

#[cfg(target_os = "macos")]
fn setup_macos_window(window: &tauri::WebviewWindow) {
    use cocoa::appkit::{NSWindow, NSWindowStyleMask, NSWindowTitleVisibility};
    use cocoa::base::{id, YES};

    unsafe {
        let ns_window = window.ns_window().unwrap() as id;
        ns_window.setTitlebarAppearsTransparent_(YES);
        ns_window.setTitleVisibility_(NSWindowTitleVisibility::NSWindowTitleHidden);

        let mut style_mask = ns_window.styleMask();
        style_mask.insert(NSWindowStyleMask::NSFullSizeContentViewWindowMask);
        ns_window.setStyleMask_(style_mask);
    }
}

fn apply_upstream_proxy(config: &config::AppConfig) {
    if config.upstream_proxy.enabled && !config.upstream_proxy.url.is_empty() {
        let proxy_url = &config.upstream_proxy.url;
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
