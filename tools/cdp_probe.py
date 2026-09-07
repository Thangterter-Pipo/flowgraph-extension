#!/usr/bin/env python3
"""Minimal CDP helper for the FlowGraph test browser.

This script connects to the Chrome DevTools Protocol over the test profile's
debugging port, runs a single `Runtime.evaluate` in a chosen page, and prints a
sanitised subset of the result. It never prints tokens, cookies, or credentials.
"""
from __future__ import annotations

import argparse
import json
import sys
import urllib.request

import websocket  # type: ignore


REDACTED_KEYS = {
    "authorization",
    "cookie",
    "token",
    "access_token",
    "refresh_token",
    "session_cookie",
    "recaptcha",
    "recaptcha_token",
}


def sanitize(value):
    if isinstance(value, dict):
        return {
            k: ("<REDACTED>" if k.lower() in REDACTED_KEYS or "token" in k.lower() else sanitize(v))
            for k, v in value.items()
        }
    if isinstance(value, list):
        return [sanitize(v) for v in value]
    if isinstance(value, str) and len(value) > 200:
        return value[:200] + "..."
    return value


def find_page(cdp_port: int, pattern: str):
    with urllib.request.urlopen(f"http://127.0.0.1:{cdp_port}/json/list") as resp:
        pages = json.loads(resp.read().decode())
    for page in pages:
        if page.get("type") == "page" and pattern in page.get("url", ""):
            return page
    raise RuntimeError(f"No page matching {pattern!r}")


def evaluate(cdp_port: int, page_pattern: str, expression: str):
    page = find_page(cdp_port, page_pattern)
    ws_url = page["webSocketDebuggerUrl"]
    ws = websocket.create_connection(ws_url, timeout=15)
    ws.send(json.dumps({"id": 1, "method": "Runtime.evaluate", "params": {"expression": expression, "returnByValue": True, "awaitPromise": True}}))
    while True:
        msg = json.loads(ws.recv())
        if msg.get("id") == 1:
            ws.close()
            return sanitize(msg)


def main():
    parser = argparse.ArgumentParser(description="Run a CDP evaluate on a test Chrome page.")
    parser.add_argument("--port", type=int, default=9224)
    parser.add_argument("--url", default="labs.google/fx")
    parser.add_argument("--expr", required=True)
    parser.add_argument("--raw", action="store_true", help="Print raw JSON (caller is responsible for not leaking secrets).")
    args = parser.parse_args()
    result = evaluate(args.port, args.url, args.expr)
    if args.raw:
        print(json.dumps(result, indent=2))
    else:
        print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
