"""End-to-end test against the live local MCP server over real HTTP.

The test intentionally loads authentication from the environment or the local
``.env`` file. It must never embed or print the API key.
"""

from __future__ import annotations

import http.client
import json
import os
from pathlib import Path
import re


HOST = os.environ.get("FLOW_VEO_MCP_HOST", "127.0.0.1")
PORT = int(os.environ.get("FLOW_VEO_MCP_PORT", "3080"))
MCP_PATH = "/mcp"
PASS = 0
FAIL = 0
SESSION: dict[str, str | None] = {"id": None}


def load_api_key() -> str:
    configured = os.environ.get("FLOW_VEO_MCP_API_KEY", "").strip()
    if configured:
        return configured

    env_path = Path(__file__).with_name(".env")
    if env_path.is_file():
        for raw_line in env_path.read_text(encoding="utf-8").splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            name, value = line.split("=", 1)
            if name.strip() == "FLOW_VEO_MCP_API_KEY":
                return value.strip().strip('"').strip("'")

    raise SystemExit(
        "FLOW_VEO_MCP_API_KEY is not configured in the environment or mcp_server/.env"
    )


KEY = load_api_key()


def check(label: str, condition: bool, extra: object = "") -> None:
    global PASS, FAIL
    if condition:
        PASS += 1
        print(f"  PASS  {label}")
    else:
        FAIL += 1
        print(f"  FAIL  {label}  {extra}")


def parse_response(raw: str, content_type: str) -> dict | None:
    if "text/event-stream" in content_type:
        match = re.search(r"data:\s*(\{.*\})", raw, re.S)
        return json.loads(match.group(1)) if match else None
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return None


def call(method: str, params: dict | None = None, key: str = KEY):
    body: dict[str, object] = {"jsonrpc": "2.0", "id": 7, "method": method}
    if params is not None:
        body["params"] = params
    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
        "Authorization": f"Bearer {key}",
    }
    if SESSION["id"]:
        headers["Mcp-Session-Id"] = str(SESSION["id"])

    connection = http.client.HTTPConnection(HOST, PORT, timeout=15)
    connection.request("POST", MCP_PATH, json.dumps(body), headers)
    response = connection.getresponse()
    status = response.status
    raw = response.read().decode()
    session_id = response.getheader("mcp-session-id")
    content_type = response.getheader("content-type", "")
    if session_id:
        SESSION["id"] = session_id
    connection.close()
    return status, parse_response(raw, content_type), raw


print("== E2E over real HTTP ==")

connection = http.client.HTTPConnection(HOST, PORT, timeout=10)
connection.request("GET", "/health")
response = connection.getresponse()
check("health 200", response.status == 200, response.status)
check("health body ok", "ok" in response.read().decode())
connection.close()

connection = http.client.HTTPConnection(HOST, PORT, timeout=10)
connection.request(
    "POST",
    MCP_PATH,
    json.dumps({}),
    {"Content-Type": "application/json", "Accept": "application/json, text/event-stream"},
)
response = connection.getresponse()
check("no-auth 401", response.status == 401, response.status)
response.read()
connection.close()

status, obj, _ = call(
    "initialize",
    {
        "protocolVersion": "2025-03-26",
        "capabilities": {},
        "clientInfo": {"name": "e2e", "version": "1"},
    },
)
check("init 200", status == 200, status)
check("session id set", bool(SESSION["id"]))

status, obj, raw = call("tools/list")
tools = (obj or {}).get("result", {}).get("tools", [])
names = [tool.get("name") for tool in tools]
check("tools/list", status == 200 and len(names) >= 12, f"status={status}, count={len(names)}")

status, obj, raw = call(
    "tools/call", {"name": "list_tree", "arguments": {"path": "docs", "max_depth": 2}}
)
content_text = (obj or {}).get("result", {}).get("content", [{}])[0].get("text", "{}")
data = json.loads(content_text)
check("list_tree docs ok", data.get("ok") is True, content_text[:200])
print("  docs entries:", data.get("count"))

status, obj, raw = call(
    "tools/call",
    {"name": "write_file", "arguments": {"path": "_e2e/tmp.txt", "content": "e2e"}},
)
data = json.loads((obj or {}).get("result", {}).get("content", [{}])[0].get("text", "{}"))
check("write over wire", data.get("ok") is True, raw[:200])

status, obj, raw = call(
    "tools/call", {"name": "read_file", "arguments": {"path": "_e2e/tmp.txt"}}
)
data = json.loads((obj or {}).get("result", {}).get("content", [{}])[0].get("text", "{}"))
check("read over wire", "e2e" in data.get("content", ""), raw[:200])

call("tools/call", {"name": "delete_file", "arguments": {"path": "_e2e/tmp.txt"}})
status, obj, raw = call(
    "tools/call", {"name": "delete_file", "arguments": {"path": "_e2e"}}
)
data = json.loads((obj or {}).get("result", {}).get("content", [{}])[0].get("text", "{}"))
check("cleanup", data.get("message") == "deleted", raw[:200])

print(f"\n== RESULT: {PASS} passed, {FAIL} failed ==")
raise SystemExit(1 if FAIL else 0)
