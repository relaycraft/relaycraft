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
            // macOS onedir structure might be nested depending on bundling
            // 1. Try <resource_dir>/resources/engine/<binary_name> (Most likely for 'resources/engine' config)
            let nested_onedir = resource_dir
                .join("resources")
                .join("engine")
                .join(binary_name);
            log::info!("DEBUG: Checking macOS nested path: {:?}", nested_onedir);
            if nested_onedir.exists() {
                return Ok(nested_onedir);
            }

            // 2. Try <resource_dir>/engine/<binary_name> (If flattened)
            let onedir_path = resource_dir.join("engine").join(binary_name);
            log::info!("DEBUG: Checking macOS onedir path: {:?}", onedir_path);
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
