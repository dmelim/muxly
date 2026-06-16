//! Port resolution and injection shared by both spawn paths.
//!
//! A service's `port` is normally just a preflight assertion: it must be free
//! or the spawn fails. With `auto_port` enabled it becomes a *preferred* port
//! instead — if it's taken we roll upward to the next free one and hand the
//! chosen value to the child process so the two can never disagree:
//!
//! - the env var named by `port_env_var` (default `PORT`) is set to it, and
//! - every `{port}` placeholder in `args` and in `env` *values* is replaced.
//!
//! Injection only happens for `auto_port` services; a plain `port` service
//! behaves exactly as before (free-or-fail, no env/arg rewriting), so existing
//! configs are untouched.

use crate::{
    error::AppError,
    net::{find_free_port_from, is_port_available},
    services::ServiceConfig,
};
use std::collections::HashMap;

/// How many ports to probe upward from the preferred port before giving up.
const AUTO_PORT_MAX_ATTEMPTS: u16 = 64;
/// Preferred port used when auto-port is on but the service has no `port` set.
const AUTO_PORT_DEFAULT_BASE: u16 = 3000;
/// Env var that receives the chosen port when the service doesn't name one.
const DEFAULT_PORT_ENV_VAR: &str = "PORT";

/// The concrete port + command inputs a spawn path should use, after applying
/// auto-port rolling and `{port}` injection.
pub struct ResolvedSpawn {
    /// The port the service will actually use, if any. Surfaced in the
    /// `PROCESS_STARTED` event so the UI links/labels the real port — which,
    /// for an auto-port service, may differ from its configured preference.
    pub port: Option<u16>,
    /// `args` with `{port}` substituted (auto-port only; otherwise a clone).
    pub args: Vec<String>,
    /// Env to apply: the service's own env (with `{port}` substituted) plus the
    /// injected port variable (auto-port only; otherwise a clone of `env`).
    pub env: HashMap<String, String>,
}

/// Resolve the effective port and command inputs for `service`.
///
/// For a non-auto-port service this preserves the historical contract: a
/// configured port must be bindable right now or we return [`AppError::PortInUse`],
/// and nothing is injected. For an auto-port service it finds the first free
/// port at or above the preference and injects it; if the whole probe window is
/// taken it returns [`AppError::NoFreePort`].
pub fn resolve_spawn(service: &ServiceConfig) -> Result<ResolvedSpawn, AppError> {
    if !service.auto_port {
        if let Some(port) = service.port {
            if !is_port_available(port) {
                return Err(AppError::PortInUse {
                    service_name: service.name.clone(),
                    port,
                });
            }
        }
        return Ok(ResolvedSpawn {
            port: service.port,
            args: service.args.clone(),
            env: service.env.clone(),
        });
    }

    let base = service.port.unwrap_or(AUTO_PORT_DEFAULT_BASE);
    let chosen =
        find_free_port_from(base, AUTO_PORT_MAX_ATTEMPTS).ok_or_else(|| AppError::NoFreePort {
            service_name: service.name.clone(),
            base,
            tried: AUTO_PORT_MAX_ATTEMPTS,
        })?;

    let value = chosen.to_string();
    let substitute = |text: &str| text.replace("{port}", &value);

    let args = service.args.iter().map(|arg| substitute(arg)).collect();

    let mut env: HashMap<String, String> = service
        .env
        .iter()
        .map(|(key, val)| (key.clone(), substitute(val)))
        .collect();

    let var_name = service
        .port_env_var
        .as_deref()
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .unwrap_or(DEFAULT_PORT_ENV_VAR);
    // The injected port wins over any same-named value the user set, since the
    // whole point of auto-port is that Muxly owns which port is used.
    env.insert(var_name.to_string(), value);

    Ok(ResolvedSpawn {
        port: Some(chosen),
        args,
        env,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;

    fn service(port: Option<u16>, auto: bool) -> ServiceConfig {
        ServiceConfig {
            id: "svc".into(),
            name: "Svc".into(),
            icon: None,
            program: "node".into(),
            args: vec!["server.js".into(), "--port".into(), "{port}".into()],
            cwd: ".".into(),
            env: HashMap::from([("DEV_URL".into(), "http://localhost:{port}".into())]),
            port,
            auto_port: auto,
            port_env_var: None,
            group: None,
            profile: None,
            auto_restart: false,
            use_pty: false,
            pre_run: None,
            sensitive: false,
        }
    }

    #[test]
    fn non_auto_leaves_args_and_env_untouched() {
        // Auto-port off: no substitution, `{port}` stays literal, no PORT added.
        let resolved = resolve_spawn(&service(None, false)).unwrap();
        assert_eq!(resolved.port, None);
        assert!(resolved.args.iter().any(|a| a == "{port}"));
        assert!(!resolved.env.contains_key("PORT"));
        assert_eq!(resolved.env.get("DEV_URL").unwrap(), "http://localhost:{port}");
    }

    #[test]
    fn auto_injects_and_substitutes() {
        let resolved = resolve_spawn(&service(Some(3000), true)).unwrap();
        let chosen = resolved.port.expect("auto-port picks a port");
        assert!(chosen >= 3000);
        assert_eq!(resolved.env.get("PORT").unwrap(), &chosen.to_string());
        assert!(resolved.args.iter().any(|a| a == &chosen.to_string()));
        assert_eq!(
            resolved.env.get("DEV_URL").unwrap(),
            &format!("http://localhost:{chosen}")
        );
    }

    #[test]
    fn auto_rolls_past_a_busy_preferred_port() {
        // Hold a port, then ask auto-port to start there — it must pick a higher one.
        let held = TcpListener::bind(("0.0.0.0", 0)).unwrap();
        let busy = held.local_addr().unwrap().port();
        let resolved = resolve_spawn(&service(Some(busy), true)).unwrap();
        assert_ne!(resolved.port, Some(busy));
        assert!(resolved.port.unwrap() > busy);
    }
}
