"""Local test harness for the Flow_veo MCP server (FastMCP 3.x)."""
import json
import os

os.environ.setdefault("FLOW_VEO_MCP_API_KEY", "testkey123")

import server  # noqa: E402
from starlette.applications import Starlette  # noqa: E402
from starlette.responses import JSONResponse  # noqa: E402
from starlette.routing import Mount, Route  # noqa: E402
from starlette.testclient import TestClient  # noqa: E402
from starlette.middleware import Middleware  # noqa: E402

mcp_app = server.mcp.http_app(transport="http", host_origin_protection=False)


async def health(request):
    return JSONResponse({"status": "ok", "root": str(server.ROOT)})


app = Starlette(
    routes=[Route("/health", health), Mount("/", app=mcp_app)],
    middleware=[Middleware(server.APIKeyMiddleware)],
    lifespan=mcp_app.lifespan,
)
client = TestClient(app, raise_server_exceptions=True)
client.__enter__()

PASS = 0
FAIL = 0


def check(label, cond, extra=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  PASS  {label}")
    else:
        FAIL += 1
        print(f"  FAIL  {label}  {extra}")


SESSION_ID = {"value": None}


def rpc(method, params=None, key="testkey123"):
    body = {"jsonrpc": "2.0", "id": 1, "method": method}
    if params is not None:
        body["params"] = params
    headers = {
        "Authorization": f"Bearer {key}",
        "Accept": "application/json, text/event-stream",
    }
    if SESSION_ID["value"]:
        headers["Mcp-Session-Id"] = SESSION_ID["value"]
    r = client.post("/mcp", json=body, headers=headers)
    sid = r.headers.get("mcp-session-id")
    if sid:
        SESSION_ID["value"] = sid
    return r.status_code, _parse_response(r)


def _parse_response(r):
    """Return the JSON object from either a JSON or an SSE response."""
    ct = r.headers.get("content-type", "")
    if "text/event-stream" in ct:
        # event: message\r\ndata: {...}\r\n\r\n
        data_lines = []
        for block in r.text.replace("\r\n", "\n").split("\n\n"):
            for line in block.splitlines():
                if line.startswith("data:"):
                    data_lines.append(line[5:].strip())
        if not data_lines:
            return {"raw": r.text}
        try:
            return json.loads("\n".join(data_lines))
        except Exception:
            return {"raw": r.text}
    try:
        return r.json()
    except Exception:
        return r.text


print("== 1. HTTP auth ==")
r = client.get("/health")
check("health without auth", r.status_code == 200)
r = client.post("/mcp", json={}, headers={"Accept": "application/json, text/event-stream"})
check("no-auth rejected", r.status_code == 401, r.status_code)
r = client.post("/mcp", json={}, headers={"Authorization": "Bearer wrong", "Accept": "application/json, text/event-stream"})
check("bad-auth rejected", r.status_code == 401, r.status_code)

print("== 2. MCP handshake ==")
s, init = rpc("initialize", {
    "protocolVersion": "2025-03-26",
    "capabilities": {},
    "clientInfo": {"name": "test", "version": "1"},
})
check("initialize 200", s == 200, s)
check("serverInfo name", init.get("result", {}).get("serverInfo", {}).get("name") == "flow-veo-fs", str(init)[:200])

s, tl = rpc("tools/list")
check("tools/list 200", s == 200, s)
names = [t["name"] for t in tl.get("result", {}).get("tools", [])]
print("  tools:", names)
for want in ["list_tree", "list_dir", "read_file", "search_files", "grep_files",
             "get_metadata", "write_file", "write_base64", "append_file",
             "rename_path", "delete_file", "create_directory"]:
    check(f"has tool {want}", want in names)

print("== 3. read tools ==")
s, res = rpc("tools/call", {"name": "list_tree", "arguments": {"path": ".", "max_depth": 1}})
check("list_tree 200", s == 200, s)
ct = res.get("result", {}).get("content", [{}])[0].get("text", "")
data = json.loads(ct)
check("list_tree ok", data.get("ok") is True, ct[:200])
check("list_tree count>0", data.get("count", 0) > 0, data.get("count"))

s, res = rpc("tools/call", {"name": "read_file", "arguments": {"path": "CHANGELOG.md", "limit": 5}})
check("read_file 200", s == 200, s)
ct = res.get("result", {}).get("content", [{}])[0].get("text", "")
data = json.loads(ct)
check("read_file ok", data.get("ok") is True, ct[:300])
check("read_file utf8", data.get("encoding") == "utf-8")
print("  first line:", data.get("content", "").splitlines()[:1])

print("== 4. write tools ==")
s, res = rpc("tools/call", {"name": "write_file", "arguments": {"path": "_mcp_test/hello.txt", "content": "xin chao\nline 2\n"}})
check("write_file ok", s == 200 and json.loads(res["result"]["content"][0]["text"]).get("ok"), str(res)[:200])

s, res = rpc("tools/call", {"name": "read_file", "arguments": {"path": "_mcp_test/hello.txt"}})
data = json.loads(res["result"]["content"][0]["text"])
check("read back", data.get("ok") and "xin chao" in data.get("content", ""))

s, res = rpc("tools/call", {"name": "append_file", "arguments": {"path": "_mcp_test/hello.txt", "content": "appended\n"}})
check("append ok", json.loads(res["result"]["content"][0]["text"]).get("ok"))

s, res = rpc("tools/call", {"name": "write_base64", "arguments": {"path": "_mcp_test/blob.bin", "data_base64": "aGVsbG8="}})
check("write_base64 ok", json.loads(res["result"]["content"][0]["text"]).get("ok"))

print("== 5. path traversal ==")
for bad in ["../CHANGELOG.md", "../../Windows/win.ini", "C:/Windows/win.ini", "/etc/passwd", "..\\..\\boot.ini"]:
    s, res = rpc("tools/call", {"name": "read_file", "arguments": {"path": bad}})
    data = json.loads(res["result"]["content"][0]["text"])
    check(f"reject {bad!r}", data.get("ok") is False, str(data)[:150])

s, res = rpc("tools/call", {"name": "write_file", "arguments": {"path": "../escape.txt", "content": "x"}})
data = json.loads(res["result"]["content"][0]["text"])
check("reject write traversal", data.get("ok") is False)

print("== 6. cleanup ==")
s, res = rpc("tools/call", {"name": "delete_file", "arguments": {"path": "_mcp_test/hello.txt"}})
check("delete file", json.loads(res["result"]["content"][0]["text"]).get("ok"))
s, res = rpc("tools/call", {"name": "delete_file", "arguments": {"path": "_mcp_test/blob.bin"}})
check("delete blob", json.loads(res["result"]["content"][0]["text"]).get("ok"))
s, res = rpc("tools/call", {"name": "delete_file", "arguments": {"path": "_mcp_test"}})
check("delete empty dir", json.loads(res["result"]["content"][0]["text"]).get("ok"))

print(f"\n== RESULT: {PASS} passed, {FAIL} failed ==")
client.__exit__(None, None, None)
raise SystemExit(1 if FAIL else 0)
