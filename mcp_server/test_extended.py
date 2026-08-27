"""Test the full-machine extended tools via Starlette TestClient."""
import json
import os

os.environ.setdefault("FLOW_VEO_MCP_API_KEY", "testkey123")

import server  # noqa: E402
from starlette.applications import Starlette  # noqa: E402
from starlette.middleware import Middleware  # noqa: E402
from starlette.responses import JSONResponse  # noqa: E402
from starlette.routing import Mount, Route  # noqa: E402
from starlette.testclient import TestClient  # noqa: E402

mcp_app = server.mcp.http_app(transport="http", host_origin_protection=False)


async def health(request):
    return JSONResponse({"status": "ok"})


app = Starlette(
    routes=[Route("/health", health), Mount("/", app=mcp_app)],
    middleware=[Middleware(server.APIKeyMiddleware)],
    lifespan=mcp_app.lifespan,
)
client = TestClient(app, raise_server_exceptions=True)
client.__enter__()

PASS = 0
FAIL = 0
SID = {"v": None}


def check(label, cond, extra=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  PASS  {label}")
    else:
        FAIL += 1
        print(f"  FAIL  {label}  {extra}")


def call(name, args):
    body = {"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": name, "arguments": args}}
    headers = {"Authorization": "Bearer testkey123", "Accept": "application/json, text/event-stream"}
    if SID["v"]:
        headers["Mcp-Session-Id"] = SID["v"]
    r = client.post("/mcp", json=body, headers=headers)
    if r.headers.get("mcp-session-id"):
        SID["v"] = r.headers.get("mcp-session-id")
    ct = r.headers.get("content-type", "")
    obj = None
    if "text/event-stream" in ct:
        for b in r.text.replace("\r\n", "\n").split("\n\n"):
            for line in b.splitlines():
                if line.startswith("data:"):
                    try:
                        obj = json.loads(line[5:].strip())
                    except Exception:
                        pass
    else:
        try:
            obj = r.json()
        except Exception:
            obj = r.text
    if "result" in (obj or {}):
        try:
            return json.loads(obj["result"]["content"][0]["text"])
        except Exception:
            return obj["result"]["content"][0]["text"]
    return {"http": r.status_code, "err": str(obj)[:150]}


r = client.post(
    "/mcp",
    json={"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2025-03-26", "capabilities": {}, "clientInfo": {"name": "t", "version": "1"}}},
    headers={"Authorization": "Bearer testkey123", "Accept": "application/json, text/event-stream"},
)
if r.headers.get("mcp-session-id"):
    SID["v"] = r.headers.get("mcp-session-id")

print("== get_roots ==")
r = call("get_roots", {})
check("get_roots", r.get("success") and r.get("count", 0) >= 1, str(r)[:200])
if r.get("roots"):
    print("  drives:", [x["drive"] for x in r["roots"][:5]])

print("== patch_file ==")
r = call("write_file", {"path": r"E:\Flow_veo\_test_patch.txt", "content": "line one\nline two\nline three\n"})
check("write_file", r.get("success") or r.get("ok"), str(r)[:200])
r = call("patch_file", {"path": r"E:\Flow_veo\_test_patch.txt", "old_text": "line two", "new_text": "LINE TWO", "expected_occurrences": 1})
check("patch_file", r.get("success") and r.get("before_hash") != r.get("after_hash"), str(r)[:200])
r = call("patch_file", {"path": r"E:\Flow_veo\_test_patch.txt", "old_text": "nonexistent", "new_text": "x"})
check("patch_conflict", r.get("success") is False and r.get("error_code") == "PATCH_CONFLICT", str(r)[:200])

print("== insert/delete ==")
r = call("insert_text", {"path": r"E:\Flow_veo\_test_patch.txt", "anchor_text": "line one", "new_text": "// inserted\n", "after": True})
check("insert_text", r.get("success"))
r = call("delete_text_range", {"path": r"E:\Flow_veo\_test_patch.txt", "start_text": "// inserted", "end_text": "\n"})
check("delete_text_range", r.get("success"))

print("== read_file_range / tail ==")
r = call("read_file_range", {"path": r"E:\Flow_veo\_test_patch.txt", "start_line": 1, "end_line": 2})
check("read_file_range", r.get("success") and "line one" in r.get("content", ""), str(r)[:200])
r = call("tail_file", {"path": r"E:\Flow_veo\_test_patch.txt", "lines": 2})
check("tail_file", r.get("success") and "line three" in r.get("content", ""), str(r)[:200])

print("== grep regex ==")
r = call("grep", {"root": r"E:\Flow_veo", "pattern": r"line \w+", "regex": True, "max_results": 5})
check("grep regex", r.get("success"), str(r)[:200])

print("== zip/unzip/zip-slip ==")
r = call("zip_directory", {"src": r"E:\Flow_veo\mcp_server", "dst": r"E:\Flow_veo\_test.zip", "exclude": ".venv,__pycache__"})
check("zip_directory", r.get("success"), str(r)[:200])
if os.path.exists(r"E:\Flow_veo\_test.zip"):
    import shutil
    import zipfile

    with zipfile.ZipFile(r"E:\Flow_veo\_test.zip") as zf:
        zf.extractall(r"E:\Flow_veo\_test_unzip")
    zpath = r"E:\Flow_veo\_mal.zip"
    with zipfile.ZipFile(zpath, "w") as zf:
        zf.writestr("../../evil.txt", "evil")
    r2 = call("unzip_archive", {"src": zpath, "dst": r"E:\Flow_veo\_test_unzip2"})
    check("zip-slip blocked", r2.get("success") is False, str(r2)[:200])
    shutil.rmtree(r"E:\Flow_veo\_test_unzip", ignore_errors=True)
    shutil.rmtree(r"E:\Flow_veo\_test_unzip2", ignore_errors=True)
    os.remove(zpath)

print("== system ==")
r = call("system_info", {})
check("system_info", r.get("success") and r.get("os") == "Windows", str(r)[:200])
r = call("which_command", {"name": "python"})
check("which_command", r.get("success") and r.get("found"), str(r)[:200])
r = call("disk_usage", {"path": r"E:\Flow_veo"})
check("disk_usage", r.get("success"), str(r)[:200])

print("== exec_command ==")
r = call("exec_command", {"command": "python --version", "cwd": r"E:\Flow_veo"})
check("exec python", r.get("success") and r.get("exit_code") == 0, str(r)[:150])
r = call("exec_command", {"command": "echo hello & whoami", "shell": True, "cwd": r"E:\Flow_veo"})
check("exec shell", r.get("success"), str(r)[:200])

print("== cleanup ==")
for f in [r"E:\Flow_veo\_test_patch.txt", r"E:\Flow_veo\_test.zip"]:
    if os.path.exists(f):
        os.remove(f)

print(f"\n== RESULT: {PASS} passed, {FAIL} failed ==")
client.__exit__(None, None, None)
raise SystemExit(1 if FAIL else 0)
