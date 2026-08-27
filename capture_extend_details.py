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

async def capture_extend_payload_details():
    async with async_playwright() as p:
        browser = await p.chromium.connect_over_cdp('http://localhost:9222')
        context = browser.contexts[0]
        page = [pg for pg in context.pages if 'labs.google' in pg.url][0]

        session = await page.evaluate("async () => await (await fetch('/fx/api/auth/session')).json()")
        access_token = session['access_token']

        # Get latest credits / project status
        cr = await page.evaluate("""async (token) => {
            const r = await fetch('https://aisandbox-pa.googleapis.com/v1/credits', { headers: { 'Authorization': 'Bearer ' + token } });
            return await r.json();
        }""", access_token)
        print('[+] Current credits:', cr)

        # Inspect latest media status to get the newly generated extend media ID
        status_res = await page.evaluate("""async (token) => {
            const r = await fetch('https://aisandbox-pa.googleapis.com/v1/video:batchCheckAsyncVideoGenerationStatus', {
                method: 'POST',
                headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
                body: JSON.stringify({ media: [{ name: 'd6e527a8-2089-4b2c-8e88-c7a26bd4a764', projectId: '15e493d2-6465-4a3d-956f-a11c18d41e96' }] })
            });
            return await r.json();
        }""", access_token)
        print('[+] Latest video status check:', json.dumps(status_res, indent=2)[:500])

asyncio.run(capture_extend_payload_details())
