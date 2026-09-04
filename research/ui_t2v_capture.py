import asyncio
import json
import os
import time
from playwright.async_api import async_playwright

STREAM = "evidence/ui_capture_stream.jsonl"

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

def log_entry(kind, status, method, url, body):
    entry = {
        "time": time.strftime("%Y-%m-%d %H:%M:%S"),
        "kind": kind,
        "status": status,
        "method": method,
        "url": url,
        "body": sanitize(body)
    }
    with open(STREAM, "a", encoding="utf-8") as f:
        f.write(json.dumps(entry, ensure_ascii=False) + "\n")
    print(f"  [{kind} {status}] {method} {url.split('?')[0]}")

async def trigger_t2v_ui():
    async with async_playwright() as p:
        browser = await p.chromium.connect_over_cdp('http://localhost:9222')
        context = browser.contexts[0]
        page = [pg for pg in context.pages if 'labs.google' in pg.url][0]
        print('[+] Attached to:', page.url)

        async def on_req(req):
            if 'aisandbox-pa' in req.url or ('/fx/api' in req.url and 'getMediaUrlRedirect' in req.url):
                pd = req.post_data
                try:
                    pd = json.loads(pd) if pd else None
                except Exception:
                    pass
                log_entry('req', None, req.method, req.url, pd)

        async def on_res(res):
            if 'aisandbox-pa' in res.url or ('/fx/api' in res.url and 'getMediaUrlRedirect' in res.url):
                try:
                    txt = await res.text()
                    try:
                        body = json.loads(txt)
                    except Exception:
                        body = txt[:500]
                except Exception:
                    body = None
                log_entry('res', res.status, res.request.method, res.url, body)

        page.on('request', on_req)
        page.on('response', on_res)

        # Clear any existing text in prompt box
        await page.evaluate("""() => {
            const box = document.querySelector('div[contenteditable="true"]');
            if (box) box.innerText = '';
        }""")

        # Focus the contenteditable prompt box
        prompt = "A golden retriever puppy running through a sunny green park, slow motion, cinematic"
        await page.evaluate("""() => {
            const box = document.querySelector('div[contenteditable="true"]');
            if (box) box.focus();
        }""")
        await asyncio.sleep(0.5)
        # Type via real keyboard events (Playwright keyboard.type works on contenteditable)
        await page.keyboard.type(prompt, delay=20)
        print('[+] Prompt typed:', prompt)
        await asyncio.sleep(1)

        # Check if generate button is enabled now
        btn_state = await page.evaluate("""() => {
            const btns = Array.from(document.querySelectorAll('button'));
            const gen = btns.find(b => (b.innerText || '').trim() === 'Tạo' || (b.innerText || '').includes('arrow_forward'));
            if (!gen) return { ok: false, reason: 'no button' };
            return { ok: true, disabled: gen.disabled, ariaDisabled: gen.getAttribute('aria-disabled'), text: gen.innerText.trim() };
        }""")
        print('[+] Generate button state:', btn_state)

        # Click the arrow_forward Tạo button
        clicked = await page.evaluate("""() => {
            const btns = Array.from(document.querySelectorAll('button'));
            const gen = btns.find(b => (b.innerText || '').includes('arrow_forward') || (b.innerText || '').trim() === 'Tạo');
            if (!gen) return { ok: false };
            gen.click();
            return { ok: true };
        }""")
        print('[+] Clicked generate:', clicked)

        # Wait for generation to be submitted & start
        print('[+] Waiting 15s for generation submit + polling...')
        await asyncio.sleep(15)

        # Check page state - any video tile / progress %
        state = await page.evaluate("""() => {
            const videos = Array.from(document.querySelectorAll('video'));
            const imgs = Array.from(document.querySelectorAll('img'));
            const progress = document.body.innerText.match(/\\d+%/g);
            return { videos: videos.length, imgs: imgs.length, progress: progress ? progress.slice(0,5) : [] };
        }""")
        print('[+] Page state:', state)

asyncio.run(trigger_t2v_ui())
