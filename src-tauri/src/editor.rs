//! Bounded discovery for graphical editors available to Muxly.
//!
//! Discovery only inspects PATH and a small set of conventional application
//! directories. It never runs a candidate, invokes a shell, or scans a whole
//! filesystem. The result is cached in app state and can be explicitly
//! refreshed from Settings.

use crate::{error::AppError, runtime::search_paths};
use parking_lot::Mutex;
use serde::Serialize;
use std::{
    env, fs,
    path::{Path, PathBuf},
};
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorCandidate {
    pub id: String,
    pub label: String,
    pub command: String,
    pub path: Option<String>,
}

#[derive(Default)]
pub struct EditorDiscoveryCache(Mutex<Option<Vec<EditorCandidate>>>);

#[derive(Clone, Copy)]
struct EditorSpec {
    id: &'static str,
    label: &'static str,
    commands: &'static [&'static str],
}

const EDITOR_SPECS: &[EditorSpec] = &[
    EditorSpec {
        id: "vscode",
        label: "VS Code",
        commands: &["code", "code.cmd"],
    },
    EditorSpec {
        id: "vscode-insiders",
        label: "VS Code Insiders",
        commands: &["code-insiders", "code-insiders.cmd"],
    },
    EditorSpec {
        id: "cursor",
        label: "Cursor",
        commands: &["cursor", "cursor.cmd"],
    },
    EditorSpec {
        id: "windsurf",
        label: "Windsurf",
        commands: &["windsurf", "windsurf.cmd"],
    },
    EditorSpec {
        id: "zed",
        label: "Zed",
        commands: &["zed", "zed.exe"],
    },
    EditorSpec {
        id: "sublime",
        label: "Sublime Text",
        commands: &["subl", "subl.exe", "sublime_text"],
    },
    EditorSpec {
        id: "notepad++",
        label: "Notepad++",
        commands: &["notepad++", "notepad++.exe"],
    },
    EditorSpec {
        id: "intellij",
        label: "IntelliJ IDEA",
        commands: &["idea", "idea64.exe"],
    },
    EditorSpec {
        id: "pycharm",
        label: "PyCharm",
        commands: &["pycharm", "pycharm64.exe"],
    },
    EditorSpec {
        id: "webstorm",
        label: "WebStorm",
        commands: &["webstorm", "webstorm64.exe"],
    },
    EditorSpec {
        id: "rider",
        label: "Rider",
        commands: &["rider", "rider64.exe"],
    },
    EditorSpec {
        id: "clion",
        label: "CLion",
        commands: &["clion", "clion64.exe"],
    },
    EditorSpec {
        id: "goland",
        label: "GoLand",
        commands: &["goland", "goland64.exe"],
    },
    EditorSpec {
        id: "datagrip",
        label: "DataGrip",
        commands: &["datagrip", "datagrip64.exe"],
    },
    EditorSpec {
        id: "rubymine",
        label: "RubyMine",
        commands: &["rubymine", "rubymine64.exe"],
    },
    EditorSpec {
        id: "phpstorm",
        label: "PhpStorm",
        commands: &["phpstorm", "phpstorm64.exe"],
    },
    EditorSpec {
        id: "rustrover",
        label: "RustRover",
        commands: &["rustrover", "rustrover64.exe"],
    },
];

/// Discover editors without making app startup wait. The blocking work,
/// including the bounded login-shell PATH lookup on Unix, runs on Tauri's
/// blocking pool.
#[tauri::command]
pub async fn discover_editors(
    app: AppHandle,
    force_rescan: Option<bool>,
) -> Result<Vec<EditorCandidate>, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        // Keep the cache check and scan in one blocking critical section so
        // concurrent callers reuse the first completed discovery.
        let cache = app.state::<EditorDiscoveryCache>();
        let mut stored = cache.0.lock();
        if !force_rescan.unwrap_or(false) {
            if let Some(candidates) = stored.as_ref() {
                return candidates.clone();
            }
        }
        let candidates = discover_for_app(&app);
        *stored = Some(candidates.clone());
        candidates
    })
    .await
    .map_err(|error| AppError::ConfigUnavailable(format!("Editor discovery failed: {error}")))
}

fn discover_for_app(app: &AppHandle) -> Vec<EditorCandidate> {
    let mut search_dirs = search_paths(app);
    if let Some(path) = env::var_os("PATH") {
        search_dirs.extend(env::split_paths(&path));
    }
    search_dirs.retain(|path| path.is_dir());
    dedup_paths(&mut search_dirs);

    let standard_paths = standard_paths();
    discover_from_dirs(&search_dirs, &standard_paths, true)
}

/// Resolve legacy bare commands using the same bounded discovery as Settings.
/// Explicit paths are never replaced with a different installation.
pub fn resolve_known_editor(app: &AppHandle, program: &str) -> Option<PathBuf> {
    let id = known_editor_id(program)?;
    let cache = app.state::<EditorDiscoveryCache>();
    let mut stored = cache.0.lock();
    let candidates = stored.get_or_insert_with(|| discover_for_app(app));
    candidates
        .iter()
        .find(|candidate| candidate.id == id)
        .map(|candidate| PathBuf::from(&candidate.command))
}

fn known_editor_id(program: &str) -> Option<&'static str> {
    if program.contains(['/', '\\']) {
        return None;
    }
    EDITOR_SPECS
        .iter()
        .find(|spec| {
            spec.commands.iter().any(|alias| {
                #[cfg(windows)]
                {
                    let strip = |value: &str| {
                        let value = value.to_ascii_lowercase();
                        [".exe", ".cmd", ".bat", ".com"]
                            .iter()
                            .find_map(|suffix| value.strip_suffix(suffix).map(str::to_owned))
                            .unwrap_or(value)
                    };
                    strip(alias) == strip(program)
                }
                #[cfg(not(windows))]
                {
                    *alias == program
                }
            })
        })
        .map(|spec| spec.id)
}

fn discover_from_dirs(
    search_dirs: &[PathBuf],
    standard_paths: &[(String, PathBuf)],
    allow_bounded_standard_scan: bool,
) -> Vec<EditorCandidate> {
    let mut result = Vec::new();
    let mut seen_paths = Vec::<PathBuf>::new();

    for spec in EDITOR_SPECS {
        let path = find_in_dirs(spec.commands, search_dirs)
            .or_else(|| {
                standard_paths
                    .iter()
                    .filter(|(id, _)| id == spec.id)
                    .find_map(|(_, path)| usable_target(path))
            })
            .or_else(|| {
                allow_bounded_standard_scan
                    .then(|| bounded_standard_editor(spec))
                    .flatten()
            })
            .or_else(|| {
                #[cfg(windows)]
                {
                    find_shell_shim_in_dirs(spec.commands, search_dirs)
                }
                #[cfg(not(windows))]
                {
                    None
                }
            });

        let Some(path) = path else { continue };
        let canonical = canonical_or_original(&path);
        if seen_paths
            .iter()
            .any(|existing| paths_equal(existing, &canonical))
        {
            continue;
        }
        seen_paths.push(canonical.clone());
        let command = canonical.to_string_lossy().into_owned();
        result.push(EditorCandidate {
            id: spec.id.to_string(),
            label: spec.label.to_string(),
            command,
            path: Some(canonical.to_string_lossy().into_owned()),
        });
    }

    result
}

fn find_in_dirs(commands: &[&str], dirs: &[PathBuf]) -> Option<PathBuf> {
    #[cfg(windows)]
    {
        // Keep shell shims as the final fallback. A real executable in a
        // bounded standard install location should win over a PATH shim.
        return find_in_dirs_pass(commands, dirs, true);
    }

    #[cfg(not(windows))]
    find_in_dirs_pass(commands, dirs, false)
}

#[cfg(windows)]
fn find_shell_shim_in_dirs(commands: &[&str], dirs: &[PathBuf]) -> Option<PathBuf> {
    find_in_dirs_pass(commands, dirs, false).filter(|path| is_shell_shim(path))
}

fn find_in_dirs_pass(
    commands: &[&str],
    dirs: &[PathBuf],
    prefer_gui_executable: bool,
) -> Option<PathBuf> {
    #[cfg(not(windows))]
    let _ = prefer_gui_executable;
    for command in commands {
        let path = Path::new(command);
        if path.is_absolute() {
            #[cfg(windows)]
            if prefer_gui_executable && is_shell_shim(path) {
                continue;
            }
            if let Some(found) = usable_target(path) {
                return Some(found);
            }
            continue;
        }
        for dir in dirs {
            for variant in executable_variants(command) {
                #[cfg(windows)]
                if prefer_gui_executable && is_shell_shim(Path::new(&variant)) {
                    continue;
                }
                if let Some(found) = usable_target(&dir.join(variant)) {
                    return Some(found);
                }
            }
        }
    }
    None
}

fn usable_target(path: &Path) -> Option<PathBuf> {
    if is_launch_target(path) {
        Some(path.to_path_buf())
    } else {
        None
    }
}

fn is_launch_target(path: &Path) -> bool {
    #[cfg(target_os = "macos")]
    if path
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("app"))
    {
        return path.is_dir();
    }
    let Ok(metadata) = fs::metadata(path) else {
        return false;
    };
    if !metadata.is_file() {
        return false;
    }
    #[cfg(windows)]
    {
        // VS Code installs both a Unix `code` script and `code.cmd` in bin.
        // The extensionless script cannot be executed by CreateProcess.
        path.extension()
            .and_then(|value| value.to_str())
            .is_some_and(|extension| {
                ["exe", "com", "cmd", "bat"]
                    .iter()
                    .any(|known| extension.eq_ignore_ascii_case(known))
            })
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        metadata.permissions().mode() & 0o111 != 0
    }
}

fn canonical_or_original(path: &Path) -> PathBuf {
    let canonical = fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    #[cfg(windows)]
    {
        // Keep launch commands readable and compatible with cmd.exe. Rust's
        // canonicalize may return an extended `\\?\` path which ordinary GUI
        // launchers and shell shims do not consistently accept.
        let text = canonical.to_string_lossy();
        if let Some(unc) = text.strip_prefix(r"\\?\UNC\") {
            return PathBuf::from(format!(r"\\{}", unc));
        }
        if let Some(stripped) = text.strip_prefix(r"\\?\") {
            return PathBuf::from(stripped);
        }
    }
    canonical
}

fn dedup_paths(paths: &mut Vec<PathBuf>) {
    let mut seen: Vec<PathBuf> = Vec::new();
    paths.retain(|path| {
        let canonical = canonical_or_original(path);
        if seen
            .iter()
            .any(|existing| paths_equal(existing, &canonical))
        {
            false
        } else {
            seen.push(canonical);
            true
        }
    });
}

fn paths_equal(left: &Path, right: &Path) -> bool {
    #[cfg(windows)]
    {
        left.to_string_lossy()
            .eq_ignore_ascii_case(&right.to_string_lossy())
    }
    #[cfg(not(windows))]
    {
        left == right
    }
}

#[cfg(windows)]
fn executable_variants(command: &str) -> Vec<String> {
    let has_extension = Path::new(command).extension().is_some();
    if has_extension {
        vec![command.to_string()]
    } else {
        vec![
            command.to_string(),
            format!("{command}.exe"),
            format!("{command}.cmd"),
            format!("{command}.bat"),
        ]
    }
}

#[cfg(windows)]
fn is_shell_shim(path: &Path) -> bool {
    matches!(
        path.extension().and_then(|extension| extension.to_str()),
        Some(extension) if extension.eq_ignore_ascii_case("cmd") || extension.eq_ignore_ascii_case("bat")
    )
}

#[cfg(not(windows))]
fn executable_variants(command: &str) -> Vec<String> {
    vec![command.to_string()]
}

fn standard_paths() -> Vec<(String, PathBuf)> {
    let mut paths = Vec::new();

    #[cfg(windows)]
    {
        let local = env::var_os("LOCALAPPDATA").map(PathBuf::from);
        let program_files = env::var_os("ProgramFiles").map(PathBuf::from);
        let program_files_x86 = env::var_os("ProgramFiles(x86)").map(PathBuf::from);
        push_child(
            &mut paths,
            "vscode",
            local.as_deref(),
            &["Programs", "Microsoft VS Code", "Code.exe"],
        );
        push_child(
            &mut paths,
            "vscode",
            program_files.as_deref(),
            &["Microsoft VS Code", "Code.exe"],
        );
        push_child(
            &mut paths,
            "vscode-insiders",
            local.as_deref(),
            &[
                "Programs",
                "Microsoft VS Code Insiders",
                "Code - Insiders.exe",
            ],
        );
        push_child(
            &mut paths,
            "cursor",
            local.as_deref(),
            &["Programs", "cursor", "Cursor.exe"],
        );
        push_child(
            &mut paths,
            "windsurf",
            local.as_deref(),
            &["Programs", "Windsurf", "Windsurf.exe"],
        );
        push_child(
            &mut paths,
            "zed",
            local.as_deref(),
            &["Programs", "Zed", "Zed.exe"],
        );
        push_child(
            &mut paths,
            "sublime",
            program_files.as_deref(),
            &["Sublime Text", "sublime_text.exe"],
        );
        push_child(
            &mut paths,
            "sublime",
            program_files_x86.as_deref(),
            &["Sublime Text", "sublime_text.exe"],
        );
        push_child(
            &mut paths,
            "notepad++",
            program_files.as_deref(),
            &["Notepad++", "notepad++.exe"],
        );
        push_child(
            &mut paths,
            "notepad++",
            program_files_x86.as_deref(),
            &["Notepad++", "notepad++.exe"],
        );
    }

    #[cfg(target_os = "macos")]
    {
        for (id, app_name) in [
            ("vscode", "Visual Studio Code.app"),
            ("vscode-insiders", "Visual Studio Code - Insiders.app"),
            ("cursor", "Cursor.app"),
            ("windsurf", "Windsurf.app"),
            ("zed", "Zed.app"),
            ("sublime", "Sublime Text.app"),
        ] {
            paths.push((
                id.to_string(),
                PathBuf::from("/Applications").join(app_name),
            ));
            if let Some(home) = env::var_os("HOME") {
                paths.push((
                    id.to_string(),
                    PathBuf::from(home).join("Applications").join(app_name),
                ));
            }
        }
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let mut dirs = vec![
            PathBuf::from("/usr/bin"),
            PathBuf::from("/usr/local/bin"),
            PathBuf::from("/opt/bin"),
            PathBuf::from("/snap/bin"),
            PathBuf::from("/var/lib/flatpak/exports/bin"),
        ];
        if let Some(home) = env::var_os("HOME") {
            dirs.push(PathBuf::from(home).join(".local/bin"));
            dirs.push(PathBuf::from(home).join("bin"));
        }
        for spec in EDITOR_SPECS {
            for dir in &dirs {
                for command in spec.commands {
                    paths.push((spec.id.to_string(), dir.join(command)));
                }
            }
        }
    }

    paths
}

#[cfg(windows)]
fn push_child(paths: &mut Vec<(String, PathBuf)>, id: &str, base: Option<&Path>, pieces: &[&str]) {
    if let Some(base) = base {
        let mut path = base.to_path_buf();
        for piece in pieces {
            path.push(piece);
        }
        paths.push((id.to_string(), path));
    }
}

#[cfg(windows)]
fn bounded_standard_editor(spec: &EditorSpec) -> Option<PathBuf> {
    if !matches!(
        spec.id,
        "intellij"
            | "pycharm"
            | "webstorm"
            | "rider"
            | "clion"
            | "goland"
            | "datagrip"
            | "rubymine"
            | "phpstorm"
            | "rustrover"
    ) {
        return None;
    }

    let mut roots = Vec::new();
    for variable in ["LOCALAPPDATA", "ProgramFiles", "ProgramFiles(x86)"] {
        if let Some(value) = env::var_os(variable) {
            let base = PathBuf::from(value);
            roots.push(base.join("JetBrains"));
            roots.push(base.join(r"JetBrains\Installations"));
        }
    }
    bounded_find(&roots, spec.commands)
}

#[cfg(not(windows))]
fn bounded_standard_editor(_spec: &EditorSpec) -> Option<PathBuf> {
    None
}

#[cfg(windows)]
fn bounded_find(roots: &[PathBuf], commands: &[&str]) -> Option<PathBuf> {
    use std::collections::VecDeque;
    let mut queue = VecDeque::new();
    for root in roots {
        if root.is_dir() {
            queue.push_back((root.clone(), 0u8));
        }
    }
    let mut visited = 0usize;
    while let Some((directory, depth)) = queue.pop_front() {
        if visited >= 512 {
            break;
        }
        let Ok(entries) = fs::read_dir(&directory) else {
            continue;
        };
        for entry in entries.flatten().take(64) {
            visited += 1;
            let path = entry.path();
            if path.is_file()
                && commands
                    .iter()
                    .any(|command| file_name_matches(&path, command))
            {
                return Some(path);
            }
            if depth < 3 && path.is_dir() {
                queue.push_back((path, depth + 1));
            }
            if visited >= 512 {
                break;
            }
        }
    }
    None
}

#[cfg(windows)]
fn file_name_matches(path: &Path, command: &str) -> bool {
    path.file_name()
        .map(|name| name.to_string_lossy().eq_ignore_ascii_case(command))
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::discover_from_dirs;

    #[test]
    fn legacy_aliases_never_replace_explicit_installations() {
        assert_eq!(super::known_editor_id("code"), Some("vscode"));
        assert_eq!(
            super::known_editor_id("code-insiders"),
            Some("vscode-insiders")
        );
        assert_eq!(super::known_editor_id("/portable/code"), None);
        assert_eq!(super::known_editor_id("C:\\Portable\\Code.exe"), None);
        assert_eq!(super::known_editor_id("unknown-editor"), None);
        #[cfg(windows)]
        assert_eq!(super::known_editor_id("CODE.CMD"), Some("vscode"));
    }

    #[cfg(unix)]
    use std::os::unix::fs::PermissionsExt;

    #[test]
    fn discovery_returns_only_existing_path_entries() {
        let root = std::env::temp_dir().join(format!(
            "muxly-editor-discovery-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("clock")
                .as_nanos()
        ));
        std::fs::create_dir_all(&root).expect("create fixture");
        let code = root.join(if cfg!(windows) { "code.exe" } else { "code" });
        std::fs::write(&code, b"fixture").expect("write fixture");
        #[cfg(unix)]
        {
            let mut permissions = std::fs::metadata(&code).expect("metadata").permissions();
            permissions.set_mode(0o755);
            std::fs::set_permissions(&code, permissions).expect("permissions");
        }

        let candidates = discover_from_dirs(&[root.clone()], &[], false);
        assert!(candidates.iter().any(|candidate| candidate.id == "vscode"));
        assert!(!candidates.iter().any(|candidate| candidate.id == "cursor"));
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn discovery_checks_all_matching_standard_paths() {
        let root = std::env::temp_dir().join(format!(
            "muxly-editor-standard-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("clock")
                .as_nanos()
        ));
        std::fs::create_dir_all(&root).expect("create fixture");
        let missing = root.join("missing-code");
        let installed = root.join(if cfg!(windows) {
            "installed-code.exe"
        } else {
            "installed-code"
        });
        std::fs::write(&installed, b"fixture").expect("write fixture");
        #[cfg(unix)]
        {
            let mut permissions = std::fs::metadata(&installed)
                .expect("metadata")
                .permissions();
            permissions.set_mode(0o755);
            std::fs::set_permissions(&installed, permissions).expect("permissions");
        }

        let standard = vec![
            ("vscode".to_string(), missing),
            ("vscode".to_string(), installed),
        ];
        let candidates = discover_from_dirs(&[], &standard, false);
        assert_eq!(
            candidates
                .iter()
                .filter(|candidate| candidate.id == "vscode")
                .count(),
            1
        );
        let _ = std::fs::remove_dir_all(root);
    }
    #[test]
    fn rejects_non_launchable_path_files() {
        let root =
            std::env::temp_dir().join(format!("muxly-editor-invalid-{}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        let script = root.join("code");
        std::fs::write(&script, b"#!/bin/sh\n").unwrap();
        #[cfg(unix)]
        std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o644)).unwrap();
        assert!(!super::is_launch_target(&script));
        #[cfg(windows)]
        {
            let shim = root.join("code.cmd");
            std::fs::write(&shim, b"@echo off").unwrap();
            let found = discover_from_dirs(&[root.clone()], &[], false);
            assert!(found
                .iter()
                .any(|editor| editor.id == "vscode" && editor.command.ends_with("code.cmd")));
        }
        std::fs::remove_dir_all(root).unwrap();
    }
}
