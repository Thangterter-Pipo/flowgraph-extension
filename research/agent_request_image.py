import asyncio
import json
import time
from playwright.async_api import async_playwright

async def request_image_via_agent():
    async with async_playwright() as p:
        browser = await p.chromium.connect_over_cdp('http://localhost:9222')
        context = browser.contexts[0]
        page = [pg for pg in context.pages if 'labs.google' in pg.url][0]

        print('[+] Current page:', page.url)

        # Focus prompt box and type clear request for STILL IMAGE
        box = page.locator('div[contenteditable="true"]').first
        await box.click()
        await asyncio.sleep(0.3)
        await page.keyboard.press('Control+a')
        await page.keyboard.press('Delete')
        
        prompt = "Create 1 still image of a serene lotus pond in morning mist, 4k photograph"
        await page.keyboard.type(prompt, delay=12)
        await asyncio.sleep(0.8)
        await page.keyboard.press('Enter')
        print('[+] Sent prompt:', prompt)

        # Wait for Agent response and click approve
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
                print(f'[+] Waiting for approval button ~{i*2}s...')

        await asyncio.sleep(8)

asyncio.run(request_image_via_agent())
