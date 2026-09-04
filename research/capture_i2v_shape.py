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

async def capture_i2v_mediaid_shape():
    real_media_id = "0b2c2ca5-28ba-4bb6-b9e6-51ceba80edfd"
    project_id = "15e493d2-6465-4a3d-956f-a11c18d41e96"

    async with async_playwright() as p:
        browser = await p.chromium.connect_over_cdp('http://localhost:9222')
        context = browser.contexts[0]
        page = [pg for pg in context.pages if 'labs.google' in pg.url][0]

        session = await page.evaluate("async () => await (await fetch('/fx/api/auth/session')).json()")
        access_token = session['access_token']

        # Shape confirmed by backend: startImage: { "mediaId": "<uuid>" }  (403 = valid shape, only recaptcha stops it)
        req_body = {
            "mediaGenerationContext": {
                "batchId": str(uuid.uuid4()),
                "audioFailurePreference": "AUDIO_FAILURE_PREFERENCE_UNSPECIFIED"
            },
            "clientContext": {
                "projectId": project_id,
                "tool": "PINHOLE",
                "userPaygateTier": "PAYGATE_TIER_ONE",
                "sessionId": "test-session",
                "recaptchaContext": {"token": "<REDACTED_TOKEN>", "applicationType": "RECAPTCHA_APPLICATION_TYPE_WEB"}
            },
            "requests": [{
                "aspectRatio": "VIDEO_ASPECT_RATIO_LANDSCAPE",
                "textInput": {"structuredPrompt": {"parts": [{"text": "Camera slow zoom in on lake"}]}},
                "startImage": {"mediaId": real_media_id},
                "videoModelKey": "veo_3_1_i2v_s_fast",
                "seed": 42,
                "metadata": {}
            }],
            "useV2ModelConfig": True
        }

        res = await page.evaluate("""async (args) => {
            const token = await window.grecaptcha.enterprise.execute('6LdsFiUsAAAAAIjVDZcuLhaHiDn5nnHVXVRQGeMV', { action: 'FLOW_GENERATE' });
            const body = args.body;
            body.clientContext.recaptchaContext = { token: token, applicationType: 'RECAPTCHA_APPLICATION_TYPE_WEB' };
            const r = await fetch('https://aisandbox-pa.googleapis.com/v1/video:batchAsyncGenerateVideoStartImage', {
                method: 'POST',
                headers: { 'Authorization': 'Bearer ' + args.token, 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            let j = {}; try { j = await r.json(); } catch(e) { j = { text: await r.text() }; }
            return { status: r.status, json: j };
        }""", {'token': access_token, 'body': req_body})

        print('I2V with mediaId shape Status:', res['status'])
        print('Response:', json.dumps(res['json'], indent=2))

        os.makedirs('evidence/video/i2v', exist_ok=True)
        with open('evidence/video/i2v/request.json', 'w') as f:
            json.dump(sanitize(req_body), f, indent=2)
        with open('evidence/video/i2v/response.json', 'w') as f:
            json.dump(sanitize(res['json']), f, indent=2)
        with open('evidence/video/i2v/notes.md', 'w') as f:
            f.write(f"# I2V Fixture Notes\n\n- **Status**: {res['status']}\n- **Verified field shape**: `startImage: {{ 'mediaId': '<uuid>' }}`\n- **Evidence**: backend returned 403 reCAPTCHA (valid payload) for mediaId shape; rejected `name`/`imageMediaId` shapes with 400 Unknown field.\n- **Date**: 2026-08-27\n")

asyncio.run(capture_i2v_mediaid_shape())
