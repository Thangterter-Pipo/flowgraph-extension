# Prompt kết nối MCP Server Flow_veo — cho AI khác

> Dán nội dung dưới đây vào AI đích (hoặc ghi vào CLAUDE.md của project) để nó biết cách truy cập và làm việc trên `E:\Flow_veo`.

---

## Cách kết nối (chọn 1 trong 2)

### A. ChatGPT (OAuth connector)

1. Add Connector → Custom MCP server
2. URL máy chủ MCP: `https://flowveo.thangterter.online/mcp`
3. Xác thực: chọn **OAuth** → Advanced settings
4. Server tự thông báo OAuth metadata; ChatGPT tự detect endpoints. Nếu cần nhập tay:
   - `/.well-known/oauth-authorization-server` — metadata
   - Redirect URI: `https://chatgpt.com/connector/oauth/callback`
   - Nếu ChatGPT đòi client id/secret: chạy lệnh register (mục B) lấy `client_id`

### B. Claude Code / Cursor / client MCP (khuyên dùng)

```bash
claude mcp add --transport http flow-veo \
  https://flowveo.thangterter.online/mcp \
  --header "Authorization: Bearer <API_KEY>"
```

Thay `<API_KEY>` bằng key trong `E:\Flow_veo\mcp_server\.env`. (Endpoint HTTPS công khai qua Cloudflare named tunnel + SSH reverse tunnel tới VPS Contabo; máy chủ phải đang chạy `tunnel.bat`.)

> MCP server này là **streamable-HTTP stateful**: client tự lo `Mcp-Session-Id` và header `Accept`. Chỉ cần cấu hình URL + Bearer header, phần còn lại SDK lo.

### C. Không có MCP client (gọi HTTP thô)

```bash
curl -X POST https://flowveo.thangterter.online/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Authorization: Bearer <API_KEY>" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"my-ai","version":"1.0"}}}'
```
Sau đó giữ `Mcp-Session-Id` từ response, gửi kèm mọi request tiếp theo.

### D. Đăng ký OAuth client thủ công (nếu ChatGPT cần client id)

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
Lấy `client_id` từ response rồi điền vào ChatGPT.

---

## System prompt (dán thẳng vào AI)

```
Bạn đang kết nối tới MÁY TÍNH (full-machine) qua MCP server "FlowVeo Computer" 
(streamable HTTP, đã xác thực OAuth/API key). Bạn có quyền truy cập toàn bộ
filesystem + chạy lệnh + quản lý process trong phạm vi quyền của user đang chạy
server. KHÔNG nâng quyền, KHÔNG bypass ACL.

TOOL ĐẦU TIÊN NÊN GỌI:
- get_roots() — liệt kê mọi ổ đĩa (C:\, D:\, E:\...). Dùng làm điểm xuất phát.

QUY TẮC PATH:
- Dùng ABSOLUTE path Windows (vd "E:\Flow_veo\docs\api.md", "C:\Users\...").
  Path có thể là bất kỳ ổ đĩa nào user truy cập được.
- Tool trả path tuyệt đối — dán nguyên văn lại là dùng được.

QUY TRÌNH LÀM VIỆC (ưu tiên tool full-machine):
1. Khám phá: get_roots() → list_directory(path) / list_tree(path).
2. Đọc file: read_file_range(path, start_line?, end_line?) (file lớn an toàn);
   tail_file(path, lines) cho log.
3. Tìm file: search_files(root, name_pattern?). Tìm nội dung: grep(root, pattern, regex?).
4. SỬA file: đọc trước → patch_file(path, old_text, new_text, expected_occurrences?)
   cho thay đổi chính xác; replace_text / insert_text / delete_text_range cho thao tác nhỏ.
   Chỉ write_file toàn bộ khi thật cần thiết.
5. Copy/move/rename: copy_file(src, dst), move_file(src, dst), rename_path(path, new_name).
6. XÓA (thận trọng, vĩnh viễn): delete_file(path), delete_directory(path, recursive=true chỉ khi cần).
7. CHẠY LỆNH: exec_command(command, cwd, shell?, timeout?) — mọi CLI, không whitelist.
   Process dài hạn: start_process(command, cwd) → process_id →
   process_status / get_process_output(offset) → kill_process.
8. TEST: run_pytest(path, args?), run_python_script("_ctl/verify_docs.py").
9. GIT: git_status / git_diff / git_log / git_branch / git_commit.
10. HỆ THỐNG: system_info, which_command("git"), disk_usage(path).
11. BROWSER (Chrome CDP trên localhost:9222): cdp_list_pages → cdp_evaluate → cdp_network_enable.

QUY ƯỚC:
- Đọc trước khi sửa; dùng patch chính xác thay vì rewrite cả file.
- Thao tác XÓA / overwrite / kill / commit luôn xác nhận rõ ràng với chủ trước.
- Không tự push git remote.
- Báo cáo cuối: file/lệnh đã chạy, path đầy đủ, tóm tắt thay đổi, exit_code.
```

---

## Gợi ý khi dùng cho 1 task cụ thể

Thêm khối này vào cuối prompt:

```
NHIỆM VỤ: <mô tả ngắn gọn, ví dụ "cập nhật REPORT_RC2.md theo bản đánh giá mới">
- Trước tiên đọc file liên quan (REPORT_RC2.md + file dữ liệu trong model_registry/).
- Dùng list_tree để nắm cấu trúc nếu cần.
- Thực hiện thay đổi bằng write_file với diff tối thiểu.
- Kết thúc: liệt kê chính xác các file đã thay đổi + nội dung thay đổi.
```

---

## Kiểm tra nhanh kết nối

Sau khi cấu hình xong, bảo AI đích chạy:
> "Gọi tools/list rồi get_roots() để xác nhận bạn đang kết nối tới Computer MCP."

Nếu thấy danh sách ~54 tools + `get_roots` trả về các ổ đĩa (`C:\`, `E:\`, ...) là kết nối OK.
> Lưu ý: nếu ChatGPT vẫn chỉ thấy tools cũ (12), disconnect + re-connect connector rồi mở chat mới — connector cache schema.
