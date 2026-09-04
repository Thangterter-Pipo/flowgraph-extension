import asyncio
import json
import time
import os
from playwright.async_api import async_playwright

async def trigger_i2v_and_capture():
    media_id = "0b2c2ca5-28ba-4bb6-b9e6-51ceba80edfd"
    project_id = "15e493d2-6465-4a3d-956f-a11c18d41e96"

    async with async_playwright() as p:
        browser = await p.chromium.connect_over_cdp('http://localhost:9222')
        context = browser.contexts[0]
        page = [pg for pg in context.pages if 'labs.google' in pg.url][0]

        session = await page.evaluate("async () => await (await fetch('/fx/api/auth/session')).json()")
        access_token = session['access_token']

        print(f"[+] Using uploaded image media_id: {media_id}")

        # Send I2V generate via Agent in UI, using real mediaId
        prompt = f"Animate this start image: camera slow zoom in on serene lake with water ripples"

        # Type prompt into box
        box = page.locator('div[contenteditable="true"]').first
        await box.click()
        await asyncio.sleep(0.3)
        await page.keyboard.press('Control+a')
        await page.keyboard.press('Delete')
        await page.keyboard.type(prompt, delay=10)
        await asyncio.sleep(0.5)
        await page.keyboard.press('Enter')
        print('[+] Sent I2V prompt to Agent')

        # Look for approval button
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
                print(f'[+] Clicked Approve at ~{i*2}s:', clicked)
                break
            if i % 3 == 0:
                print(f'[+] Waiting for approval button ~{i*2}s...')

        await asyncio.sleep(8)

asyncio.run(trigger_i2v_and_capture())
