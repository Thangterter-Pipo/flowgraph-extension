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

async def probe_upsample_detail():
    video_media_id = "9f714655-adcc-4c67-adb6-ad7847c4d49b"
    project_id = "15e493d2-6465-4a3d-956f-a11c18d41e96"

    async with async_playwright() as p:
        browser = await p.chromium.connect_over_cdp('http://localhost:9222')
        context = browser.contexts[0]
        page = [pg for pg in context.pages if 'labs.google' in pg.url][0]

        session = await page.evaluate("async () => await (await fetch('/fx/api/auth/session')).json()")
        access_token = session['access_token']

        # Try with videoGenerationVideoInputs + aspect ratio like edit
        shapes = [
            ("videoGenerationVideoInputs mediaId + aspectRatio", {
                "aspectRatio": "VIDEO_ASPECT_RATIO_LANDSCAPE",
                "videoGenerationVideoInputs": [{"mediaId": video_media_id}],
                "videoModelKey": "veo_3_1_upsampler_1080p"
            }),
            ("videoInput mediaId + aspectRatio + no model key", {
                "aspectRatio": "VIDEO_ASPECT_RATIO_LANDSCAPE",
                "videoInput": {"mediaId": video_media_id}
            }),
            ("videoInput mediaId + no aspect, just model key", {
                "videoInput": {"mediaId": video_media_id},
                "videoModelKey": "veo_3_1_upsampler_1080p"
            })
        ]

        for label, shape in shapes:
            res = await page.evaluate("""async (args) => {
                const token = await window.grecaptcha.enterprise.execute('6LdsFiUsAAAAAIjVDZcuLhaHiDn5nnHVXVRQGeMV', { action: 'FLOW_GENERATE' });
                const reqItem = { metadata: {} };
                Object.assign(reqItem, args.shape);

                const body = {
                    mediaGenerationContext: { batchId: args.batchId, audioFailurePreference: "AUDIO_FAILURE_PREFERENCE_UNSPECIFIED" },
                    clientContext: {
                        projectId: args.projectId, tool: "PINHOLE", userPaygateTier: "PAYGATE_TIER_ONE",
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
                return { status: r.status, json: j };
            }""", {'token': access_token, 'projectId': project_id, 'batchId': str(uuid.uuid4()), 'shape': shape})

            print(f"[{label}] Status: {res['status']}")
            msg = res['json'].get('error', {}).get('message', str(res['json']))
            print("  Error:", msg[:200])

asyncio.run(probe_upsample_detail())
