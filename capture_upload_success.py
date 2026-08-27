import asyncio
import json
import os
import time
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

async def capture_upload_response():
    async with async_playwright() as p:
        browser = await p.chromium.connect_over_cdp('http://localhost:9222')
        context = browser.contexts[0]
        page = [pg for pg in context.pages if 'labs.google' in pg.url][0]

        upload_req = None
        upload_res = None

        async def on_request(req):
            nonlocal upload_req
            if '/uploadImage' in req.url:
                upload_req = {
                    'url': req.url,
                    'method': req.method,
                    'post_data': req.post_data
                }

        async def on_response(res):
            nonlocal upload_res
            if '/uploadImage' in res.url:
                try:
                    text = await res.text()
                    try:
                        j = json.loads(text)
                    except Exception:
                        j = text
                    upload_res = {'status': res.status, 'body': j}
                except Exception as e:
                    upload_res = {'status': res.status, 'error': str(e)}

        page.on('request', on_request)
        page.on('response', on_response)

        test_img = os.path.abspath('evidence/upload/test_upload.png')
        file_input = page.locator('input[type="file"]')
        await file_input.first.set_input_files(test_img)
        print('[+] Image file uploaded to UI. Waiting for uploadImage response...')
        
        for _ in range(10):
            if upload_res:
                break
            await asyncio.sleep(1)

        print('[+] Upload Image Status:', upload_res.get('status') if upload_res else 'No response captured')
        if upload_res:
            print('[+] Upload Image Response Body:', json.dumps(upload_res['body'], indent=2))
            
            # Save fixture
            os.makedirs('evidence/upload/image', exist_ok=True)
            with open('evidence/upload/image/request.json', 'w', encoding='utf-8') as f:
                req_json = json.loads(upload_req['post_data']) if upload_req and upload_req['post_data'] else {}
                if 'imageBytes' in req_json:
                    req_json['imageBytes'] = '<BASE64_IMAGE_BYTES_LEN_' + str(len(req_json['imageBytes'])) + '>'
                json.dump(sanitize(req_json), f, indent=2)
            with open('evidence/upload/image/response.json', 'w', encoding='utf-8') as f:
                json.dump(sanitize(upload_res['body']), f, indent=2)
            with open('evidence/upload/image/notes.md', 'w', encoding='utf-8') as f:
                f.write(f"# Image Upload Fixture Notes\n\n- **Status**: {upload_res['status']}\n- **Verified Runtime Field**: `imageBytes` (base64 raw string without data URI scheme)\n- **Captured Date**: 2026-08-27\n")

asyncio.run(capture_upload_response())
