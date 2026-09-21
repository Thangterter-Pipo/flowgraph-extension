# MCP Server — E:\Flow_veo qua mạng

MCP server kiểu **remote streamable-HTTP** cho phép một AI khác (trên máy tính khác) đọc, ghi, sửa, xóa file trong `E:\Flow_veo` qua giao thức MCP chuẩn.

- Framework: Python **FastMCP 3.x**
- Auth: **OAuth 2.1 (Authorization Code + PKCE)** với **Dynamic Client Registration (DCR)** — cho ChatGPT/Claude connector. Ngoài ra vẫn hỗ trợ Bearer API key thuần.
- Truy cập từ xa: **HTTPS công khai** qua Cloudflare named tunnel + SSH reverse tunnel qua Contabo VPS — endpoint `https://flowveo.thangterter.online/mcp`
- Bảo vệ path traversal: mọi path phải nằm trong root; `..`, absolute path, drive letter đều bị chặn

---

## 1. Cài đặt

Yêu cầu: Python 3.12+ và [uv](https://docs.astral.sh/uv/) (hoặc dùng `venv` + `pip`).

```bash
cd E:\Flow_veo\mcp_server
uv venv
uv pip install -r requirements.txt
```

## 2. Cấu hình

```bash
copy .env.example .env
```

Sinh API key mạnh:

```bash
uv run python -c "import secrets; print(secrets.token_urlsafe(32))"
```

Dán kết quả vào `.env`:

```ini
FLOW_VEO_MCP_API_KEY=<key vừa sinh>
FLOW_VEO_MCP_ROOT=E:\Flow_veo
FLOW_VEO_MCP_HOST=127.0.0.1
FLOW_VEO_MCP_PORT=3080
```

## 3. Chạy

### ⭐ Chạy ngầm (khuyên dùng — tự khởi động lúc đăng nhập)

MCP được quản lý bởi một **daemon supervisor** (`start_mcp.py`):
- Tự động bật lúc **đăng nhập Windows** (Scheduled Task `FlowVeo MCP`)
- Chạy ngầm, **không có cửa sổ console**
- **Tự khởi động lại** server hoặc SSH tunnel nếu crash
- Log tại `%LOCALAPPDATA%\FlowVeoMCP\`

**Thiết lập 1 lần (cần mở Command Prompt với quyền Admin):**
```bat
register_task.bat
```

**Quản lý hàng ngày** (không cần admin):
```bat
start_mcp_manager.bat status   :: xem server + tunnel + public còn sống không
start_mcp_manager.bat start    :: khởi động daemon ngay
start_mcp_manager.bat stop     :: dừng daemon
```

Nếu không muốn dùng Task Scheduler, chạy daemon tay:
```bash
.venv\Scripts\python.exe start_mcp.py          # daemon
.venv\Scripts\python.exe start_mcp.py status   # health
.venv\Scripts\python.exe start_mcp.py stop     # dừng
```

### Local (chỉ cùng LAN, chạy trước mắt)
```bash
run.bat
```

### Public qua SSH reverse tunnel (Contabo VPS) + HTTPS
```bash
tunnel.bat
```
Script khởi động server trong một cửa sổ riêng, rồi mở SSH reverse tunnel tới VPS Contabo (`ssh contabo`). Kết quả: server reachable từ bất kỳ đâu tại:

```
https://flowveo.thangterter.online/mcp
```

**Kiến trúc truy cập từ xa (HTTPS):**

```
Máy khác (ChatGPT/Claude)
        │  HTTPS (Cloudflare, có cert)
        ▼
Cloudflare edge (flowveo.thangterter.online)
        │  Cloudflare named tunnel
        ▼
VPS Contabo (cloudflared.service) → 127.0.0.1:3080
        │  SSH reverse tunnel (tunnel.bat)
        ▼
Máy local (server.py, 127.0.0.1:3080)
```

**Yêu cầu (thiết lập 1 lần):**
1. SSH alias `contabo` trong `~/.ssh/config`, key-based auth (không hỏi mật khẩu).
2. Trên VPS: `GatewayPorts yes` trong `/etc/ssh/sshd_config`, và `cloudflared.service` chạy named tunnel (config `/etc/cloudflared/config.yml` có hostname `flowveo.thangterter.online` → `localhost:3080`).
3. DNS: CNAME `flowveo.thangterter.online` → `<tunnel-id>.cfargotunnel.com` (đã thêm qua `cloudflared tunnel route dns`).

## 4. Kết nối từ máy khác

Máy khác cần có: endpoint `https://flowveo.thangterter.online` + API key (hoặc OAuth). Sau đó cấu hình MCP client:

### ChatGPT (OAuth connector)
1. Mở ChatGPT → Add Connector → Custom MCP server.
2. URL máy chủ MCP: `https://flowveo.thangterter.online/mcp`
3. Xác thực: chọn **OAuth** → Advanced settings.
4. Server tự thông báo OAuth metadata (`.well-known`), ChatGPT tự detect authorization/token/registration endpoints. Nếu hỏi:
   - **DCR**: dùng đăng ký động — server có `/register` trả `client_id` tự động.
   - **CIMD**: nếu server chưa thông báo, dùng OAuth client do người dùng định nghĩa (xem mục 6).
5. Redirect URI callback: `https://chatgpt.com/connector/oauth/callback` (ChatGPT cấp).

### Claude Code (OAuth hoặc Bearer)
```bash
# OAuth (tự động flow browser)
claude mcp add --transport http flow-veo https://flowveo.thangterter.online/mcp

# Hoặc dùng API key thuần
claude mcp add --transport http flow-veo \
  https://flowveo.thangterter.online/mcp \
  --header "Authorization: Bearer <API_KEY>"
```

### CURL kiểm tra nhanh (phải có `Accept: application/json, text/event-stream`)
```bash
curl -X POST https://flowveo.thangterter.online/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Authorization: Bearer <API_KEY>" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

> **Lưu ý**: streamable-HTTP là **stateful** — sau `initialize`, server trả `Mcp-Session-Id`; các request tiếp theo phải kèm header đó. MCP SDK/client chuẩn tự làm việc này. Nếu dùng curl thủ công, phải tự giữ session id.

### OAuth endpoints (cho ChatGPT)
| Endpoint | Chức năng |
|---|---|
| `/.well-known/oauth-authorization-server` | Metadata (issuer, authorize, token, register) |
| `/authorize` | Authorization endpoint (PKCE S256) |
| `/token` | Token endpoint (authorization_code, refresh_token) |
| `/register` | Dynamic Client Registration (DCR) |
| `/userinfo` | Userinfo (OIDC) |

## 5. Các tool (54 tools — full-machine)

> MCP đã mở rộng từ sandbox E:\Flow_veo lên **toàn bộ máy** (mọi ổ đĩa user truy cập được). Chi tiết đầy đủ: [docs/TOOLS.md](docs/TOOLS.md).

### Navigation (5)
| Tool | Loại | Chức năng |
|---|---|---|
| `get_roots` | đọc | Liệt kê mọi ổ đĩa (C:\, D:\, E:\...) + size/free/type |
| `list_directory` | đọc | Liệt kê nội dung thư mục (`include_hidden`) |
| `list_tree` | đọc | Cây thư mục (max_depth + max_entries, chống vô hạn) |
| `stat_path` | đọc | Metadata (size, mtime, ctime, type) |
| `path_exists` | đọc | Kiểm tra tồn tại + loại |

### Reading (4)
| Tool | Loại | Chức năng |
|---|---|---|
| `read_file_range` | đọc | Đọc text theo dòng (large-file safe; trả FILE_TOO_LARGE thay vì load cả file) |
| `tail_file` | đọc | Đọc N dòng cuối (log tailing) |
| `read_file` | đọc | Đọc file (legacy, tương thích connector cũ) |
| `get_metadata` | đọc | Metadata (legacy) |

### Writing / Editing (8)
| Tool | Loại | Chức năng |
|---|---|---|
| `write_file` | **ghi** | Tạo/ghi đè (create_parents, overwrite flags) |
| `append_file` | **ghi** | Ghi nối cuối |
| `patch_file` | **ghi** | Patch chính xác old→new, trả before/after_hash; PATCH_CONFLICT khi sai lệch |
| `replace_text` | **ghi** | Thay occurrence (guard expected_occurrences) |
| `insert_text` | **ghi** | Chèn trước/sau anchor occurrence |
| `delete_text_range` | **ghi** | Xóa đoạn giữa 2 anchor |
| `write_base64` | **ghi** | Ghi binary (legacy) |
| `create_directory` | **ghi** | mkdir -p |

### File Operations (8)
| Tool | Loại | Chức năng |
|---|---|---|
| `copy_file` | ghi | Copy (overwrite flag) |
| `copy_directory` | ghi | Copy đệ quy |
| `move_file` | ghi | Move (overwrite flag) |
| `move_directory` | ghi | Move đệ quy |
| `rename_path` | ghi | Đổi tên/di chuyển |
| `delete_file` | **xóa** | Xóa vĩnh viễn |
| `delete_directory` | **xóa** | Xóa thư mục — recursive chỉ khi `recursive=true` |
| `mkdir_temp` | ghi | Workspace tạm (legacy) |

### Search (3)
| Tool | Loại | Chức năng |
|---|---|---|
| `search_files` | đọc | Theo tên glob/extension |
| `grep` | đọc | Nội dung text/regex → file/line/column |
| `grep_files` | đọc | Tìm nội dung (legacy) |

### Hash / Compare (2)
| Tool | Loại | Chức năng |
|---|---|---|
| `file_hash` | đọc | SHA-256 (streamed, large-file safe) |
| `compare_files` | đọc | identical + size + hash |

### Archive (2)
| Tool | Loại | Chức năng |
|---|---|---|
| `zip_directory` | ghi | Zip thư mục |
| `unzip_archive` | ghi | Giải nén (zip-slip protected) |

### Command Execution (1)
| Tool | Loại | Chức năng |
|---|---|---|
| `exec_command` | chạy | Mọi CLI (shell flag), timeout, env → exit_code/stdout/stderr/duration |

> **Policy mới (full-machine)**: không whitelist. Chạy đúng quyền user hiện tại, không nâng quyền. `cwd`/path là bất kỳ absolute path user truy cập được.

### Process Manager (5)
| Tool | Loại | Chức năng |
|---|---|---|
| `start_process` | chạy | Process dài hạn → process_id |
| `process_status` | đọc | Trạng thái + exit code |
| `get_process_output` | đọc | stdout/stderr increment theo offset (buffer có giới hạn) |
| `kill_process` | **xóa** | Kill process + children |
| `list_processes` | đọc | Các process đang quản lý |

### Testing (2)
| Tool | Loại | Chức năng |
|---|---|---|
| `run_pytest` | chạy | Trả passed/failed/skipped/duration parse sẵn |
| `run_python_script` | chạy | Chạy script .py |

### Git (6)
| Tool | Loại | Chức năng |
|---|---|---|
| `git_status` | đọc | status --short |
| `git_diff` | đọc | diff / --cached |
| `git_log` | đọc | lịch sử oneline |
| `git_branch` | đọc | nhánh hiện tại |
| `git_commit` | **ghi** | add + commit (không push) |
| `git_commit_file` | **ghi** | Stage 1 file + commit |

### System (5)
| Tool | Loại | Chức năng |
|---|---|---|
| `system_info` | đọc | OS/hostname/arch/RAM/python/node/user/cwd |
| `get_environment` | đọc | Env vars (allowlist, không secret) |
| `which_command` | đọc | Định vị executable trên PATH |
| `disk_usage` | đọc | Dung lượng ổ đĩa |
| `get_roots` | đọc | Danh sách ổ đĩa (ở trên) |

### CDP / Browser (4)
| Tool | Loại | Chức năng |
|---|---|---|
| `cdp_list_pages` | đọc | Liệt kê Chrome CDP targets |
| `cdp_get_page_url` | đọc | URL trang |
| `cdp_evaluate` | đọc | Evaluate JS trong trang |
| `cdp_network_enable` | đọc | Bật network tracking |

Read/write tách riêng; tool ghi/xóa có `destructiveHint` để host xác nhận.

## 6. OAuth client thủ công (nếu ChatGPT không tự DCR)

Nếu DCR (`/register`) không được ChatGPT dùng (nó đòi "Ứng dụng khách OAuth do người dùng xác định"), bạn tự đăng ký client:

```bash
curl -X POST https://flowveo.thangterter.online/register \
  -H "Content-Type: application/json" \
  -d '{
    "client_name": "ChatGPT",
    "redirect_uris": ["https://chatgpt.com/connector/oauth/callback"],
    "grant_types": ["authorization_code", "refresh_token"],
    "response_types": ["code"],
    "token_endpoint_auth_method": "none",
    "scope": "filesystem read write"
  }'
```

Nhận `client_id` từ response, điền vào ChatGPT. Client đã đăng ký được lưu vĩnh viễn trong `oauth_clients.json`.

## 7. Bảo mật

- **API key** trong `.env` (gitignore). `/mcp` không Bearer → 401.
- **OAuth DCR vẫn bật** để ChatGPT tự đăng ký connector, NHƯNG:
  - `redirect_uris` chỉ nhận prefix `https://chatgpt.com/connector/oauth/`
  - `/authorize` **không consent implicit** — trình duyệt tới `/consent`, chủ máy gõ `FLOW_VEO_MCP_CONSENT_PIN`
- Bind mặc định `127.0.0.1`. Public = Cloudflare tunnel, không mở LAN.
- `exec_command` / `start_process` mang `destructiveHint` (không giả read-only).
- Tool chạy đúng quyền user Windows, không elevate.

## 8. Kết hợp ChatGPT Web Bridge (`E:\Flow_veo\chatgpt-web-bridge`)

Hai kênh **cùng lúc**, không trộn credential:

| Kênh | Địa chỉ | Việc |
|---|---|---|
| **MCP OAuth** | `https://flowveo.thangterter.online/mcp` | ChatGPT (connector) **thao tác máy** |
| **Web Bridge** | `127.0.0.1:5005` | Pipo **nói với** tab ChatGPT (DOM) |

Luồng: Pipo → `mcp_handoff.py "việc X"` → bridge gõ vào ChatGPT → ChatGPT gọi MCP tools (đã Allow + PIN).

```bash
python E:\Flow_veo\chatgpt-web-bridge\bridge_server.py
python E:\Flow_veo\chatgpt-web-bridge\mcp_handoff.py "list E:\Flow_veo rồi tóm tắt README"
```

Bearer API key chỉ dành cho Claude/Cursor/local. Không dán key vào ChatGPT Web.

## 9. Kiểm thử

```bash
# Test nội bộ (không cần server chạy) — dùng Starlette TestClient:
uv run python test_local.py

# Test end-to-end qua HTTP thật (server phải đang chạy trên 3080):
uv run python test_e2e.py
```
