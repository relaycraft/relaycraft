use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ScriptInfo {
    pub name: String,
    pub enabled: bool,
    pub path: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ScriptEntry {
    pub name: String,
    pub enabled: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct Manifest {
    pub scripts: Vec<ScriptEntry>,
}
