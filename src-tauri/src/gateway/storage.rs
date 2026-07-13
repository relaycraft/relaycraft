use std::fs;
use std::io;
use std::path::PathBuf;

use super::model::{GatewayGroup, GatewayRoute, LoadRoutesResponse};

#[derive(Debug, thiserror::Error)]
pub enum GatewayStorageError {
    #[error("IO error: {0}")]
    Io(#[from] io::Error),
    #[error("Serialization error: {0}")]
    Serde(#[from] serde_yaml::Error),
    #[error("Config error: {0}")]
    Invalid(String),
}

pub struct GatewayStorage {
    pub base_dir: PathBuf,
}

const GROUPS_FILE: &str = "groups.yaml";

impl GatewayStorage {
    pub fn new(base_dir: PathBuf) -> Result<Self, GatewayStorageError> {
        fs::create_dir_all(&base_dir)?;
        fs::create_dir_all(base_dir.join("routes"))?;
        fs::create_dir_all(base_dir.join("env"))?;
        Ok(Self { base_dir })
    }

    pub fn from_config() -> Result<Self, GatewayStorageError> {
        let data_dir =
            crate::config::get_data_dir().map_err(|e| GatewayStorageError::Invalid(e))?;
        Self::new(data_dir.join("gateway"))
    }

    fn routes_dir(&self) -> PathBuf {
        self.base_dir.join("routes")
    }

    // --- Routes ---

    pub fn load_all_routes(&self) -> Result<LoadRoutesResponse, GatewayStorageError> {
        let mut routes: Vec<GatewayRoute> = Vec::new();
        let dir = self.routes_dir();

        if !dir.exists() {
            fs::create_dir_all(&dir)?;
        }

        for entry in fs::read_dir(&dir)? {
            let entry = entry?;
            let path = entry.path();
            if path.is_dir() {
                Self::load_routes_from_group(&path, &mut routes)?;
            }
        }

        routes.sort_by(|a, b| {
            a.priority
                .cmp(&b.priority)
                .reverse()
                .then(a.name.cmp(&b.name))
                .then(a.id.cmp(&b.id))
        });

        let groups = self.load_groups()?;

        Ok(LoadRoutesResponse { routes, groups })
    }

    fn load_routes_from_group(
        group_dir: &PathBuf,
        routes: &mut Vec<GatewayRoute>,
    ) -> Result<(), GatewayStorageError> {
        for entry in fs::read_dir(group_dir)? {
            let entry = entry?;
            let path = entry.path();
            if path
                .extension()
                .map(|e| e == "yaml" || e == "yml")
                .unwrap_or(false)
            {
                if let Ok(content) = fs::read_to_string(&path) {
                    if let Ok(wrapper) = serde_yaml::from_str::<serde_yaml::Value>(&content) {
                        if let Some(route_value) = wrapper.get("route") {
                            if let Ok(mut route) =
                                serde_yaml::from_value::<GatewayRoute>(route_value.clone())
                            {
                                let group_name = group_dir
                                    .file_name()
                                    .map(|n| n.to_string_lossy().to_string())
                                    .unwrap_or_default();
                                route.group = group_name;
                                routes.push(route);
                            }
                        }
                    }
                }
            }
        }
        Ok(())
    }

    pub fn save_route(
        &self,
        route: &GatewayRoute,
        group_id: &str,
    ) -> Result<(), GatewayStorageError> {
        let group_dir = self.routes_dir().join(if group_id.is_empty() {
            "default"
        } else {
            group_id
        });
        fs::create_dir_all(&group_dir)?;

        let file_path = group_dir.join(format!("{}.yaml", route.id));
        let wrapper = serde_yaml::Value::Mapping(
            vec![(
                serde_yaml::Value::String("route".into()),
                serde_yaml::to_value(route)?,
            )]
            .into_iter()
            .collect(),
        );
        let yaml = serde_yaml::to_string(&wrapper)?;
        fs::write(&file_path, yaml)?;
        Ok(())
    }

    pub fn delete_route(&self, route_id: &str) -> Result<(), GatewayStorageError> {
        let dir = self.routes_dir();
        for group_entry in fs::read_dir(&dir)? {
            let group_entry = group_entry?;
            if group_entry.path().is_dir() {
                for file_entry in fs::read_dir(group_entry.path())? {
                    let file_entry = file_entry?;
                    let path = file_entry.path();
                    if path
                        .extension()
                        .map(|e| e == "yaml" || e == "yml")
                        .unwrap_or(false)
                    {
                        if let Ok(content) = fs::read_to_string(&path) {
                            if let Ok(wrapper) = serde_yaml::from_str::<serde_yaml::Value>(&content)
                            {
                                if let Some(route_val) = wrapper.get("route") {
                                    if let Some(id) = route_val.get("id").and_then(|v| v.as_str()) {
                                        if id == route_id {
                                            fs::remove_file(&path)?;
                                            return Ok(());
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        Ok(())
    }

    // --- Groups ---

    pub fn load_groups(&self) -> Result<Vec<GatewayGroup>, GatewayStorageError> {
        let path = self.base_dir.join(GROUPS_FILE);
        if !path.exists() {
            return Ok(Vec::new());
        }
        let content = fs::read_to_string(&path)?;
        let wrapper: serde_yaml::Value = serde_yaml::from_str(&content)?;
        match wrapper.get("groups") {
            Some(groups_val) => {
                let groups: Vec<GatewayGroup> = serde_yaml::from_value(groups_val.clone())?;
                Ok(groups)
            }
            None => Ok(Vec::new()),
        }
    }

    pub fn save_groups(&self, groups: &[GatewayGroup]) -> Result<(), GatewayStorageError> {
        let wrapper = serde_yaml::Value::Mapping(
            vec![(
                serde_yaml::Value::String("groups".into()),
                serde_yaml::to_value(groups)?,
            )]
            .into_iter()
            .collect(),
        );
        let yaml = serde_yaml::to_string(&wrapper)?;
        let path = self.base_dir.join(GROUPS_FILE);
        fs::write(&path, yaml)?;
        Ok(())
    }

    // --- Env Profiles ---

    fn env_dir(&self) -> PathBuf {
        self.base_dir.join("env")
    }

    pub fn load_env_profile(
        &self,
        profile: &str,
    ) -> Result<std::collections::HashMap<String, String>, GatewayStorageError> {
        let path = self.env_dir().join(format!("{}.yaml", profile));
        if !path.exists() {
            return Ok(std::collections::HashMap::new());
        }
        let content = fs::read_to_string(&path)?;
        let vars: std::collections::HashMap<String, String> =
            serde_yaml::from_str(&content).unwrap_or_default();
        Ok(vars)
    }

    pub fn save_env_profile(
        &self,
        profile: &str,
        vars: &std::collections::HashMap<String, String>,
    ) -> Result<(), GatewayStorageError> {
        let yaml = serde_yaml::to_string(vars)?;
        let path = self.env_dir().join(format!("{}.yaml", profile));
        fs::write(&path, yaml)?;
        Ok(())
    }

    pub fn list_env_profiles(&self) -> Result<Vec<String>, GatewayStorageError> {
        let dir = self.env_dir();
        if !dir.exists() {
            return Ok(Vec::new());
        }
        let mut profiles = Vec::new();
        for entry in fs::read_dir(&dir)? {
            let entry = entry?;
            let path = entry.path();
            if path
                .extension()
                .map(|e| e == "yaml" || e == "yml")
                .unwrap_or(false)
            {
                if let Some(stem) = path.file_stem() {
                    profiles.push(stem.to_string_lossy().to_string());
                }
            }
        }
        Ok(profiles)
    }
}
