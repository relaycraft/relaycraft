use serde::Serialize;
use std::fmt;

#[derive(Debug, Serialize)]
pub enum AIError {
    _ConfigError(String),
    NetworkError(String),
    APIError(String),
    ParseError(String),
    _KeyringError(String),
}

impl fmt::Display for AIError {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        match self {
            AIError::_ConfigError(msg) => write!(f, "Configuration error: {}", msg),
            AIError::NetworkError(msg) => write!(f, "Network error: {}", msg),
            AIError::APIError(msg) => write!(f, "API error: {}", msg),
            AIError::ParseError(msg) => write!(f, "Parse error: {}", msg),
            AIError::_KeyringError(msg) => write!(f, "Keyring error: {}", msg),
        }
    }
}

impl std::error::Error for AIError {}
