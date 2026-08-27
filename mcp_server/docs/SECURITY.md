# Computer MCP — Security

## Trust model

This server gives ChatGPT **significant power over the machine** (full
filesystem + arbitrary command execution). It is designed for the machine
owner's own use. Treat the API key / OAuth client as a personal credential.

## What it does NOT do

- ❌ Never bypass Windows ACLs, UAC, or privilege escalation.
- ❌ Never runs commands as Administrator unless the user already is.
- ❌ Never logs passwords, tokens, Authorization headers, API keys, or file content.
- ❌ Never exposes the server without authentication.
- ❌ Never returns full environment secrets (only allowlisted keys).

## Enforcement points

| Concern | Mechanism |
|---|---|
| Path safety | `security/paths.py`: normalize, reject `..`, NUL, reserved names, missing drives |
| Zip-slip | `safe_join_zip` — members cannot escape destination |
| Command timeouts | `COMMAND_TIMEOUT_SECONDS` (default 120) |
| Output size | `MAX_COMMAND_OUTPUT_MB` (default 10) — truncated, flagged |
| File read size | `MAX_FILE_READ_MB` (default 50) — returns FILE_TOO_LARGE |
| Process leaks | `ProcessManager.shutdown()` kills all tracked processes on server exit |
| Audit | JSONL log, secret keys redacted via `sanitize_params` |
| Auth | OAuth 2.1 + PKCE (DCR) + static API key; `APIKeyMiddleware` outermost |

## Destructive operations

`delete_file`, `delete_directory(recursive)`, `kill_process`, `write_file`,
`patch_file`, `git_commit` carry `destructiveHint: true`. Clients (ChatGPT)
surface a confirmation.

Recursive directory delete is **never** the default — `recursive=true` must be
passed explicitly.

## Running over the public internet

The server is exposed via:
```
Windows MCP (0.0.0.0:3080)
  → SSH reverse tunnel (user contabo)
  → VPS cloudflared named tunnel (HTTPS)
  → flowveo.thangterter.online
```
Protections in front: OAuth (PKCE) at the app layer, Cloudflare TLS, API key.
Rotate the API key in `.env` if it ever leaks; restart via `start_mcp_manager.bat stop` + `start`.

## Production checklist

- [ ] `.env` not committed (`.gitignore` excludes it)
- [ ] Strong `FLOW_VEO_MCP_API_KEY` (`secrets.token_urlsafe(32)`)
- [ ] Audit log enabled (`AUDIT_LOG_ENABLED=true`)
- [ ] `delete_directory` recursive stays opt-in
- [ ] Never add `0.0.0.0` + auth none together
