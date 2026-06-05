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
    /// When true, treat `port` as a *preferred* port: if it's already taken at
    /// launch, Muxly rolls upward to the next free port and injects the chosen
    /// value into the process (env var named by `port_env_var`, default `PORT`,
    /// plus any `{port}` placeholders in `args`/`env` values). When false, a
    /// busy `port` is a hard error as before. Defaults to false.
    #[serde(default)]
    pub auto_port: bool,
    /// Name of the environment variable that receives the chosen port when
    /// `auto_port` is on. Absent/empty = `PORT`. Ignored when `auto_port` is off.
    #[serde(default)]
    pub port_env_var: Option<String>,
    #[serde(default)]
    pub group: Option<String>,
    /// When true, the frontend re-spawns the service if it exits with a
    /// non-zero code (subject to a retry cap). Defaults to false for configs
    /// written before this field existed.
    #[serde(default)]
    pub auto_restart: bool,
    /// When true, the service is spawned attached to a pseudo-terminal instead
    /// of the default pipe-based spawn. Required for dev servers (Vite, WXT,
    /// etc.) whose hot-reload loop depends on `process.stdin.isTTY` being true
    /// to install the keypress keep-alive that pins the event loop across
    /// rebuilds. Without a TTY, the dev server can exit cleanly after the
    /// first HMR cycle. Defaults to false so existing configs are unaffected.
    #[serde(default)]
    pub use_pty: bool,
    /// Optional shell prelude run *before* the main command, in the SAME shell,
    /// so its environment changes carry into the command (`nvm use 20`,
    /// `source .venv/bin/activate`, …). When empty/absent the service is
    /// spawned directly as before. When set, the spawn is wrapped in a shell:
    /// `<pre_run> && <program> <args…>`. See `process::shell`.
    #[serde(default)]
    pub pre_run: Option<String>,
    /// When true, this service's name is masked in the UI while "stream mode"
    /// is active (a Command-palette toggle), so the window is safe to
    /// screen-share. Defaults to false. Purely a frontend concern — the backend
    /// just persists the flag.
    #[serde(default)]
    pub sensitive: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ServiceIcon {
    Emoji { value: String },
    Builtin { value: String },
    Image { path: String },
}

/// Result of loading the service config: the entries that loaded cleanly, plus
/// human-readable `problems` for any that were skipped. Loading is resilient —
/// a single malformed or invalid entry is dropped and reported rather than
/// failing the whole list, so one typo can never empty the sidebar.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadedServices {
    pub services: Vec<ServiceConfig>,
    pub problems: Vec<String>,
}

/// Validate a single service's fields (everything except cross-entry duplicate
/// id detection, which the caller handles with a shared id set). Returns one
/// problem string per issue found, empty when the service is valid.
pub fn validate_service_fields(index: usize, service: &ServiceConfig) -> Vec<String> {
    let mut problems = Vec::new();
    let label = service_label(index, service);

    if service.id.trim().is_empty() {
        problems.push(format!("{label}: id must not be empty"));
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

    problems
}

pub fn validate_services(services: &[ServiceConfig]) -> Result<(), Vec<String>> {
    let mut problems = Vec::new();
    let mut ids = HashSet::new();

    for (index, service) in services.iter().enumerate() {
        problems.extend(validate_service_fields(index, service));

        let id = service.id.trim();
        if !id.is_empty() && !ids.insert(id.to_string()) {
            problems.push(format!(
                "{}: duplicate id '{id}'",
                service_label(index, service)
            ));
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
            auto_port: false,
            port_env_var: None,
            group: None,
            auto_restart: false,
            use_pty: false,
            pre_run: None,
            sensitive: false,
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
