# Connect Computer MCP to ChatGPT Web

## Option A — Remote HTTPS endpoint (this machine is already public)

The server is already reachable at:

```
https://flowveo.thangterter.online/mcp
```

### Steps in ChatGPT

1. **Settings → Apps → Connectors → Add connector (Custom MCP).**
2. Enter name: `FlowVeo Computer`.
3. Server URL: `https://flowveo.thangterter.online/mcp`
4. Authentication: choose **OAuth** → Advanced.
   - Server advertises `/.well-known/oauth-authorization-server`.
   - Registration: **DCR** (dynamic) — ChatGPT calls `/register` automatically.
   - If asked, scopes: `filesystem read write` (default).
5. Click **Connect / Create**.
6. ChatGPT opens the `/authorize` URL in a browser → server approves
   (implicit consent, no login page) → redirects with code → `/token` → done.
7. **Scan Tools** — expect ~65 tools.
8. Open a **new chat** (refreshes the tool schema from the server).

### Verify

Ask: *"List the drives on my computer"* → should call `get_roots`.
Then: *"Read E:\Flow_veo\CHANGELOG.md"* → `read_file_range`.
Then: *"Run git status in E:\Flow_veo"* → `exec_command`.

## Option B — Local only (no public exposure)

If you do NOT want the server on the internet:

1. Start server on `127.0.0.1`:
   ```powershell
   .\scripts\start.ps1 -Host 127.0.0.1
   ```
2. Use a **secure tunnel** to expose localhost only to ChatGPT:
   - Cloudflare Quick Tunnel:
     ```bash
     cloudflared tunnel --url http://127.0.0.1:3080
     ```
     → use the printed `https://xxx.trycloudflare.com/mcp` as the server URL
     (requires adding the API key header in ChatGPT OAuth advanced, or set
     auth mode accordingly).
   - Or `ssh -R` to a VPS (like the current setup) to keep a stable host.

> ChatGPT cannot call `http://localhost:3080/mcp` directly. Always tunnel.

## Notes

- The connector caches the tool list. If tools changed, **disconnect +
  reconnect** the connector and open a new chat.
- After reconnecting, ChatGPT re-runs DCR and gets a fresh client; the
  previous client stays in `oauth_clients.json` (harmless).

## Troubleshooting

| Symptom | Fix |
|---|---|
| Still shows 12 tools after upgrade | Remove connector → re-add → new chat |
| `invalid_scope` | Ensure client scope includes `filesystem read write` |
| `/authorize` redirects to None | Server restarted with stale client — re-register |
| Connection fails | Check `start_mcp_manager.bat status` (server + public up?) |
