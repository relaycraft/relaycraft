use thiserror::Error;

/// Common application errors
#[derive(Debug, Error)]
#[allow(dead_code)]
pub enum AppError {
    #[allow(dead_code)] // Added
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[allow(dead_code)]
    #[error("Serialization error: {0}")]
    Serialization(String),

    #[allow(dead_code)]
    #[error("Configuration error: {0}")]
    Config(String),

    #[allow(dead_code)]
    #[error("Not found: {0}")]
    NotFound(String),
}

/// Rule-specific errors
#[derive(Debug, Error)]
#[allow(dead_code)]
pub enum RuleError {
    #[allow(dead_code)] // Added
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[allow(dead_code)] // Added
    #[error("Parse error: {0}")]
    Parse(String),

    #[allow(dead_code)]
    #[error("Rule not found: {0}")]
    NotFound(String),

    #[allow(dead_code)]
    #[error("Invalid rule: {0}")]
    Invalid(String),

    #[allow(dead_code)]
    #[error("Serialization error: {0}")]
    Serialization(String),
}

/// Script-specific errors
#[derive(Debug, Error)]
#[allow(dead_code)]
pub enum ScriptError {
    #[allow(dead_code)] // Added
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[allow(dead_code)] // Added
    #[error("Script not found: {0}")]
    NotFound(String),

    #[allow(dead_code)]
    #[error("Compilation error: {0}")]
    Compilation(String),

    #[allow(dead_code)] // Added
    #[error("Runtime error: {0}")]
    Runtime(String),

    #[allow(dead_code)] // Added
    #[error("Serialization error: {0}")]
    Serialization(String),
}

/// Helper trait for converting errors to Tauri-compatible String errors
#[allow(dead_code)]
pub trait ToTauriError {
    fn to_tauri_error(self) -> String;
}

#[allow(dead_code)]
impl<E: std::error::Error> ToTauriError for E {
    fn to_tauri_error(self) -> String {
        self.to_string()
    }
}
