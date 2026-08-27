import asyncio
import json
import os
import time
from playwright.async_api import async_playwright

async def capture_frame_from_video():
    async with async_playwright() as p:
        browser = await p.chromium.connect_over_cdp('http://localhost:9222')
        context = browser.contexts[0]
        page = [pg for pg in context.pages if 'labs.google' in pg.url][0]

        captured = []
        async def on_req(req):
            if 'aisandbox-pa' in req.url:
                captured.append(('req', req.method, req.url, req.post_data))
        async def on_res(res):
            if 'aisandbox-pa' in res.url:
                try:
                    captured.append(('res', res.status, res.url, await res.text()))
                except Exception:
                    pass
        page.on('request', on_req)
        page.on('response', on_res)

        # Click "add_photo_alternate Lưu khung hình"
        clicked = await page.evaluate("""() => {
            const btns = Array.from(document.querySelectorAll('button'));
            const frameBtn = btns.find(b => (b.innerText || '').includes('Lưu khung hình') || (b.getAttribute('aria-label') || '').includes('Lưu khung hình'));
            if (frameBtn) { frameBtn.click(); return { ok: true, text: frameBtn.innerText.trim().replace(/\\n/g, ' ') }; }
            return { ok: false };
        }""")
        print('[+] Clicked Save Frame button:', clicked)

        await asyncio.sleep(6)

        print(f'[+] Captured {len(captured)} network events:')
        for ev in captured:
            kind, status, url, body = ev
            print(f'  {kind.upper()} {status} {url.split("?")[0]}')
            if body and len(str(body)) < 700:
                print('     ', str(body)[:500])

asyncio.run(capture_frame_from_video())
