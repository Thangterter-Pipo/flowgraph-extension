# Computer MCP — Architecture

## Overview

MCP server (Python FastMCP 3.x, Streamable HTTP) running on a Windows machine,
giving ChatGPT (or any MCP client) full-machine filesystem + process + command
access **under the current Windows user's permissions**.

```
ChatGPT Web
     │  HTTPS (Cloudflare named tunnel) + OAuth
     ▼
flowveo.thangterter.online
     │  cloudflared (named tunnel on VPS)
     ▼
VPS Contabo (194.163.174.78:3080)
     │  SSH reverse tunnel
     ▼
localhost:3080/mcp   ← MCP Server (Windows)
     │
     ├── Filesystem tools   (get_roots, list_directory, list_tree, stat_path...)
     ├── File editing       (patch_file, replace_text, insert_text, delete_text_range)
     ├── Search             (search_files, grep)
     ├── File ops           (copy/move/delete, hash, compare, zip/unzip)
     ├── Command execution  (exec_command — any CLI, no whitelist)
     ├── Process manager    (start_process, status, output, kill)
     ├── Testing            (run_pytest, run_python_script)
     ├── Git                (status, diff, log, commit)
     ├── System             (system_info, which_command, disk_usage...)
     └── CDP/Browser        (cdp_list_pages, evaluate, network...)
             │
             ▼
      Windows: C:\ D:\ E:\ F:\ ... (OS-enforced permissions)
```

## Modules

| Module | Responsibility |
|---|---|
| `server.py` | FastMCP app + OAuth provider + API-key middleware + ASGI wiring |
| `register_all.py` | Central tool registration (audit + annotations) |
| `extended_tools.py` | Core full-machine tool implementations |
| `security/paths.py` | Path normalize/validate, zip-slip guard |
| `security/audit.py` | JSONL audit log (secrets redacted) |
| `services/process_manager.py` | Bounded-buffer process registry, shutdown cleanup |
| `start_mcp.py` | Daemon supervisor (server + SSH tunnel, auto-restart) |

## Transport & auth

- MCP Streamable HTTP at `/mcp` (stateful, `Mcp-Session-Id`).
- OAuth 2.1 Authorization Code + PKCE (`/authorize`, `/token`, `/register` DCR)
  via `PersistentOAuthProvider`.
- Static API key accepted as a valid access token (backward compatible).
- `/.well-known/oauth-authorization-server` discovery for ChatGPT.

## Security model

- **No privilege escalation** — every operation runs as the current Windows
  user; the OS enforces ACLs.
- **Full-machine paths** allowed (any drive the user can access), normalized
  against `..` / reserved names / missing drives.
- **Audit log** (JSONL, `%LOCALAPPDATA%\FlowVeoMCP\audit.jsonl`) records
  tool, params (redacted), ok, duration. Never logs secrets or file content.
- **Bounds**: MAX_FILE_READ_MB, MAX_COMMAND_OUTPUT_MB, COMMAND_TIMEOUT_SECONDS.
- **Process cleanup** on shutdown (no zombies).
- Destructive tools carry `destructiveHint` so ChatGPT confirms.
