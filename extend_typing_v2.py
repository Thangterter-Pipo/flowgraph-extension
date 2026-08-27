import asyncio
import json
import time
from playwright.async_api import async_playwright

async def type_extend_prompt_properly():
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

        # Find the contenteditable description box in extend UI and type with keyboard
        desc_found = await page.evaluate("""() => {
            const boxes = Array.from(document.querySelectorAll('[contenteditable="true"]'));
            const desc = boxes.find(d => (d.innerText || '').includes('Mô tả') || (d.parentElement?.innerText || '').includes('Mô tả nội dung'));
            if (desc) {
                desc.focus();
                return { ok: true, idx: boxes.indexOf(desc), text: (desc.innerText || '').slice(0, 50) };
            }
            return { ok: false, count: boxes.length };
        }""")
        print('[+] Description box found:', desc_found)

        # Clear and type via keyboard
        await page.keyboard.press('Control+a')
        await asyncio.sleep(0.2)
        await page.keyboard.press('Delete')
        await asyncio.sleep(0.2)
        prompt = "The fox keeps running and reaches a magical glowing forest with fireflies"
        await page.keyboard.type(prompt, delay=15)
        await asyncio.sleep(0.8)

        # Check the box content + button state
        state = await page.evaluate("""() => {
            const boxes = Array.from(document.querySelectorAll('[contenteditable="true"]'));
            const desc = boxes.find(d => (d.innerText || '').includes('Mô tả') || (d.parentElement?.innerText || '').includes('Mô tả nội dung')) || boxes[boxes.length-1];
            const content = desc ? desc.innerText.trim() : '';
            const btns = Array.from(document.querySelectorAll('button'));
            const gen = btns.find(b => (b.innerText || '').includes('arrow_forward'));
            return {
                content: content.slice(-80),
                btnDisabled: gen ? gen.getAttribute('aria-disabled') : 'not found'
            };
        }""")
        print('[+] After typing - box content:', repr(state['content']))
        print('[+] Generate button aria-disabled:', state['btnDisabled'])

        # If button is still disabled, dispatch input events
        if state['btnDisabled'] == 'true':
            await page.evaluate("""() => {
                const boxes = Array.from(document.querySelectorAll('[contenteditable="true"]'));
                const desc = boxes[boxes.length-1];
                desc.dispatchEvent(new Event('input', { bubbles: true }));
                desc.dispatchEvent(new Event('change', { bubbles: true }));
                desc.dispatchEvent(new Event('keyup', { bubbles: true }));
            }""")
            await asyncio.sleep(0.5)

        # Click generate
        clicked = await page.evaluate("""() => {
            const btns = Array.from(document.querySelectorAll('button'));
            const gen = btns.find(b => (b.innerText || '').includes('arrow_forward'));
            if (gen && gen.getAttribute('aria-disabled') !== 'true') {
                gen.click();
                return { ok: true };
            }
            return { ok: false, aria: gen ? gen.getAttribute('aria-disabled') : null };
        }""")
        print('[+] Clicked generate:', clicked)

        await asyncio.sleep(12)
        print(f'[+] Captured {len(captured)} network events:')
        for ev in captured:
            kind, status, url, body = ev
            print(f'  {kind.upper()} {status} {url.split("?")[0]}')
            if body and len(str(body)) < 700:
                print('     ', str(body)[:500])

asyncio.run(type_extend_prompt_properly())
