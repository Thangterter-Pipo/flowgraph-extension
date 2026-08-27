import asyncio
import json
import time
from playwright.async_api import async_playwright

async def editor_final_attempt():
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

        # Get current UI state to see if editor still open
        state = await page.evaluate("""() => {
            const text = document.body.innerText;
            const hasEditor = text.includes('Thêm đoạn trích video') || text.includes('Mô tả nội dung');
            const btns = Array.from(document.querySelectorAll('button')).map(b => (b.innerText || '').trim().replace(/\\n/g, ' ')).filter(Boolean);
            return { hasEditor, buttons: btns.slice(-8) };
        }""")
        print('[+] Editor state:', state)

        # The generate button in editor is likely the Omni Flash one (pen_magic)
        clicked = await page.evaluate("""() => {
            const btns = Array.from(document.querySelectorAll('button'));
            const gen = btns.find(b => (b.innerText || '').includes('Omni Flash') || (b.querySelector('[class*=pen_magic], [class*=spark]') && (b.innerText || '').includes('Tạo')));
            if (gen) { gen.click(); return { ok: true, text: gen.innerText.trim().replace(/\\n/g, ' ') }; }
            return { ok: false };
        }""")
        print('[+] Clicked Omni Flash generate:', clicked)
        await asyncio.sleep(12)

        print(f'[+] Captured {len(captured)} network events:')
        for ev in captured:
            kind, status, url, body = ev
            print(f'  {kind.upper()} {status} {url.split("?")[0]}')
            if body and len(str(body)) < 600:
                print('     ', str(body)[:400])

asyncio.run(editor_final_attempt())
