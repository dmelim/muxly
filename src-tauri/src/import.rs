//! Scan a project directory for runnable processes and turn them into
//! importable service candidates. Two sources are supported:
//!
//! * `package.json` — every entry under `scripts` becomes `<pm> run <name>`,
//!   where `<pm>` is detected from the lockfile (npm / pnpm / yarn / bun).
//! * `Procfile` — every `name: command` line is split into program + args.
//!
//! The frontend turns the chosen candidates into full `ServiceConfig`s.

use crate::error::AppError;
use serde::Serialize;
use std::{fs, path::Path};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportCandidate {
    /// Where the candidate came from: "package.json" or "Procfile".
    pub source: String,
    pub suggested_id: String,
    pub name: String,
    pub program: String,
    pub args: Vec<String>,
    /// Absolute working directory the service should run in (the scanned dir).
    pub cwd: String,
    /// True for long-running entries (dev/start/serve scripts, all Procfile
    /// lines) — the import UI pre-selects these so pointing at a repo yields
    /// the right service without hand-picking.
    pub recommended: bool,
}

#[tauri::command]
pub fn scan_importable(dir: String) -> Result<Vec<ImportCandidate>, AppError> {
    let base = Path::new(&dir);
    if !base.is_dir() {
        return Err(AppError::PathResolve {
            action: "scan project directory",
            message: format!("{dir} is not a directory"),
        });
    }

    let mut candidates = scan_package_json(base, &dir)?;
    candidates.extend(scan_procfile(base, &dir)?);
    Ok(candidates)
}

fn scan_package_json(base: &Path, dir: &str) -> Result<Vec<ImportCandidate>, AppError> {
    let path = base.join("package.json");
    if !path.is_file() {
        return Ok(Vec::new());
    }

    let text = fs::read_to_string(&path).map_err(|source| AppError::IoPath {
        action: "read",
        path: path.clone(),
        source,
    })?;
    let json: serde_json::Value =
        serde_json::from_str(&text).map_err(|source| AppError::ConfigParse {
            path: path.clone(),
            source,
        })?;

    let program = detect_package_manager(base);
    let mut candidates = Vec::new();

    if let Some(scripts) = json.get("scripts").and_then(|v| v.as_object()) {
        for script_name in scripts.keys() {
            candidates.push(ImportCandidate {
                source: "package.json".to_string(),
                suggested_id: slug(script_name),
                name: format!("{program} {script_name}"),
                program: program.to_string(),
                args: vec!["run".to_string(), script_name.clone()],
                cwd: dir.to_string(),
                recommended: is_long_running_script(script_name),
            });
        }
    }

    Ok(candidates)
}

fn scan_procfile(base: &Path, dir: &str) -> Result<Vec<ImportCandidate>, AppError> {
    let path = base.join("Procfile");
    if !path.is_file() {
        return Ok(Vec::new());
    }

    let text = fs::read_to_string(&path).map_err(|source| AppError::IoPath {
        action: "read",
        path: path.clone(),
        source,
    })?;

    let mut candidates = Vec::new();
    for raw_line in text.lines() {
        let line = raw_line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }

        let Some((name, command)) = line.split_once(':') else {
            continue;
        };
        let name = name.trim();
        let command = command.trim();
        if name.is_empty() || command.is_empty() {
            continue;
        }

        // Naive whitespace tokenisation. Procfiles rarely quote arguments;
        // anything more exotic can be fixed up in the import form.
        let mut tokens = command.split_whitespace();
        let Some(program) = tokens.next() else {
            continue;
        };

        candidates.push(ImportCandidate {
            source: "Procfile".to_string(),
            suggested_id: slug(name),
            name: name.to_string(),
            program: program.to_string(),
            args: tokens.map(|t| t.to_string()).collect(),
            cwd: dir.to_string(),
            // Procfile lines are process definitions by nature.
            recommended: true,
        });
    }

    Ok(candidates)
}

/// Heuristic: is this npm script a long-running process (a dev server) rather
/// than a one-shot task (build, test, lint)? Matches on the leading word so
/// `dev`, `dev:web`, `start-server` all qualify.
fn is_long_running_script(name: &str) -> bool {
    let lower = name.to_lowercase();
    let head = lower
        .split(|c| c == ':' || c == '-' || c == '_' || c == ' ')
        .next()
        .unwrap_or("");
    matches!(head, "dev" | "start" | "serve" | "server" | "watch" | "develop")
}

fn detect_package_manager(base: &Path) -> &'static str {
    if base.join("pnpm-lock.yaml").is_file() {
        "pnpm"
    } else if base.join("yarn.lock").is_file() {
        "yarn"
    } else if base.join("bun.lockb").is_file() || base.join("bun.lock").is_file() {
        "bun"
    } else {
        "npm"
    }
}

/// Lowercase, collapse runs of non-alphanumeric characters to single dashes,
/// trim leading/trailing dashes. Falls back to "service" if nothing survives.
fn slug(input: &str) -> String {
    let mut out = String::new();
    let mut pending_dash = false;

    for ch in input.chars() {
        if ch.is_ascii_alphanumeric() {
            if pending_dash && !out.is_empty() {
                out.push('-');
            }
            out.push(ch.to_ascii_lowercase());
            pending_dash = false;
        } else {
            pending_dash = true;
        }
    }

    if out.is_empty() {
        "service".to_string()
    } else {
        out
    }
}

#[cfg(test)]
mod tests {
    use super::{is_long_running_script, slug};

    #[test]
    fn slug_normalises_names() {
        assert_eq!(slug("dev"), "dev");
        assert_eq!(slug("Build:CSS"), "build-css");
        assert_eq!(slug("  start server  "), "start-server");
        assert_eq!(slug("test:e2e:ci"), "test-e2e-ci");
        assert_eq!(slug("!!!"), "service");
    }

    #[test]
    fn long_running_scripts_are_recommended() {
        for name in ["dev", "start", "serve", "watch", "dev:web", "start-server"] {
            assert!(is_long_running_script(name), "{name} should be recommended");
        }
        for name in ["build", "test", "lint", "typecheck", "build:css"] {
            assert!(!is_long_running_script(name), "{name} should not be");
        }
    }
}
