use tauri::AppHandle;

pub fn get_engine_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    if cfg!(debug_assertions) {
        // Development mode
        let current_dir =
            std::env::current_dir().map_err(|e| format!("Failed to get current dir: {}", e))?;

        let project_root = if current_dir.ends_with("src-tauri") {
            current_dir
                .parent()
                .ok_or("Failed to get parent directory")?
                .to_path_buf()
        } else {
            current_dir
        };

        // 0. Try relative bin/ directory first (Professional Structure Support)
        if let Ok(exe_path) = std::env::current_exe() {
            if let Some(exe_dir) = exe_path.parent() {
                let local_bin = exe_dir.join("bin").join("engine.exe");
                if local_bin.exists() {
                    return Ok(local_bin);
                }
            }
        }

        let binary_name = if cfg!(target_os = "windows") {
            "engine.exe"
        } else {
            "engine"
        };

        let binary_path = project_root
            .join("src-tauri")
            .join("binaries")
            .join(binary_name);

        #[cfg(target_os = "macos")]
        {
            // Check resources directory for macOS directory bundle
            // Structure: resources/engine/engine
            let resource_path = project_root
                .join("src-tauri")
                .join("resources")
                .join(binary_name)
                .join(binary_name);

            if resource_path.exists() {
                return Ok(resource_path);
            }
        }

        Ok(binary_path)
    } else {
        // Production mode: Prefer hidden .core directory
        let resource_dir = tauri::Manager::path(app)
            .resource_dir()
            .map_err(|e| format!("Failed to get resource dir: {}", e))?;

        log::info!("DEBUG: resource_dir = {:?}", resource_dir);

        let exe_dir = std::env::current_exe()
            .ok()
            .and_then(|p| p.parent().map(|p| p.to_path_buf()));

        #[cfg(target_os = "windows")]
        let binary_name = "engine.exe";
        #[cfg(not(target_os = "windows"))]
        let binary_name = "engine";

        // 0. Try bin directory next to the executable (Highest Priority)
        if let Some(dir) = &exe_dir {
            let bin_path = dir.join("bin").join(binary_name);
            if bin_path.exists() {
                return Ok(bin_path);
            }
        }

        // 1. Try hidden .core directory next to the executable
        if let Some(dir) = &exe_dir {
            let core_path = dir.join(".core").join(binary_name);
            if core_path.exists() {
                return Ok(core_path);
            }
        }

        // 2. Try resource_dir (Contents/Resources)
        #[cfg(target_os = "macos")]
        {
            // 1. Try <app_bundle>/Contents/Frameworks/engine.framework/<binary_name>
            // This is the official Apple-recommended location for helper tools/runtimes.
            if let Some(dir) = exe_dir.as_ref() {
                let frameworks_path = dir
                    .parent() // Contents
                    .map(|p| p.join("Frameworks"))
                    .map(|p| p.join("engine.framework"))
                    .map(|p| p.join(binary_name));

                if let Some(p) = frameworks_path {
                    log::info!("[PathCheck] Checking macOS Frameworks path: {:?}", p);
                    if p.exists() {
                        return Ok(p);
                    }
                }

                // 1b. Try <app_bundle>/Contents/Frameworks/engine/<binary_name> (Folder style)
                let frameworks_flat_path = dir
                    .parent()
                    .map(|p| p.join("Frameworks"))
                    .map(|p| p.join("engine"))
                    .map(|p| p.join(binary_name));

                if let Some(p) = frameworks_flat_path {
                    log::info!("[PathCheck] Checking macOS Frameworks flat path: {:?}", p);
                    if p.exists() {
                        return Ok(p);
                    }
                }

                // 1c. Try <app_bundle>/Contents/SharedSupport/engine/<binary_name>
                // This is a valid location for "Component, other than a framework, that is needed by the app"
                // and is less strictly validated for bundle structure than Frameworks.
                let shared_support_path = dir
                    .parent()
                    .map(|p| p.join("SharedSupport"))
                    .map(|p| p.join("engine"))
                    .map(|p| p.join(binary_name));

                if let Some(p) = shared_support_path {
                    log::info!("[PathCheck] Checking macOS SharedSupport path: {:?}", p);
                    if p.exists() {
                        return Ok(p);
                    }
                }

                // 1d. Try <app_bundle>/Contents/SharedSupport/engine (Flattened)
                let shared_support_flat = dir
                    .parent()
                    .map(|p| p.join("SharedSupport"))
                    .map(|p| p.join("engine"));

                if let Some(p) = shared_support_flat {
                    if p.exists() && p.is_file() {
                        return Ok(p);
                    }
                }

                // 2. Try <app_bundle>/Contents/MacOS/engine/<binary_name> (Legacy/Manual move)
                let macos_engine_path = dir.join("engine").join(binary_name);
                log::info!(
                    "[PathCheck] Checking macOS exe_dir path: {:?}",
                    macos_engine_path
                );
                if macos_engine_path.exists() {
                    return Ok(macos_engine_path);
                }

                // Also check if engine folder matches binary name directly (flattened in MacOS)
                let macos_flat_path = dir.join("engine");
                if macos_flat_path.exists() && macos_flat_path.is_file() {
                    return Ok(macos_flat_path);
                }
            }

            // 3. Try <resource_dir>/resources/engine/<binary_name> (Legacy nested)
            let nested_onedir = resource_dir
                .join("resources")
                .join("engine")
                .join(binary_name);
            log::info!(
                "[PathCheck] Checking macOS nested legacy path: {:?}",
                nested_onedir
            );
            if nested_onedir.exists() {
                return Ok(nested_onedir);
            }

            // 4. Try <resource_dir>/engine/<binary_name> (Legacy flat)
            let onedir_path = resource_dir.join("engine").join(binary_name);
            log::info!(
                "[PathCheck] Checking macOS onedir legacy path: {:?}",
                onedir_path
            );
            if onedir_path.exists() {
                return Ok(onedir_path);
            }
        }

        let resource_path = resource_dir.join(binary_name);
        if resource_path.exists() {
            return Ok(resource_path);
        }

        // 3. Try resource_dir/.core (Optional hidden resource structure)
        let resource_core_path = resource_dir.join(".core").join(binary_name);
        if resource_core_path.exists() {
            return Ok(resource_core_path);
        }

        // 4. Try exe_dir directly (Contents/MacOS)
        if let Some(dir) = exe_dir {
            let exe_path = dir.join(binary_name);
            if exe_path.exists() {
                return Ok(exe_path);
            }
        }

        // Return error if still not found
        Err(format!(
            "Engine executable not found ({}). Please reinstall the application or check permissions.",
            binary_name
        ))
    }
}

pub fn get_python_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    if cfg!(debug_assertions) {
        // In development, assume 'python' is in PATH
        Ok(std::path::PathBuf::from("python"))
    } else {
        // In production, use the bundled python interpreter
        let engine_path = get_engine_path(app)?;
        let engine_dir = engine_path.parent().ok_or_else(|| {
            log::error!(
                "CRITICAL: Failed to get engine directory from {:?}",
                engine_path
            );
            "Failed to get engine directory".to_string()
        })?;

        log::info!("[PathCheck] Engine Binary: {:?}", engine_path);
        log::info!("[PathCheck] Engine Root Dir: {:?}", engine_dir);

        // 1. Check for bundled python candidates
        #[cfg(target_os = "macos")]
        {
            log::info!("[PathCheck] Engine root contents check...");
            if let Ok(entries) = std::fs::read_dir(&engine_dir) {
                for entry in entries.flatten() {
                    log::info!("[PathCheck]   Root item: {:?}", entry.file_name());
                }
            }

            let internal_dir = engine_dir.join("_internal");
            log::info!("[PathCheck] internal_dir exists: {}", internal_dir.exists());
            if internal_dir.exists() {
                if let Ok(entries) = std::fs::read_dir(&internal_dir) {
                    for entry in entries.flatten() {
                        log::info!("[PathCheck]   Internal item: {:?}", entry.file_name());
                    }
                }
            }

            // Python executable candidates in order of preference.
            // NOTE: _internal/Python is a DYLIB (not executable) - do NOT include it here.
            // PyInstaller onedir bundles don't have a standalone Python executable;
            // the main binary (engine) IS the Python runtime.
            let candidates = [
                engine_dir.join("python3"),     // Standard PyInstaller executable wrapper
                engine_dir.join("python3.12"),  // Versioned wrapper
                engine_dir.join("_internal").join("py_runtime").join("Python"), // Extracted framework binary
            ];

            for path in candidates {
                log::info!("[PathCheck] Checking candidate: {:?}", path);
                if path.exists() && path.is_file() {
                    log::info!("[PathCheck] FOUND Python: {:?}", path);
                    return Ok(path);
                }
            }

            log::warn!("[PathCheck] No bundled Python found. Full engine structure log above.");
        }

        #[cfg(target_os = "windows")]
        {
            let bundled_python = engine_dir.join("python.exe");
            if bundled_python.exists() {
                return Ok(bundled_python);
            }
        }

        // Fallback to system python if bundled not found
        log::info!("[PathCheck] Falling back to system 'python'");
        Ok(std::path::PathBuf::from("python"))
    }
}
