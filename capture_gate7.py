import asyncio
import json
import os
from playwright.async_api import async_playwright


def sanitize(obj):
    if isinstance(obj, dict):
        res = {}
        for k, v in obj.items():
            kl = k.lower()
            if kl in ("authorization", "cookie", "token", "access_token", "session_cookie") or "token" in kl:
                res[k] = "<REDACTED_TOKEN>"
            elif kl in ("email", "name", "image", "user") and isinstance(v, str):
                res[k] = "<REDACTED_PII>"
            else:
                res[k] = sanitize(v)
        return res
    if isinstance(obj, list):
        return [sanitize(i) for i in obj]
    return obj


async def capture_likeness_and_recaptcha():
    async with async_playwright() as p:
        browser = await p.chromium.connect_over_cdp("http://localhost:9222")
        context = browser.contexts[0]
        page = [pg for pg in context.pages if "labs.google" in pg.url][0]

        session = await page.evaluate("async () => await (await fetch('/fx/api/auth/session')).json()")
        access_token = session["access_token"]

        os.makedirs("evidence/likeness", exist_ok=True)
        os.makedirs("evidence/recaptcha", exist_ok=True)

        # 1) Likeness eligibility
        elig_res = await page.evaluate(
            """async (token) => {
                const r = await fetch('https://aisandbox-pa.googleapis.com/v1/flow/likeness:checkEligibility', {
                    headers: { 'Authorization': 'Bearer ' + token }
                });
                let j = {}; try { j = await r.json(); } catch(e) {}
                return { status: r.status, json: j };
            }""",
            access_token,
        )
        with open("evidence/likeness/eligibility_response.json", "w", encoding="utf-8") as f:
            json.dump(sanitize(elig_res["json"]), f, indent=2)

        # 2) List user likenesses: preserve HTTP status as evidence metadata.
        list_res = await page.evaluate(
            """async (token) => {
                const r = await fetch('https://aisandbox-pa.googleapis.com/v1/flow/likeness:listUserLikenesses?populateImage=true', {
                    headers: { 'Authorization': 'Bearer ' + token }
                });
                let j = {}; try { j = await r.json(); } catch(e) {}
                return { status: r.status, contentType: r.headers.get('content-type'), json: j };
            }""",
            access_token,
        )
        with open("evidence/likeness/list_response.json", "w", encoding="utf-8") as f:
            json.dump(sanitize(list_res["json"]), f, indent=2)
        with open("evidence/likeness/list_capture_meta.json", "w", encoding="utf-8") as f:
            json.dump(
                {
                    "evidenceKind": "runtime_direct",
                    "httpStatus": list_res["status"],
                    "contentType": list_res["contentType"],
                    "response": sanitize(list_res["json"]),
                },
                f,
                indent=2,
            )

        # 3) Negative reCAPTCHA control.
        # IMPORTANT: this uses an INVALID token. It proves rejection of invalid/unapproved
        # tokens only. It does NOT prove replay/single-use behavior of a previously valid token.
        invalid_token_res = await page.evaluate(
            """async (token) => {
                const r = await fetch('https://aisandbox-pa.googleapis.com/v1/video:batchAsyncGenerateVideoText', {
                    method: 'POST',
                    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        mediaGenerationContext: { batchId: 'negative-control-invalid-recaptcha' },
                        clientContext: {
                            tool: 'PINHOLE',
                            sessionId: '1',
                            recaptchaContext: {
                                token: 'INVALID_RECAPTCHA_TOKEN',
                                applicationType: 'RECAPTCHA_APPLICATION_TYPE_WEB'
                            }
                        },
                        requests: [{
                            aspectRatio: 'VIDEO_ASPECT_RATIO_LANDSCAPE',
                            textInput: { structuredPrompt: { parts: [{ text: 'negative control' }] } },
                            videoModelKey: 'veo_3_1_t2v_fast'
                        }],
                        useV2ModelConfig: true
                    })
                });
                let j = {}; try { j = await r.json(); } catch(e) {}
                return { status: r.status, json: j };
            }""",
            access_token,
        )
        with open("evidence/recaptcha/invalid_token_response.json", "w", encoding="utf-8") as f:
            json.dump(sanitize(invalid_token_res["json"]), f, indent=2)
        with open("evidence/recaptcha/batch_notes.json", "w", encoding="utf-8") as f:
            json.dump(
                {
                    "invalid_token_rejection_verified": invalid_token_res["status"] == 403,
                    "httpStatus": invalid_token_res["status"],
                    "errorStatus": invalid_token_res["json"].get("error", {}).get("status"),
                    "single_use_replay_verified": False,
                    "batch_boundary_verified": False,
                    "notes": "Negative control only. A real previously-valid-token replay capture is still required to prove single-use semantics."
                },
                f,
                indent=2,
            )


asyncio.run(capture_likeness_and_recaptcha())
