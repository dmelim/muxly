use crate::runtime::{resolve_from_fallbacks, search_paths};
use serde::Serialize;
use std::path::PathBuf;
use tauri::AppHandle;

#[derive(Clone, Serialize)]
pub struct ShellProfile {
    pub id: String,
    pub label: String,
    #[serde(skip)]
    pub program: String,
    #[serde(skip)]
    pub args: Vec<String>,
}

#[tauri::command(async)]
pub fn discover_shells(app: AppHandle) -> Vec<ShellProfile> {
    profiles(&app)
}

pub fn profiles(app: &AppHandle) -> Vec<ShellProfile> {
    let paths = search_paths(app);
    let mut profiles = Vec::new();
    let mut add = |id: &str, label: &str, program: PathBuf, args: &[&str]| {
        if program.is_file() {
            profiles.push(ShellProfile {
                id: id.into(), label: label.into(),
                program: program.to_string_lossy().into_owned(),
                args: args.iter().map(|arg| (*arg).into()).collect(),
            });
        }
    };
    if cfg!(windows) {
        let windows = PathBuf::from(std::env::var_os("SystemRoot").unwrap_or_else(|| "C:\\Windows".into()));
        add("powershell", "Windows PowerShell", windows.join("System32/WindowsPowerShell/v1.0/powershell.exe"), &["-NoLogo"]);
        add("cmd", "Command Prompt", windows.join("System32/cmd.exe"), &[]);
        let program_files = PathBuf::from(std::env::var_os("ProgramFiles").unwrap_or_else(|| "C:\\Program Files".into()));
        let pwsh = resolve_from_fallbacks("pwsh", &paths).unwrap_or_else(|| program_files.join("PowerShell/7/pwsh.exe"));
        add("pwsh", "PowerShell 7", pwsh, &["-NoLogo"]);
        let mut git_candidates = vec![program_files.join("Git/bin/bash.exe")];
        if let Some(local) = std::env::var_os("LOCALAPPDATA") {
            git_candidates.push(PathBuf::from(local).join("Programs/Git/bin/bash.exe"));
        }
        if let Some(git) = resolve_from_fallbacks("git", &paths) {
            if let Some(root) = git.parent().and_then(|parent| parent.parent()) {
                git_candidates.push(root.join("bin/bash.exe"));
            }
        }
        if let Some(bash) = git_candidates.into_iter().find(|path| path.is_file()) {
            add("git-bash", "Git Bash", bash, &["--login", "-i"]);
        }
    } else {
        for (id, label) in [("bash", "Bash"), ("zsh", "Zsh"), ("fish", "Fish"), ("sh", "POSIX shell")] {
            if let Some(program) = resolve_from_fallbacks(id, &paths) {
                let args: &[&str] = if cfg!(target_os = "macos") { &["-l"] } else { &[] };
                add(id, label, program, args);
            }
        }
    }
    profiles
}
