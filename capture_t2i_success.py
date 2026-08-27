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

async def capture_t2i():
    project_id = "15e493d2-6465-4a3d-956f-a11c18d41e96"

    async with async_playwright() as p:
        browser = await p.chromium.connect_over_cdp('http://localhost:9222')
        context = browser.contexts[0]
        page = [pg for pg in context.pages if 'labs.google' in pg.url][0]

        session = await page.evaluate("async () => await (await fetch('/fx/api/auth/session')).json()")
        access_token = session['access_token']

        # Execute reCAPTCHA in page context to get valid token
        res = await page.evaluate("""async (args) => {
            const recaptchaToken = await window.grecaptcha.enterprise.execute('6LdsFiUsAAAAAIjVDZcuLhaHiDn5nnHVXVRQGeMV', { action: 'FLOW_GENERATE' });
            
            const body = {
                clientContext: {
                    recaptchaContext: {
                        token: recaptchaToken,
                        applicationType: "RECAPTCHA_APPLICATION_TYPE_WEB"
                    },
                    projectId: args.projectId,
                    tool: "PINHOLE",
                    sessionId: String(Date.now())
                },
                mediaGenerationContext: {
                    batchId: args.batchId
                },
                useNewMedia: true,
                requests: [
                    {
                        clientContext: {
                            recaptchaContext: {
                                token: recaptchaToken,
                                applicationType: "RECAPTCHA_APPLICATION_TYPE_WEB"
                            },
                            projectId: args.projectId,
                            tool: "PINHOLE",
                            sessionId: String(Date.now())
                        },
                        imageModelName: "GEM_PIX_2",
                        imageAspectRatio: "IMAGE_ASPECT_RATIO_LANDSCAPE",
                        structuredPrompt: {
                            parts: [
                                { text: "A cute fluffy kitten sleeping in a sunlit basket, 4k digital art" }
                            ]
                        },
                        seed: 12345,
                        imageInputs: []
                    }
                ]
            };

            const r = await fetch('https://aisandbox-pa.googleapis.com/v1/projects/' + args.projectId + '/flowMedia:batchGenerateImages', {
                method: 'POST',
                headers: {
                    'Authorization': 'Bearer ' + args.token,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(body)
            });

            let j = {};
            try { j = await r.json(); } catch(e) { j = { text: await r.text() }; }
            return { status: r.status, json: j, bodySent: body };
        }""", {'token': access_token, 'projectId': project_id, 'batchId': str(uuid.uuid4())})

        print('[+] T2I Request Status:', res['status'])
        print('[+] Response Body:', json.dumps(res['json'], indent=2)[:500])

        if res['status'] == 200:
            os.makedirs('evidence/image/t2i', exist_ok=True)
            with open('evidence/image/t2i/request.json', 'w', encoding='utf-8') as f:
                json.dump(sanitize(res['bodySent']), f, indent=2)
            with open('evidence/image/t2i/response.json', 'w', encoding='utf-8') as f:
                json.dump(sanitize(res['json']), f, indent=2)
            with open('evidence/image/t2i/notes.md', 'w', encoding='utf-8') as f:
                f.write(f"# T2I Fixture Notes\n\n- **Status**: 200 OK\n- **Model**: `GEM_PIX_2` (Nano Banana Pro)\n- **Cost**: 0 Credits\n- **Date**: 2026-08-27\n")

asyncio.run(capture_t2i())
