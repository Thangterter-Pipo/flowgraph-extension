import asyncio
import json
import time
from playwright.async_api import async_playwright

async def trigger_interpolation_agent():
    async with async_playwright() as p:
        browser = await p.chromium.connect_over_cdp('http://localhost:9222')
        context = browser.contexts[0]
        page = [pg for pg in context.pages if 'labs.google' in pg.url][0]

        # Navigate back to main project
        await page.goto("https://labs.google/fx/vi/tools/flow/project/15e493d2-6465-4a3d-956f-a11c18d41e96")
        await asyncio.sleep(3)

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

        # Prompt agent: create interpolation video between two images
        box = page.locator('div[contenteditable="true"]').first
        await box.click()
        await asyncio.sleep(0.3)
        await page.keyboard.press('Control+a')
        await page.keyboard.press('Delete')
        prompt = "Create a smooth morphing video transition between the first uploaded image (lake scene) and the image of the fox in autumn forest - generate a video interpolation"
        await page.keyboard.type(prompt, delay=10)
        await asyncio.sleep(0.5)
        await page.keyboard.press('Enter')
        print('[+] Sent interpolation prompt')

        for i in range(15):
            await asyncio.sleep(2)
            clicked = await page.evaluate("""() => {
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
            if clicked['ok']:
                print(f'[+] Approved at ~{i*2}s:', clicked)
                break
            if i % 3 == 0:
                print(f'[+] Waiting for approval ~{i*2}s...')

        await asyncio.sleep(8)
        print(f'[+] Captured {len(captured)} events:')
        for ev in captured[-6:]:
            kind, status, url, body = ev
            print(f'  {kind.upper()} {status} {url.split("?")[0]}')
            if body and len(str(body)) < 400:
                print('     ', str(body)[:300])

asyncio.run(trigger_interpolation_agent())