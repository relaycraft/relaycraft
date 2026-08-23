use thiserror::Error;

/// Common application errors
#[derive(Debug, Error)]
pub enum AppError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Configuration error: {0}")]
    Config(String),

    #[error("Not found: {0}")]
    NotFound(String),
}

/// Rule-specific errors
#[derive(Debug, Error)]
pub enum RuleError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Parse error: {0}")]
    Parse(String),

    #[error("Invalid rule: {0}")]
    Invalid(String),

    #[error("Serialization error: {0}")]
    Serialization(String),
}

/// Script-specific errors
#[derive(Debug, Error)]
pub enum ScriptError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Script not found: {0}")]
    NotFound(String),

    #[error("Runtime error: {0}")]
    Runtime(String),

    #[error("Serialization error: {0}")]
    Serialization(String),
}

/// Helper trait for converting errors to Tauri-compatible String errors
pub trait ToTauriError {
    fn to_tauri_error(self) -> String;
}

impl<E: std::error::Error> ToTauriError for E {
    fn to_tauri_error(self) -> String {
        self.to_string()
    }
}
