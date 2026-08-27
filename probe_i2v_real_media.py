import asyncio
import json
import os
import time
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

async def test_i2v_with_real_media_id():
    real_media_id = "0b2c2ca5-28ba-4bb6-b9e6-51ceba80edfd"
    project_id = "15e493d2-6465-4a3d-956f-a11c18d41e96"

    async with async_playwright() as p:
        browser = await p.chromium.connect_over_cdp('http://localhost:9222')
        context = browser.contexts[0]
        page = [pg for pg in context.pages if 'labs.google' in pg.url][0]

        session = await page.evaluate("async () => await (await fetch('/fx/api/auth/session')).json()")
        access_token = session['access_token']

        # Probe different field shapes for startImage / imageInputs
        candidates = [
            ("startImage name", {"startImage": {"name": real_media_id}}),
            ("startImage mediaId", {"startImage": {"mediaId": real_media_id}}),
            ("startImage imageMediaId", {"startImage": {"imageMediaId": real_media_id}}),
            ("imageInput name", {"imageInput": {"name": real_media_id}}),
            ("imageInputs array name", {"imageInputs": [{"name": real_media_id}]}),
            ("imageInputs array mediaId", {"imageInputs": [{"mediaId": real_media_id}]}),
            ("videoGenerationImageInputs name", {"videoGenerationImageInputs": [{"name": real_media_id}]}),
        ]

        for label, shape in candidates:
            res = await page.evaluate("""async (args) => {
                const token = await window.grecaptcha.enterprise.execute('6LdsFiUsAAAAAIjVDZcuLhaHiDn5nnHVXVRQGeMV', { action: 'FLOW_GENERATE' });
                const reqItem = {
                    aspectRatio: "VIDEO_ASPECT_RATIO_LANDSCAPE",
                    textInput: { structuredPrompt: { parts: [{ text: "Camera slow zoom in on lake" }] } },
                    videoModelKey: "veo_3_1_i2v_s_fast",
                    seed: 42,
                    metadata: {}
                };
                Object.assign(reqItem, args.shape);

                const body = {
                    mediaGenerationContext: { batchId: args.batchId, audioFailurePreference: "AUDIO_FAILURE_PREFERENCE_UNSPECIFIED" },
                    clientContext: {
                        projectId: args.projectId,
                        tool: "PINHOLE",
                        userPaygateTier: "PAYGATE_TIER_ONE",
                        sessionId: String(Date.now()),
                        recaptchaContext: { token: token, applicationType: "RECAPTCHA_APPLICATION_TYPE_WEB" }
                    },
                    requests: [reqItem],
                    useV2ModelConfig: true
                };

                const r = await fetch('https://aisandbox-pa.googleapis.com/v1/video:batchAsyncGenerateVideoStartImage', {
                    method: 'POST',
                    headers: { 'Authorization': 'Bearer ' + args.token, 'Content-Type': 'application/json' },
                    body: JSON.stringify(body)
                });
                let j = {}; try { j = await r.json(); } catch(e) { j = { text: await r.text() }; }
                return { status: r.status, json: j };
            }""", {'token': access_token, 'projectId': project_id, 'batchId': str(uuid.uuid4()), 'shape': shape})

            print(f"[{label}] Status: {res['status']}")
            if res['status'] == 200:
                print(f"  [SUCCESS 200!] Body: {json.dumps(res['json'], indent=2)}")
                os.makedirs('evidence/video/i2v', exist_ok=True)
                with open('evidence/video/i2v/request.json', 'w') as f:
                    json.dump(sanitize(shape), f, indent=2)
                with open('evidence/video/i2v/response.json', 'w') as f:
                    json.dump(sanitize(res['json']), f, indent=2)
                break
            else:
                msg = res['json'].get('error', {}).get('message', str(res['json']))
                print(f"  Error: {msg[:150]}")

asyncio.run(test_i2v_with_real_media_id())
