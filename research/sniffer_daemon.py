import asyncio
import json
import os
import time
from playwright.async_api import async_playwright

BASE = os.path.dirname(os.path.abspath(__file__))
STREAM_FILE = os.path.join(BASE, "evidence", "live_stream.jsonl")

def sanitize(obj):
    if isinstance(obj, dict):
        res = {}
        for k, v in obj.items():
            if k.lower() in ('authorization', 'cookie', 'token', 'access_token', 'session_cookie') or 'token' in k.lower():
                res[k] = '<REDACTED_TOKEN>'
            elif k.lower() in ('email', 'name', 'image', 'user') and isinstance(v, str):
                res[k] = '<REDACTED_PII>'
            else:
                res[k] = sanitize(v)
        return res
    elif isinstance(obj, list):
        return [sanitize(i) for i in obj]
    return obj

async def main():
    os.makedirs(os.path.dirname(STREAM_FILE), exist_ok=True)
    async with async_playwright() as p:
        browser = await p.chromium.connect_over_cdp('http://localhost:9222')
        context = browser.contexts[0]
        page = [pg for pg in context.pages if 'labs.google' in pg.url][0]
        print(f"[Sniffer] Attached: {page.url}")

        async def on_req(req):
            url = req.url
            if 'aisandbox-pa' in url or '/fx/api' in url:
                pd = req.post_data
                try:
                    pd = json.loads(pd) if pd else None
                except Exception:
                    pass
                entry = {"time": time.strftime("%Y-%m-%d %H:%M:%S"), "kind": "req", "method": req.method, "url": url, "body": sanitize(pd)}
                with open(STREAM_FILE, "a", encoding="utf-8") as f:
                    f.write(json.dumps(entry, ensure_ascii=False) + "\n")
                print(f"[REQ] {req.method} {url.split('?')[0]}")

        async def on_res(res):
            url = res.url
            if 'aisandbox-pa' in url or '/fx/api' in url:
                try:
                    txt = await res.text()
                    try:
                        body = json.loads(txt)
                    except Exception:
                        body = txt[:800]
                except Exception:
                    body = None
                entry = {"time": time.strftime("%Y-%m-%d %H:%M:%S"), "kind": "res", "status": res.status, "url": url, "body": sanitize(body)}
                with open(STREAM_FILE, "a", encoding="utf-8") as f:
                    f.write(json.dumps(entry, ensure_ascii=False) + "\n")
                print(f"[RES {res.status}] {url.split('?')[0]}")

        page.on('request', on_req)
        page.on('response', on_res)
        print("[Sniffer] Listening... Ctrl+C to stop")
        while True:
            await asyncio.sleep(1)

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("[Sniffer] Stopped.")
