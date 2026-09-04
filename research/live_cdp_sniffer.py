import asyncio
import json
import os
import time
from playwright.async_api import async_playwright

STREAM_FILE = "evidence/live_stream.jsonl"

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
    os.makedirs("evidence", exist_ok=True)
    print("[CDP Sniffer] Connecting to Chrome CDP at port 9222...")
    async with async_playwright() as p:
        browser = await p.chromium.connect_over_cdp('http://localhost:9222')
        context = browser.contexts[0]
        page = [pg for pg in context.pages if 'labs.google' in pg.url][0]
        print(f"[CDP Sniffer] Attached to page: {page.url}")

        pending_requests = {}

        async def on_request(request):
            url = request.url
            if 'aisandbox-pa' in url or '/fx/api' in url:
                req_id = id(request)
                post_data = request.post_data
                parsed_post = None
                if post_data:
                    try:
                        parsed_post = json.loads(post_data)
                    except Exception:
                        parsed_post = post_data[:500]
                
                pending_requests[req_id] = {
                    "timestamp": time.time(),
                    "method": request.method,
                    "url": url,
                    "headers": sanitize(dict(request.headers)),
                    "post_data": sanitize(parsed_post)
                }

        async def on_response(response):
            url = response.url
            if 'aisandbox-pa' in url or '/fx/api' in url:
                req_id = id(response.request)
                req_info = pending_requests.pop(req_id, {
                    "timestamp": time.time(),
                    "method": response.request.method,
                    "url": url,
                    "headers": sanitize(dict(response.request.headers)),
                    "post_data": None
                })
                
                status = response.status
                headers = sanitize(dict(response.headers))
                body = None
                if status != 307 and 'image' not in headers.get('content-type', ''):
                    try:
                        text = await response.text()
                        try:
                            body = json.loads(text)
                        except Exception:
                            body = text[:1000]
                    except Exception as e:
                        body = f"<error reading response body: {e}>"

                entry = {
                    "time": time.strftime("%Y-%m-%d %H:%M:%S"),
                    "status": status,
                    "method": req_info["method"],
                    "url": url,
                    "request": req_info,
                    "response": sanitize(body)
                }

                print(f"[Captured {status}] {req_info['method']} {url.split('?')[0]}")
                with open(STREAM_FILE, "a", encoding="utf-8") as f:
                    f.write(json.dumps(entry, ensure_ascii=False) + "\n")

        page.on('request', on_request)
        page.on('response', on_response)

        print("[CDP Sniffer] Listening for network traffic... (Press Ctrl+C to stop)")
        while True:
            await asyncio.sleep(1)

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("[CDP Sniffer] Stopped.")
