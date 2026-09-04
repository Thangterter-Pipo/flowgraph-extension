import asyncio
import json
import time
from playwright.async_api import async_playwright

async def try_enter_and_agent():
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

        box = page.locator('div[contenteditable="true"]')
        await box.click()
        await asyncio.sleep(0.3)
        await page.keyboard.press('Control+a')
        await page.keyboard.type("Generate a short video of a soaring eagle over snowy mountains", delay=10)
        await asyncio.sleep(0.5)

        # Try pressing Enter
        print('[+] Pressing Enter in prompt box...')
        await page.keyboard.press('Enter')
        await asyncio.sleep(5)

        if not captured:
            print('[+] Try pressing Control+Enter...')
            await page.keyboard.press('Control+Enter')
            await asyncio.sleep(5)

        # If still no request, click the "Tác nhân" (Agent Mode) button
        if not captured:
            print('[+] Trying Agent Mode button...')
            agent_btn = await page.evaluate("""() => {
                const btns = Array.from(document.querySelectorAll('button'));
                const b = btns.find(x => (x.innerText || '').trim() === 'Tác nhân');
                if (b) { b.click(); return { ok: true, text: b.innerText.trim() }; }
                return { ok: false };
            }""")
            print('[+] Clicked Agent button:', agent_btn)
            await asyncio.sleep(8)

        print(f'[+] Captured {len(captured)} network events:')
        for ev in captured:
            kind, status, url, body = ev
            print(f'  {kind.upper()} {status} {url.split("?")[0]}')
            if body and len(str(body)) < 400:
                print('     ', str(body)[:250])

asyncio.run(try_enter_and_agent())
