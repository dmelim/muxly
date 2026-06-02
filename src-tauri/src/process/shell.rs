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
//! bash -lc "<pre_run> && <program> <args…>"   # Unix
//! cmd  /c  "<pre_run> && <program> <args…>"    # Windows
//! ```
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
pub fn shell_prelude_command(pre_run: &str, program: &str, args: &[String]) -> (String, Vec<String>) {
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
        ("bash".to_string(), vec!["-lc".to_string(), line])
    }
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
        let (program, args) = shell_prelude_command(
            "nvm use 20",
            "npm",
            &["run".to_string(), "dev".to_string()],
        );

        let expected_program = if cfg!(windows) { "cmd" } else { "bash" };
        let expected_flag = if cfg!(windows) { "/c" } else { "-lc" };

        assert_eq!(program, expected_program);
        assert_eq!(args[0], expected_flag);
        assert_eq!(args[1], "nvm use 20 && npm run dev");
    }
}
