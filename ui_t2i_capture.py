import asyncio
import json
import time
from playwright.async_api import async_playwright

async def t2i_via_ui():
    async with async_playwright() as p:
        browser = await p.chromium.connect_over_cdp('http://localhost:9222')
        context = browser.contexts[0]
        page = [pg for pg in context.pages if 'labs.google' in pg.url][0]

        captured = []
        async def on_req(req):
            if 'aisandbox-pa' in req.url or 'batchGenerateImages' in req.url:
                captured.append(('req', req.method, req.url, req.post_data))
        async def on_res(res):
            if 'aisandbox-pa' in res.url or 'batchGenerateImages' in res.url:
                try:
                    captured.append(('res', res.status, res.url, await res.text()))
                except Exception:
                    pass
        page.on('request', on_req)
        page.on('response', on_res)

        # Clear any existing prompt and type an image prompt
        box = page.locator('div[contenteditable="true"]').first
        await box.click()
        await asyncio.sleep(0.3)
        await page.keyboard.press('Control+a')
        await page.keyboard.press('Delete')
        prompt = "Generate a single high-quality image of a cute fluffy kitten sleeping in a sunlit basket, 4k digital art"
        await page.keyboard.type(prompt, delay=12)
        await asyncio.sleep(0.8)

        print('[+] Typed image prompt:', prompt)

        # Click the generate button
        clicked = await page.evaluate("""() => {
            const btns = Array.from(document.querySelectorAll('button'));
            const gen = btns.find(b => (b.innerText || '').includes('arrow_forward'));
            if (gen) { gen.click(); return { ok: true }; }
            return { ok: false };
        }""")
        print('[+] Clicked generate:', clicked)

        # Wait for image generation
        for i in range(15):
            await asyncio.sleep(2)
            if captured:
                print(f'[+] Captured {len(captured)} events at ~{i*2}s')
                break

        for ev in captured:
            kind, status, url, body = ev
            print(f'  {kind.upper()} {status} {url.split("?")[0]}')
            if body and len(str(body)) < 600:
                print('     ', str(body)[:500])

        state = await page.evaluate("""() => {
            const imgs = Array.from(document.querySelectorAll('img')).map(i => i.src).filter(s => !s.includes('flower-placeholder') && !s.includes('googleusercontent'));
            return { newImages: imgs.slice(-3), imgCount: imgs.length };
        }""")
        print('[+] New image tiles:', state)

asyncio.run(t2i_via_ui())
