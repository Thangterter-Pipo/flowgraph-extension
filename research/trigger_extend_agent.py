import asyncio
import json
import time
from playwright.async_api import async_playwright

async def trigger_extend_video_agent():
    video_id = "b834294a-0e9a-4dd3-b2ff-f6cfdeb30550"
    print(f"[+] Requesting video extension for video media_id: {video_id}")

    async with async_playwright() as p:
        browser = await p.chromium.connect_over_cdp('http://localhost:9222')
        context = browser.contexts[0]
        page = [pg for pg in context.pages if 'labs.google' in pg.url][0]

        # Select the video tile in project UI
        selected = await page.evaluate("""() => {
            const vids = Array.from(document.querySelectorAll('video'));
            if (vids.length > 0) {
                const tile = vids[0].closest('[role="button"], button, div');
                if (tile) { tile.click(); return { ok: true }; }
            }
            return { ok: false };
        }""")
        print('[+] Selected video tile:', selected)
        await asyncio.sleep(1)

        # Prompt for extension
        prompt = "Extend this video for 8 more seconds: the fox continues walking into a sunny clearing with colorful butterflies"

        box = page.locator('div[contenteditable="true"]').first
        await box.click()
        await asyncio.sleep(0.3)
        await page.keyboard.press('Control+a')
        await page.keyboard.press('Delete')
        await page.keyboard.type(prompt, delay=10)
        await asyncio.sleep(0.5)
        await page.keyboard.press('Enter')
        print('[+] Sent Extend prompt to Agent:', prompt)

        # Wait for Agent approval button
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
                print(f'[+] Approved Extend at ~{i*2}s:', clicked)
                break
            if i % 3 == 0:
                print(f'[+] Waiting for approval button ~{i*2}s...')

        await asyncio.sleep(5)

asyncio.run(trigger_extend_video_agent())
