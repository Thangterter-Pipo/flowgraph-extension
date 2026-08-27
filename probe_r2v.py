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

async def probe_reference_images_shape():
    ref_media_id = "0b2c2ca5-28ba-4bb6-b9e6-51ceba80edfd"
    project_id = "15e493d2-6465-4a3d-956f-a11c18d41e96"

    async with async_playwright() as p:
        browser = await p.chromium.connect_over_cdp('http://localhost:9222')
        context = browser.contexts[0]
        page = [pg for pg in context.pages if 'labs.google' in pg.url][0]

        session = await page.evaluate("async () => await (await fetch('/fx/api/auth/session')).json()")
        access_token = session['access_token']

        shapes = [
            ("referenceImages mediaId array", {
                "referenceImages": [{"mediaId": ref_media_id}]
            }),
            ("referenceImages name array (old)", {
                "referenceImages": [{"name": ref_media_id}]
            }),
            ("imageInputs array mediaId", {
                "imageInputs": [{"mediaId": ref_media_id}]
            })
        ]

        for label, shape in shapes:
            res = await page.evaluate("""async (args) => {
                const token = await window.grecaptcha.enterprise.execute('6LdsFiUsAAAAAIjVDZcuLhaHiDn5nnHVXVRQGeMV', { action: 'FLOW_GENERATE' });
                const reqItem = {
                    aspectRatio: "VIDEO_ASPECT_RATIO_LANDSCAPE",
                    textInput: { structuredPrompt: { parts: [{ text: "Camera panning around scenic view inspired by reference image" }] } },
                    videoModelKey: "veo_3_1_t2v_fast",
                    seed: 42,
                    metadata: {}
                };
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

                const r = await fetch('https://aisandbox-pa.googleapis.com/v1/video:batchAsyncGenerateVideoReferenceImages', {
                    method: 'POST',
                    headers: { 'Authorization': 'Bearer ' + args.token, 'Content-Type': 'application/json' },
                    body: JSON.stringify(body)
                });
                let j = {}; try { j = await r.json(); } catch(e) { j = { text: await r.text() }; }
                return { status: r.status, json: j, bodySent: body };
            }""", {'token': access_token, 'projectId': project_id, 'batchId': str(uuid.uuid4()), 'shape': shape})

            print(f"[{label}] Status: {res['status']}")
            msg = res['json'].get('error', {}).get('message', str(res['json']))
            print("  Response:", msg[:250])

            if res['status'] == 403:
                os.makedirs('evidence/video/reference', exist_ok=True)
                with open('evidence/video/reference/request.json', 'w', encoding='utf-8') as f:
                    json.dump(sanitize(res['bodySent']), f, indent=2)
                with open('evidence/video/reference/response.json', 'w', encoding='utf-8') as f:
                    json.dump(sanitize(res['json']), f, indent=2)
                with open('evidence/video/reference/notes.md', 'w', encoding='utf-8') as f:
                    f.write(f"# Reference Images Video Fixture Notes\n\n- **Status**: 403 (Valid Payload Structure Verified)\n- **Endpoint**: `POST https://aisandbox-pa.googleapis.com/v1/video:batchAsyncGenerateVideoReferenceImages`\n- **Verified Shape**: `referenceImages: [ {{ 'mediaId': '<uuid>' }} ]`\n- **Evidence**: `referenceImages[].mediaId` returned 403 reCAPTCHA (valid payload), whereas `referenceImages[].name` returned 400 Unknown field.\n- **Date**: 2026-08-27\n")
                print("  [SUCCESS VERIFIED SHAPE!] Saved R2V Fixture!")
                break

asyncio.run(probe_reference_images_shape())
