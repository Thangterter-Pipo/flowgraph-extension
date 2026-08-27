import asyncio
import json
import time
from playwright.async_api import async_playwright

async def agent_mode_capture():
    async with async_playwright() as p:
        browser = await p.chromium.connect_over_cdp('http://localhost:9222')
        context = browser.contexts[0]
        page = [pg for pg in context.pages if 'labs.google' in pg.url][0]

        captured = []
        async def on_req(req):
            if 'aisandbox-pa' in req.url or 'flowCreationAgent' in req.url:
                pd = req.post_data
                captured.append(('req', req.method, req.url, pd))
        async def on_res(res):
            if 'aisandbox-pa' in res.url or 'flowCreationAgent' in res.url:
                try:
                    captured.append(('res', res.status, res.url, await res.text()))
                except Exception:
                    pass
        page.on('request', on_req)
        page.on('response', on_res)

        # In agent mode, there should be a chat input. Find and type into it.
        # First, inspect what changed on the page after enabling agent mode
        elems = await page.evaluate("""() => {
            return Array.from(document.querySelectorAll('input, textarea, [contenteditable="true"], [role="textbox"]'))
                .map((el, i) => ({ i, tag: el.tagName, editable: el.getAttribute('contenteditable'), placeholder: el.getAttribute('placeholder') || '', aria: el.getAttribute('aria-label') || '', text: (el.innerText || '').slice(0, 50) }));
        }""")
        print('[+] Inputs after agent mode:', elems)

        # Type into the visible input
        typed = False
        for e in elems:
            pass
        # Try clicking a contenteditable and typing
        box = page.locator('div[contenteditable="true"]').first
        await box.click()
        await asyncio.sleep(0.3)
        await page.keyboard.press('Control+a')
        prompt = "Generate a single video of a fox walking through autumn forest leaves, 8 seconds"
        await page.keyboard.type(prompt, delay=15)
        await asyncio.sleep(0.8)
        print('[+] Typed agent prompt')

        # Check for a send button in agent mode
        send_btn = await page.evaluate("""() => {
            const btns = Array.from(document.querySelectorAll('button'));
            const send = btns.find(b => {
                const t = (b.innerText || '').trim();
                const aria = b.getAttribute('aria-label') || '';
                return t.includes('Gửi') || t.includes('send') || t.includes('arrow_upward') || t.includes('arrow_forward') || aria.toLowerCase().includes('send');
            });
            if (send) { send.click(); return { ok: true, text: (send.innerText || '').trim() }; }
            return { ok: false };
        }""")
        print('[+] Send button click:', send_btn)

        if not send_btn['ok']:
            # Press Enter to send agent message
            await page.keyboard.press('Enter')
            print('[+] Pressed Enter to send agent message')

        await asyncio.sleep(15)

        print(f'[+] Captured {len(captured)} network events:')
        for ev in captured:
            kind, status, url, body = ev
            print(f'  {kind.upper()} {status} {url.split("?")[0]}')
            if body and len(str(body)) < 500:
                print('     ', str(body)[:350])

asyncio.run(agent_mode_capture())
