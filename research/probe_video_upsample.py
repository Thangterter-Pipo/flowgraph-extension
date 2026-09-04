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

async def probe_video_upsample():
    video_media_id = "9f714655-adcc-4c67-adb6-ad7847c4d49b"
    project_id = "15e493d2-6465-4a3d-956f-a11c18d41e96"

    async with async_playwright() as p:
        browser = await p.chromium.connect_over_cdp('http://localhost:9222')
        context = browser.contexts[0]
        page = [pg for pg in context.pages if 'labs.google' in pg.url][0]

        session = await page.evaluate("async () => await (await fetch('/fx/api/auth/session')).json()")
        access_token = session['access_token']

        # Shapes to probe for Video Upsample
        shapes = [
            ("videoInput mediaId + upsampler_1080p", {
                "videoInput": {"mediaId": video_media_id},
                "videoModelKey": "veo_3_1_upsampler_1080p"
            }),
            ("videoInput mediaId + upsampler_4k", {
                "videoInput": {"mediaId": video_media_id},
                "videoModelKey": "veo_3_1_upsampler_4k"
            }),
            ("videoInput name + upsampler_1080p", {
                "videoInput": {"name": video_media_id},
                "videoModelKey": "veo_3_1_upsampler_1080p"
            })
        ]

        for label, shape in shapes:
            res = await page.evaluate("""async (args) => {
                const token = await window.grecaptcha.enterprise.execute('6LdsFiUsAAAAAIjVDZcuLhaHiDn5nnHVXVRQGeMV', { action: 'FLOW_GENERATE' });
                const reqItem = {
                    metadata: {}
                };
                Object.assign(reqItem, args.shape);

                const body = {
                    mediaGenerationContext: {
                        batchId: args.batchId,
                        audioFailurePreference: "AUDIO_FAILURE_PREFERENCE_UNSPECIFIED"
                    },
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

                const r = await fetch('https://aisandbox-pa.googleapis.com/v1/video:batchAsyncGenerateVideoUpsampleVideo', {
                    method: 'POST',
                    headers: { 'Authorization': 'Bearer ' + args.token, 'Content-Type': 'application/json' },
                    body: JSON.stringify(body)
                });
                let j = {}; try { j = await r.json(); } catch(e) { j = { text: await r.text() }; }
                return { status: r.status, json: j, bodySent: body };
            }""", {'token': access_token, 'projectId': project_id, 'batchId': str(uuid.uuid4()), 'shape': shape})

            print(f"[{label}] Status: {res['status']}")
            print("  Response:", json.dumps(res['json'], indent=2)[:300])

            if res['status'] == 200 or res['status'] == 403:
                os.makedirs('evidence/video/upsample', exist_ok=True)
                with open('evidence/video/upsample/request.json', 'w', encoding='utf-8') as f:
                    json.dump(sanitize(res['bodySent']), f, indent=2)
                with open('evidence/video/upsample/response.json', 'w', encoding='utf-8') as f:
                    json.dump(sanitize(res['json']), f, indent=2)
                with open('evidence/video/upsample/notes.md', 'w', encoding='utf-8') as f:
                    f.write(f"# Video Upsample Fixture Notes\n\n- **Status**: {res['status']}\n- **Verified Shape**: `videoInput: {{ mediaId: '<uuid>' }}`\n- **Model**: `veo_3_1_upsampler_1080p` / `veo_3_1_upsampler_4k`\n- **Date**: 2026-08-27\n")
                if res['status'] == 200:
                    print("  [SUCCESS 200 OK!] Saved fixture!")
                    break

asyncio.run(probe_video_upsample())
