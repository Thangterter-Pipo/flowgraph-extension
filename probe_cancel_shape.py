import asyncio
import json
import os
from playwright.async_api import async_playwright

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

async def test_cancel_correct_shape():
    media_id = "b834294a-0e9a-4dd3-b2ff-f6cfdeb30550"

    async with async_playwright() as p:
        browser = await p.chromium.connect_over_cdp('http://localhost:9222')
        context = browser.contexts[0]
        page = [pg for pg in context.pages if 'labs.google' in pg.url][0]

        session = await page.evaluate("async () => await (await fetch('/fx/api/auth/session')).json()")
        access_token = session['access_token']

        shapes = [
            ("name field", {"name": media_id}),
            ("mediaId field", {"mediaId": media_id}),
            ("mediaName field", {"mediaName": media_id})
        ]

        for label, shape in shapes:
            res = await page.evaluate("""async (args) => {
                const r = await fetch('https://aisandbox-pa.googleapis.com/v1/flowMedia:cancelGeneration', {
                    method: 'POST',
                    headers: { 'Authorization': 'Bearer ' + args.token, 'Content-Type': 'application/json' },
                    body: JSON.stringify(args.shape)
                });
                let j = {}; try { j = await r.json(); } catch(e) { j = { text: await r.text() }; }
                return { status: r.status, json: j };
            }""", {'token': access_token, 'shape': shape})

            print(f"[Cancel Probe: {label}] Status: {res['status']}")
            print("  Response:", json.dumps(res['json'], indent=2))

            if res['status'] != 400 or "Unknown name" not in str(res['json']):
                print(f"  [VERIFIED FIELD SHAPE!] {label} is parsed by backend!")
                with open('evidence/cancel/request.json', 'w', encoding='utf-8') as f:
                    json.dump(sanitize(shape), f, indent=2)
                with open('evidence/cancel/response.json', 'w', encoding='utf-8') as f:
                    json.dump(sanitize(res['json']), f, indent=2)
                break

asyncio.run(test_cancel_correct_shape())
