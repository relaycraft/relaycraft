pub mod client;
pub mod commands;
pub mod config;
pub mod crypto;
pub mod error;
pub mod profiles;
pub mod tool_args;

pub use client::{
    AIClient, ChatCompletionChunk, ChatMessage, Tool, ToolChoice,
};
pub use commands::AIState;
pub use config::AIConfig;
// pub use crypto::{delete_api_key, has_api_key, retrieve_api_key, store_api_key};
// pub use error::AIError;
