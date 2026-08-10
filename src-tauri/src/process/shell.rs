//! Shell-prelude wrapping for services with a non-empty `preRun`.
//!
//! Some setup steps must run in the *same shell* as the service command for
//! their effect to carry over — `nvm use 20`, `source .venv/bin/activate`,
//! `conda activate`, etc. all mutate the current shell's environment, so
//! running them as a separate process before the main spawn would change a
//! throwaway shell and leave the real command untouched. To make them work we
//! wrap the spawn in one shell invocation and chain with `&&`:
//!
//! ```text
//! $SHELL -lc "<pre_run> && <program> <args…>"  # Unix
//! cmd    /c  "<pre_run> && <program> <args…>"  # Windows
//! ```
//!
//! The Unix side runs the *user's* login shell rather than a hardcoded `bash`.
//! macOS has defaulted to zsh since Catalina, so shell syntax and login-profile
//! setup must be interpreted by that shell. This invocation is deliberately
//! non-interactive: it reads login profiles such as `~/.zprofile`, but not
//! interactive files such as `~/.zshrc`. A prelude that needs nvm or another
//! interactive-only hook must source it explicitly; making unattended services
//! execute arbitrary interactive startup files can add prompts, aliases, or
//! terminal output that destabilises launching.
//!
//! Quoting is intentionally minimal: the prelude, program, and args are joined
//! with spaces into one line handed to the shell as a single argument. The
//! caller's argv-quoting (std `Command` / portable_pty) wraps that whole line
//! in quotes; on Windows `cmd /c "<line>"` then strips the outer quotes because
//! the line contains `&&` (a special char), running `<line>` verbatim. The
//! common cases (`nvm use 20 && npm run dev`, `npm ci && npm run dev`) need no
//! per-token quoting. Program/arg *tokens* that themselves contain spaces must
//! be quoted by the user inside the field — a documented limitation, kept this
//! way because layering our own cmd-vs-bash escaping on top of the runtime's is
//! where this kind of code goes subtly wrong.

/// Build the `(program, args)` to spawn for a service whose `pre_run` prelude
/// is set. Returns a shell invocation that runs the prelude and the real
/// command in one shell. Callers only reach this when `pre_run` is non-empty;
/// an empty prelude keeps the direct-spawn path.
pub fn shell_prelude_command(
    pre_run: &str,
    program: &str,
    args: &[String],
) -> (String, Vec<String>) {
    let mut line = String::from(pre_run.trim());
    line.push_str(" && ");
    line.push_str(program);
    for arg in args {
        line.push(' ');
        line.push_str(arg);
    }

    if cfg!(windows) {
        ("cmd".to_string(), vec!["/c".to_string(), line])
    } else {
        (login_shell(), vec!["-lc".to_string(), line])
    }
}

/// The shell to run a prelude in on Unix: `$SHELL` when the environment tells
/// us what the user actually uses, else a per-platform default.
///
/// The fallback differs by platform because the *installed* shell differs:
/// macOS ships zsh as the login shell and its bash is a 2007 build kept for
/// licensing reasons, while Linux distributions overwhelmingly default to bash.
/// `$SHELL` is missing in practice mainly when the app is launched by a GUI
/// session rather than from a terminal, which is the common case for a bundled
/// `.app` — so the fallback is load-bearing, not just defensive.
#[cfg(not(windows))]
fn login_shell() -> String {
    let configured = std::env::var("SHELL")
        .ok()
        .map(|shell| shell.trim().to_string())
        .filter(|shell| !shell.is_empty());

    configured.unwrap_or_else(login_shell_fallback)
}

#[cfg(not(windows))]
fn login_shell_fallback() -> String {
    if cfg!(target_os = "macos") {
        "/bin/zsh".to_string()
    } else {
        "/bin/bash".to_string()
    }
}

#[cfg(windows)]
fn login_shell() -> String {
    // Unreachable — `shell_prelude_command` takes the `cmd /c` branch on
    // Windows — but defined so the call site type-checks on every platform.
    "cmd".to_string()
}

/// The trimmed prelude if it is non-empty, else `None`. Centralises the
/// "is there actually a prelude?" check both spawn paths share.
pub fn active_prelude(pre_run: &Option<String>) -> Option<&str> {
    pre_run
        .as_deref()
        .map(str::trim)
        .filter(|prelude| !prelude.is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn active_prelude_treats_blank_as_none() {
        assert_eq!(active_prelude(&None), None);
        assert_eq!(active_prelude(&Some("".to_string())), None);
        assert_eq!(active_prelude(&Some("   ".to_string())), None);
        assert_eq!(
            active_prelude(&Some("nvm use 20".to_string())),
            Some("nvm use 20")
        );
    }

    #[test]
    fn shell_prelude_chains_prelude_and_command() {
        let (program, args) =
            shell_prelude_command("nvm use 20", "npm", &["run".to_string(), "dev".to_string()]);

        let expected_program = if cfg!(windows) {
            "cmd".to_string()
        } else {
            super::login_shell()
        };
        let expected_flag = if cfg!(windows) { "/c" } else { "-lc" };

        assert_eq!(program, expected_program);
        assert_eq!(args[0], expected_flag);
        assert_eq!(args[1], "nvm use 20 && npm run dev");
    }

    /// The prelude must land in the shell the user configured, not a hardcoded
    /// bash — that is the whole point of running it as a login shell.
    #[test]
    #[cfg(not(windows))]
    fn shell_prelude_uses_the_configured_login_shell() {
        let Ok(configured) = std::env::var("SHELL") else {
            return;
        };
        if configured.trim().is_empty() {
            return;
        }

        let (program, _) = shell_prelude_command("nvm use 20", "npm", &[]);

        assert_eq!(program, configured.trim());
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn login_shell_falls_back_to_zsh_on_macos() {
        // A bundled .app launched from Finder can come up without SHELL set;
        // macOS's bash is ancient and unconfigured, so zsh is the right guess.
        assert_eq!(
            super::login_shell_fallback(),
            "/bin/zsh",
            "macOS default login shell"
        );
    }
}
