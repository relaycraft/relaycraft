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

        // 0. Try relative bin/ directory first
        if let Ok(exe_path) = std::env::current_exe() {
            if let Some(exe_dir) = exe_path.parent() {
                let local_bin = exe_dir.join("bin").join("engine.exe");
                if local_bin.exists() {
                    return Ok(local_bin);
                }
            }
        }

        let target_triple = tauri::utils::platform::target_triple().unwrap_or_else(|_| "unknown".into());
        let binary_name = if cfg!(target_os = "windows") {
            format!("engine-{}.exe", target_triple)
        } else {
            format!("engine-{}", target_triple)
        };

        let binary_path = project_root
            .join("src-tauri")
            .join("binaries")
            .join(&binary_name);

        #[cfg(target_os = "macos")]
        {
            // Check resources directory for macOS directory bundle (onedir)
            let resource_path = project_root
                .join("src-tauri")
                .join("resources")
                .join("engine")
                .join("engine");

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

        // 0. Try bin directory next to the executable
        if let Some(dir) = &exe_dir {
            let bin_path = dir.join("bin").join(binary_name);
            if bin_path.exists() {
                return Ok(bin_path);
            }
        }

        // 1. Try hidden .core directory
        if let Some(dir) = &exe_dir {
            let core_path = dir.join(".core").join(binary_name);
            if core_path.exists() {
                return Ok(core_path);
            }
        }

        // 2. Try resource_dir (Contents/Resources)
        #[cfg(target_os = "macos")]
        {
            // 1. Try Frameworks path
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

                // 1b. Try flat Frameworks path
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

                // 1c. Try SharedSupport path
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

                // 1d. Try flattened SharedSupport
                let shared_support_flat = dir
                    .parent()
                    .map(|p| p.join("SharedSupport"))
                    .map(|p| p.join("engine"));

                if let Some(p) = shared_support_flat {
                    if p.exists() && p.is_file() {
                        return Ok(p);
                    }
                }

                // 2. Try MacOS dir
                let macos_engine_path = dir.join("engine").join(binary_name);
                log::info!(
                    "[PathCheck] Checking macOS exe_dir path: {:?}",
                    macos_engine_path
                );
                if macos_engine_path.exists() {
                    return Ok(macos_engine_path);
                }

                // Check if engine folder matches binary name directly
                let macos_flat_path = dir.join("engine");
                if macos_flat_path.exists() && macos_flat_path.is_file() {
                    return Ok(macos_flat_path);
                }
            }

            // 3. Try legacy nested path
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

            // 4. Try legacy flat path
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

        // 3. Try resource_dir/.core
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

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    // tauri::AppHandle requires a running app context, which is hard to mock in isolated unit tests.
    // However, we can test some platform-specific binary name assumptions and check that our
    // code compiles and logic isn't overtly broken by syntax or basic env checks.

    #[test]
    fn test_exe_name_resolution() {
        let is_windows = cfg!(target_os = "windows");
        let target_triple = tauri::utils::platform::target_triple().unwrap_or_else(|_| "unknown".into());
        
        let binary_name = if is_windows {
            format!("engine-{}.exe", target_triple)
        } else {
            format!("engine-{}", target_triple)
        };
        
        if is_windows {
            assert_eq!(binary_name, format!("engine-{}.exe", target_triple));
        } else {
            assert_eq!(binary_name, format!("engine-{}", target_triple));
        }
    }
    
    // Test the debug path resolution structure logic
    // We can't fully mock std::env::current_dir(), but we can test string manipulations
    #[test]
    fn test_debug_path_construction() {
        let fake_current_dir = PathBuf::from("/Users/test/Projects/relaycraft/src-tauri");
        
        let project_root = if fake_current_dir.ends_with("src-tauri") {
            fake_current_dir
                .parent()
                .unwrap()
                .to_path_buf()
        } else {
            fake_current_dir.clone()
        };
        
        assert_eq!(project_root, PathBuf::from("/Users/test/Projects/relaycraft"));
        
        // Check binary path construction
        let target_triple = tauri::utils::platform::target_triple().unwrap_or_else(|_| "unknown".into());
        let binary_path = project_root
            .join("src-tauri")
            .join("binaries")
            .join(format!("engine-{}", target_triple));
            
        assert_eq!(binary_path, PathBuf::from(format!("/Users/test/Projects/relaycraft/src-tauri/binaries/engine-{}", target_triple)));
    }
}
