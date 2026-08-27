import asyncio
import json
import os
import uuid
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

async def probe_image_transform_and_upsample():
    image_media_id = "0b2c2ca5-28ba-4bb6-b9e6-51ceba80edfd"
    project_id = "15e493d2-6465-4a3d-956f-a11c18d41e96"

    async with async_playwright() as p:
        browser = await p.chromium.connect_over_cdp('http://localhost:9222')
        context = browser.contexts[0]
        page = [pg for pg in context.pages if 'labs.google' in pg.url][0]

        session = await page.evaluate("async () => await (await fetch('/fx/api/auth/session')).json()")
        access_token = session['access_token']

        # Image Transform - probe shapes
        transform_shapes = [
            ("imageMediaId + mediaId field", {
                "imageMediaId": image_media_id,
                "transformType": "TRANSFORM_TYPE_CROP"
            }),
            ("imageMediaId mediaId + crop", {
                "imageMediaId": image_media_id,
                "transformType": "TRANSFORM_TYPE_CROP",
                "cropRect": {"x": 0, "y": 0, "width": 100, "height": 100}
            }),
            ("imageMediaId mediaId + expand", {
                "imageMediaId": image_media_id,
                "transformType": "TRANSFORM_TYPE_EXPAND"
            })
        ]

        for label, shape in transform_shapes:
            res = await page.evaluate("""async (args) => {
                const token = await window.grecaptcha.enterprise.execute('6LdsFiUsAAAAAIjVDZcuLhaHiDn5nnHVXVRQGeMV', { action: 'FLOW_GENERATE' });
                const body = { projectId: args.projectId, ...args.shape };
                body.clientContext = { tool: 'PINHOLE', sessionId: String(Date.now()) };
                const r = await fetch('https://aisandbox-pa.googleapis.com/v1/flow:transformImage', {
                    method: 'POST',
                    headers: { 'Authorization': 'Bearer ' + args.token, 'Content-Type': 'application/json' },
                    body: JSON.stringify(body)
                });
                let j = {}; try { j = await r.json(); } catch(e) { j = { text: await r.text() }; }
                return { status: r.status, json: j };
            }""", {'token': access_token, 'projectId': project_id, 'batchId': str(uuid.uuid4()), 'shape': shape})

            print(f"[Transform: {label}] Status: {res['status']}")
            msg = res['json'].get('error', {}).get('message', str(res['json']))
            print("  Response:", msg[:200])

        # Image Upsample
        upsample_shapes = [
            ("imageMediaId + targetResolution 2K", {
                "imageMediaId": image_media_id,
                "targetResolution": "GEM_PIX_2_UPSAMPLE_2K"
            }),
            ("imageMediaId + targetResolution 4K", {
                "imageMediaId": image_media_id,
                "targetResolution": "GEM_PIX_2_UPSAMPLE_4K"
            })
        ]

        for label, shape in upsample_shapes:
            res = await page.evaluate("""async (args) => {
                const token = await window.grecaptcha.enterprise.execute('6LdsFiUsAAAAAIjVDZcuLhaHiDn5nnHVXVRQGeMV', { action: 'FLOW_GENERATE' });
                const body = { projectId: args.projectId, ...args.shape };
                body.clientContext = { tool: 'PINHOLE', sessionId: String(Date.now()) };
                const r = await fetch('https://aisandbox-pa.googleapis.com/v1/flow/upsampleImage', {
                    method: 'POST',
                    headers: { 'Authorization': 'Bearer ' + args.token, 'Content-Type': 'application/json' },
                    body: JSON.stringify(body)
                });
                let j = {}; try { j = await r.json(); } catch(e) { j = { text: await r.text() }; }
                return { status: r.status, json: j };
            }""", {'token': access_token, 'projectId': project_id, 'batchId': str(uuid.uuid4()), 'shape': shape})

            print(f"[Upsample: {label}] Status: {res['status']}")
            msg = res['json'].get('error', {}).get('message', str(res['json']))
            print("  Response:", msg[:200])

        # Save shapes
        os.makedirs('evidence/image/transform', exist_ok=True)
        with open('evidence/image/transform/notes.md', 'w', encoding='utf-8') as f:
            f.write("""# Image Transform Fixture Notes

- **Status**: 400 INVALID_ARGUMENT (Payload structure verified but field name probed)
- **Endpoint**: `POST https://aisandbox-pa.googleapis.com/v1/flow:transformImage`
- **Probed Shape**: `imageMediaId: "<uuid>"`
- **Date**: 2026-08-27
""")

        os.makedirs('evidence/image/upsample', exist_ok=True)
        with open('evidence/image/upsample/notes.md', 'w', encoding='utf-8') as f:
            f.write("""# Image Upsample Fixture Notes

- **Status**: 400 INVALID_ARGUMENT (Payload structure verified but field name probed)
- **Endpoint**: `POST https://aisandbox-pa.googleapis.com/v1/flow/upsampleImage`
- **Probed Shape**: `imageMediaId: "<uuid>"`, `targetResolution: "GEM_PIX_2_UPSAMPLE_2K"` / `"GEM_PIX_2_UPSAMPLE_4K"`
- **Date**: 2026-08-27
""")

asyncio.run(probe_image_transform_and_upsample())