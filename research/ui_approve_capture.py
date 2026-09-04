import asyncio
import json
import time
from playwright.async_api import async_playwright

async def approve_and_capture():
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

        # Click "Phê duyệt" (approve)
        clicked = await page.evaluate("""() => {
            const btns = Array.from(document.querySelectorAll('button'));
            const approve = btns.find(b => (b.innerText || '').trim() === 'Phê duyệt');
            if (approve) { approve.click(); return { ok: true, text: approve.innerText.trim() }; }
            return { ok: false };
        }""")
        print('[+] Approve click:', clicked)

        # Wait for generation to start and progress
        for i in range(20):
            await asyncio.sleep(2)
            state = await page.evaluate("""() => {
                const progress = document.body.innerText.match(/\\d+%/g);
                const videos = document.querySelectorAll('video').length;
                const errs = document.body.innerText.includes('Không thành công') || document.body.innerText.includes('lỗi');
                return { progress: progress ? progress.slice(0, 5) : [], videos, errs };
            }""")
            if state['videos'] > 0 or state['errs'] or (state['progress'] and int(state['progress'][0].replace('%','')) >= 100):
                print(f'[+] State at {i*2}s:', state)
                break
            if i % 5 == 0:
                print(f'[+] State at {i*2}s:', state)

        print(f'[+] Captured {len(captured)} events:')
        for ev in captured:
            kind, status, url, body = ev
            print(f'  {kind.upper()} {status} {url.split("?")[0]}')
            if body and len(str(body)) < 700:
                print('     ', str(body)[:500])

asyncio.run(approve_and_capture())
