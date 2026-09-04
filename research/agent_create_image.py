import asyncio
import json
import time
from playwright.async_api import async_playwright

async def agent_create_image():
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

        # Type in prompt box for agent: ask to create an image
        box = page.locator('div[contenteditable="true"]').first
        await box.click()
        await asyncio.sleep(0.3)
        await page.keyboard.press('Control+a')
        await page.keyboard.press('Delete')
        prompt = "Create 1 image of a peaceful zen garden with bonsai trees and stepping stones"
        await page.keyboard.type(prompt, delay=10)
        await asyncio.sleep(0.5)

        # Press Enter to send to Agent
        await page.keyboard.press('Enter')
        print('[+] Sent prompt to Agent:', prompt)

        # Wait for agent streamChat response + approval button
        for i in range(20):
            await asyncio.sleep(2)
            res = await page.evaluate("""() => {
                const all = Array.from(document.querySelectorAll('*'));
                const target = all.find(el => {
                    const text = (el.innerText || '').trim();
                    return text === 'Phê duyệt' || text === 'check\\nPhê duyệt';
                });
                if (target) {
                    const clickable = target.closest('button, [role="button"], div') || target;
                    clickable.click();
                    return { ok: true, text: clickable.innerText.slice(0, 50) };
                }
                return { ok: false };
            }""")
            if res['ok']:
                print(f'[+] Clicked Approve at ~{i*2}s:', res)
                break
            if i % 4 == 0:
                print(f'[+] Waiting for agent approval button at ~{i*2}s...')

        await asyncio.sleep(10)

        print(f'[+] Captured {len(captured)} network events:')
        for ev in captured:
            kind, status, url, body = ev
            print(f'  {kind.upper()} {status} {url.split("?")[0]}')
            if body and len(str(body)) < 500:
                print('     ', str(body)[:350])

asyncio.run(agent_create_image())
