import asyncio
import json
import time
from playwright.async_api import async_playwright

async def fix_prompt_and_generate():
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

        prompt = "A red sports car driving on a coastal highway at sunset, cinematic drone shot"
        
        # Use CDP Input.dispatchKeyEvent char events via page.keyboard with proper delay
        box = page.locator('div[contenteditable="true"]')
        await box.click()
        await asyncio.sleep(0.3)
        # Select all + delete existing content
        await page.keyboard.press('Control+a')
        await page.keyboard.press('Delete')
        await asyncio.sleep(0.3)
        # Type character by character
        for ch in prompt:
            await page.keyboard.type(ch, delay=15)
        await asyncio.sleep(0.8)

        # Check the prompt box content
        content = await page.evaluate("""() => {
            const box = document.querySelector('div[contenteditable="true"]');
            return box ? box.innerText.slice(0, 100) : 'NO BOX';
        }""")
        print('[+] Prompt box content:', repr(content))

        # Check generate button disabled state now
        state = await page.evaluate("""() => {
            const btns = Array.from(document.querySelectorAll('button'));
            const gen = btns.find(b => (b.innerText || '').includes('arrow_forward'));
            return gen ? { disabled: gen.disabled, ariaDisabled: gen.getAttribute('aria-disabled'), text: gen.innerText.trim().replace(/\\n/g, ' ') } : null;
        }""")
        print('[+] Generate button after typing:', state)

        # If still disabled, try dispatching input events manually
        if state and state['ariaDisabled'] == 'true':
            print('[+] Button still disabled - dispatching input events...')
            await page.evaluate("""() => {
                const box = document.querySelector('div[contenteditable="true"]');
                box.dispatchEvent(new Event('input', { bubbles: true }));
                box.dispatchEvent(new Event('change', { bubbles: true }));
            }""")
            await asyncio.sleep(0.5)

        # Now click the generate button
        clicked = await page.evaluate("""() => {
            const btns = Array.from(document.querySelectorAll('button'));
            const gen = btns.find(b => (b.innerText || '').includes('arrow_forward'));
            if (!gen) return { ok: false };
            gen.click();
            return { ok: true, ariaDisabled: gen.getAttribute('aria-disabled') };
        }""")
        print('[+] Clicked generate:', clicked)

        await asyncio.sleep(15)

        print(f'[+] Captured {len(captured)} network events:')
        for ev in captured:
            kind, status, url, body = ev
            print(f'  {kind.upper()} {status} {url.split("?")[0]}')
            if body and len(str(body)) < 400:
                print('     ', str(body)[:250])

asyncio.run(fix_prompt_and_generate())
