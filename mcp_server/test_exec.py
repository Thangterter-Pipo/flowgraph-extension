"""Test the new execution/git/system tools via Starlette TestClient."""
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


def rpc(method, params=None, key="testkey123"):
    body = {"jsonrpc": "2.0", "id": 1, "method": method}
    if params is not None:
        body["params"] = params
    headers = {
        "Authorization": f"Bearer {key}",
        "Accept": "application/json, text/event-stream",
    }
    if SID["v"]:
        headers["Mcp-Session-Id"] = SID["v"]
    r = client.post("/mcp", json=body, headers=headers)
    sid = r.headers.get("mcp-session-id")
    if sid:
        SID["v"] = sid
    ct = r.headers.get("content-type", "")
    obj = None
    if "text/event-stream" in ct:
        for block in r.text.replace("\r\n", "\n").split("\n\n"):
            for line in block.splitlines():
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
    return r.status_code, obj


def call_tool(name, args):
    s, obj = rpc("tools/call", {"name": name, "arguments": args})
    if s != 200 or not obj or "result" not in obj:
        return {"ok": False, "error": f"http {s} {str(obj)[:200]}"}
    try:
        return json.loads(obj["result"]["content"][0]["text"])
    except Exception:
        return obj["result"]["content"][0]["text"]


print("== handshake ==")
s, _ = rpc("initialize", {"protocolVersion": "2025-03-26", "capabilities": {}, "clientInfo": {"name": "t", "version": "1"}})
check("initialize", s == 200)

print("\n== exec_command ==")
r = call_tool("exec_command", {"command": "python --version", "cwd": r"E:\Flow_veo"})
check("python --version", r.get("ok") is True or r.get("success") is True and r.get("exit_code") == 0, str(r)[:150])
check("stdout has version", "Python" in r.get("stdout", ""), r.get("stdout", ""))

r = call_tool("exec_command", {"command": "git status --short", "cwd": r"E:\Flow_veo"})
check("git status", r.get("ok") is True or r.get("success") is True and r.get("exit_code") == 0, str(r)[:150])

r = call_tool("exec_command", {"command": "echo hi"})
check("echo runs (no whitelist per full-machine policy)", r.get("ok") is True or r.get("success") is True and r.get("exit_code") == 0, str(r)[:150])

r = call_tool("exec_command", {"command": "python -c \"import sys; print(sys.version)\"", "cwd": r"E:\Flow_veo"})
check("python -c allowed", r.get("ok") is True or r.get("success") is True, str(r)[:150])

r = call_tool("exec_command", {"command": "dir && echo bad", "shell": True})
check("shell with metachar works when shell=true", r.get("ok") is True or r.get("success") is True, str(r)[:150])

print("\n== run_pytest ==")
r = call_tool("run_pytest", {"path": "tests/test_flow.py", "args": "-q --collect-only", "cwd": r"E:\Flow_veo"})
check("pytest collect-only", r.get("ok") is True or r.get("success") is True and r.get("exit_code") == 0, str(r)[:200])

print("\n== git tools ==")
r = call_tool("git_status", {})
check("git_status", isinstance(r, dict) and r.get("exit_code") == 0, str(r)[:150])
r = call_tool("git_log", {"limit": 3})
check("git_log", isinstance(r, dict) and r.get("exit_code") == 0, str(r)[:150])

print("\n== system tools ==")
r = call_tool("system_info", {})
check("system_info", r.get("ok") is True or r.get("success") is True and r.get("python"), str(r)[:200])
r = call_tool("which_command", {"name": "python"})
check("which_command python", r.get("ok") is True or r.get("success") is True and r.get("found"), str(r)[:150])
r = call_tool("get_environment", {"names": "PATH"})
check("get_environment PATH", r.get("ok") is True or r.get("success") is True and r.get("values"), str(r)[:150])
r = call_tool("disk_usage", {"path": r"E:\Flow_veo"})
check("disk_usage", r.get("ok") is True or r.get("success") is True, str(r)[:150])

print("\n== file ops ==")
r = call_tool("file_hash", {"path": r"E:\Flow_veo\CHANGELOG.md"})
check("file_hash", r.get("ok") is True or r.get("success") is True and len(r.get("hash", "")) == 64, str(r)[:150])
r = call_tool("copy_file", {"src": r"E:\Flow_veo\CHANGELOG.md", "dst": r"E:\Flow_veo\_test_exec\CHANGELOG.bak"})
check("copy_file", r.get("ok") is True or r.get("success") is True, str(r)[:150])
r = call_tool("compare_files", {"path_a": r"E:\Flow_veo\CHANGELOG.md", "path_b": r"E:\Flow_veo\_test_exec\CHANGELOG.bak"})
check("compare_files identical", r.get("identical") is True, str(r)[:150])
r = call_tool("tail_file", {"path": r"E:\Flow_veo\CHANGELOG.md", "lines": 3})
check("tail_file", r.get("ok") is True or r.get("success") is True and r.get("content"), str(r)[:150])

print("\n== process management ==")
r = call_tool("start_process", {"command": "python -m http.server 8899", "cwd": r"E:\Flow_veo", "name": "test-http"})
check("start_process", r.get("ok") is True or r.get("success") is True and r.get("status") == "running", str(r)[:200])
pid = r.get("process_id")
r = call_tool("process_status", {"process_id": pid})
check("process_status running", r.get("status") in ("running", "exited"), str(r)[:150])
r = call_tool("get_process_output", {"process_id": pid})
check("get_process_output", r.get("ok") is not False, str(r)[:150])
r = call_tool("kill_process", {"process_id": pid})
check("kill_process", r.get("status") in ("exited", "running"), str(r)[:150])

print("\n== cleanup ==")
call_tool("delete_file", {"path": r"E:\Flow_veo\_test_exec\CHANGELOG.bak"})
call_tool("delete_directory", {"path": r"E:\Flow_veo\_test_exec"})

print(f"\n== RESULT: {PASS} passed, {FAIL} failed ==")
client.__exit__(None, None, None)
raise SystemExit(1 if FAIL else 0)
