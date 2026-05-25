pub mod config;

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceConfig {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub icon: Option<ServiceIcon>,
    pub program: String,
    #[serde(default)]
    pub args: Vec<String>,
    pub cwd: String,
    #[serde(default)]
    pub env: HashMap<String, String>,
    #[serde(default)]
    pub port: Option<u16>,
    #[serde(default)]
    pub group: Option<String>,
    /// When true, the frontend re-spawns the service if it exits with a
    /// non-zero code (subject to a retry cap). Defaults to false for configs
    /// written before this field existed.
    #[serde(default)]
    pub auto_restart: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ServiceIcon {
    Emoji { value: String },
    Builtin { value: String },
    Image { path: String },
}

pub fn validate_services(services: &[ServiceConfig]) -> Result<(), Vec<String>> {
    let mut problems = Vec::new();
    let mut ids = HashSet::new();

    for (index, service) in services.iter().enumerate() {
        let label = service_label(index, service);
        let id = service.id.trim();

        if id.is_empty() {
            problems.push(format!("{label}: id must not be empty"));
        } else if !ids.insert(id.to_string()) {
            problems.push(format!("{label}: duplicate id '{id}'"));
        }

        if service.name.trim().is_empty() {
            problems.push(format!("{label}: name must not be empty"));
        }

        if service.program.trim().is_empty() {
            problems.push(format!("{label}: program must not be empty"));
        }

        if let Some(icon) = &service.icon {
            match icon {
                ServiceIcon::Emoji { value }
                | ServiceIcon::Builtin { value }
                | ServiceIcon::Image { path: value } => {
                    if value.trim().is_empty() {
                        problems.push(format!("{label}: icon value must not be empty"));
                    }
                }
            }
        }

        if service.cwd.trim().is_empty() {
            problems.push(format!("{label}: cwd must not be empty"));
        }

        if service.port == Some(0) {
            problems.push(format!("{label}: port must not be 0"));
        }
    }

    if problems.is_empty() {
        Ok(())
    } else {
        Err(problems)
    }
}

fn service_label(index: usize, service: &ServiceConfig) -> String {
    let id = service.id.trim();
    if id.is_empty() {
        format!("service #{}", index + 1)
    } else {
        format!("service '{id}'")
    }
}

#[cfg(test)]
mod tests {
    use super::{validate_services, ServiceConfig};
    use std::collections::HashMap;

    fn service(id: &str) -> ServiceConfig {
        ServiceConfig {
            id: id.to_string(),
            name: format!("Service {id}"),
            icon: None,
            program: "npm".to_string(),
            args: vec!["run".to_string(), "dev".to_string()],
            cwd: ".".to_string(),
            env: HashMap::new(),
            port: Some(3000),
            group: None,
            auto_restart: false,
        }
    }

    #[test]
    fn validation_rejects_duplicate_ids() {
        let result = validate_services(&[service("web"), service("web")]);

        assert!(result
            .unwrap_err()
            .iter()
            .any(|problem| problem.contains("duplicate id 'web'")));
    }

    #[test]
    fn validation_rejects_empty_required_fields_and_port_zero() {
        let mut invalid = service("");
        invalid.name = " ".to_string();
        invalid.program = "".to_string();
        invalid.cwd = "\t".to_string();
        invalid.port = Some(0);

        let problems = validate_services(&[invalid]).unwrap_err();

        assert!(problems
            .iter()
            .any(|problem| problem.contains("id must not be empty")));
        assert!(problems
            .iter()
            .any(|problem| problem.contains("name must not be empty")));
        assert!(problems
            .iter()
            .any(|problem| problem.contains("program must not be empty")));
        assert!(problems
            .iter()
            .any(|problem| problem.contains("cwd must not be empty")));
        assert!(problems
            .iter()
            .any(|problem| problem.contains("port must not be 0")));
    }
}
