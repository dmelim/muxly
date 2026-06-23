# muxly-register-service (Agent Skill)

An [Agent Skill](https://docs.claude.com/en/docs/claude-code/skills) that lets an
AI coding agent register a local project as a service in Muxly: it discovers the
long-running command, locates the `com.diethos.muxly` runtime `services.json`,
and safely appends a service entry.

The skill is **agent-agnostic**. The procedure lives in `SKILL.md` (standard
`name` + `description` frontmatter) and the writes are done by plain shell
helpers in `scripts/`, so any Agent-Skills-compatible tool — Claude Code, Codex,
or others — can use it.

## Layout

```
muxly-register-service/
  SKILL.md                  # the skill: trigger + procedure (read by every agent)
  scripts/
    register-service.sh     # Git Bash / macOS / Linux (Node)
    Register-Service.ps1    # Windows PowerShell helper
    Register-Service.cmd    # Windows wrapper (per-process ExecutionPolicy Bypass)
  agents/
    openai.yaml             # optional, Codex/OpenAI-only UI metadata
```

## Installing for your agent

Skills are loaded from each agent's skills directory. Symlink (or copy) this
folder into the one your agent uses:

| Agent | Skills directory |
|-------|------------------|
| Claude Code | `~/.claude/skills/` |
| Codex | `~/.codex/skills/` |

```bash
# Claude Code (symlink keeps it in sync with the repo)
ln -s "$(pwd)/skills/muxly-register-service" ~/.claude/skills/muxly-register-service

# Codex
ln -s "$(pwd)/skills/muxly-register-service" ~/.codex/skills/muxly-register-service
```

On Windows, copy the folder or create a junction:

```powershell
New-Item -ItemType Junction -Path "$HOME\.claude\skills\muxly-register-service" `
  -Target "$(Resolve-Path .\skills\muxly-register-service)"
```

## Notes

- Run the helpers from this skill's directory with a relative path
  (`scripts/...`); never hardcode an install path.
- Fields beyond the convenience flags — `usePty`, `autoPort`, `portEnvVar`,
  `profile`, `preRun`, `sensitive` — must be passed as JSON via `--stdin` or
  `--service-json`, not via flags.
- See [`../../docs/services-config.md`](../../docs/services-config.md) for the
  full `services.json` schema and per-OS config location.
