import asyncio
import json
from playwright.async_api import async_playwright

async def click_extend_clip():
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

        # Click "add Thêm đoạn trích video"
        clicked = await page.evaluate("""() => {
            const btns = Array.from(document.querySelectorAll('button'));
            const b = btns.find(x => (x.innerText || '').includes('Thêm đoạn trích video'));
            if (b) { b.click(); return { ok: true, text: b.innerText.trim().replace(/\\n/g, ' ') }; }
            return { ok: false };
        }""")
        print('[+] Clicked extend clip button:', clicked)
        await asyncio.sleep(2)

        # Inspect what appeared after clicking
        elems = await page.evaluate("""() => {
            const btns = Array.from(document.querySelectorAll('button')).map(b => (b.innerText || '').trim().replace(/\\n/g, ' ')).filter(Boolean);
            const text = (document.body.innerText || '').slice(-600);
            return { buttons: btns.slice(-15), text };
        }""")
        print('[+] Buttons now:', elems['buttons'])
        print('[+] UI Text:\n', elems['text'])

asyncio.run(click_extend_clip())
