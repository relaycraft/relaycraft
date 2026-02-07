use crate::common::error::ScriptError;
use std::path::{Path, PathBuf};
use std::process::Command as StdCommand;

/// Preprocess user scripts to inject tracking code via AST transformation
/// Creates temporary copies with the same filename in a temp directory
pub fn preprocess_scripts(
    scripts: &[PathBuf],
    injector_path: &Path,
) -> Result<Vec<String>, ScriptError> {
    if scripts.is_empty() {
        return Ok(Vec::new());
    }

    if !injector_path.exists() {
        return Err(ScriptError::NotFound(format!(
            "Injector script not found at: {:?}",
            injector_path
        )));
    }

    // Create temp directory for processed scripts
    let temp_dir = std::env::temp_dir().join("relaycraft_scripts");
    if temp_dir.exists() {
        let _ = std::fs::remove_dir_all(&temp_dir);
    }
    std::fs::create_dir_all(&temp_dir)?;

    let mut processed_paths = Vec::new();

    for script_path in scripts {
        let filename = script_path
            .file_name()
            .ok_or_else(|| ScriptError::Runtime("Invalid script path".into()))?
            .to_string_lossy()
            .to_string();

        // Create temp file with SAME filename
        let temp_script_path = temp_dir.join(&filename);

        // Call Python preprocessor
        let output = {
            let mut cmd = StdCommand::new("python");
            cmd.arg(injector_path)
                .arg(script_path)
                .arg(&temp_script_path);

            #[cfg(target_os = "windows")]
            {
                use std::os::windows::process::CommandExt;
                cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
            }

            cmd.output()
                .map_err(|e| ScriptError::Runtime(format!("Failed to run preprocessor: {}", e)))?
        };

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            log::warn!("Failed to preprocess {}: {}", filename, stderr);
            // Fallback: copy original file
            std::fs::copy(script_path, &temp_script_path)?;
        }

        processed_paths.push(temp_script_path.to_string_lossy().to_string());
    }

    Ok(processed_paths)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    #[test]
    fn test_empty_scripts() {
        let injector = PathBuf::from("fake_injector.py");
        let result = preprocess_scripts(&[], &injector).unwrap();
        assert!(result.is_empty());
    }

    #[test]
    fn test_missing_injector() {
        let temp = TempDir::new().unwrap();
        let script = temp.path().join("script.py");
        fs::write(&script, "print(1)").unwrap();

        let injector = temp.path().join("missing.py");
        let result = preprocess_scripts(&[script], &injector);
        assert!(result.is_err());
    }

    #[test]
    fn test_fallback_copy() {
        let temp = TempDir::new().unwrap();

        let script = temp.path().join("test_script.py");
        fs::write(&script, "print('original')").unwrap();

        // Use a "broken" injector (one that doesn't exist but we skip that check or just use one that fails)
        // Actually the code checks if it exists. So let's create a blank one that will probably fail if run as python script
        let injector = temp.path().join("broken_injector.py");
        fs::write(&injector, "import sys; sys.exit(1)").unwrap();

        let result = preprocess_scripts(&[script], &injector).unwrap();
        assert_eq!(result.len(), 1);

        // Verify fallback copied the file
        let processed_content = fs::read_to_string(&result[0]).unwrap();
        assert_eq!(processed_content, "print('original')");
    }
}
