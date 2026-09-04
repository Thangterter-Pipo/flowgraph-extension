import asyncio
import json
from playwright.async_api import async_playwright

async def check_status_and_continue():
    async with async_playwright() as p:
        browser = await p.chromium.connect_over_cdp('http://localhost:9222')
        context = browser.contexts[0]
        page = [pg for pg in context.pages if 'labs.google' in pg.url][0]

        # Check current state
        state = await page.evaluate("""() => {
            const videos = document.querySelectorAll('video').length;
            const imgs = document.querySelectorAll('img').length;
            const text = document.body.innerText.substring(0, 2000);
            const btns = Array.from(document.querySelectorAll('button')).map(b => (b.innerText || '').trim().replace(/\\n/g, ' ')).filter(Boolean);
            return { videos, imgs, textSample: text.slice(-1000), buttons: btns.slice(-15) };
        }""")
        print('Videos:', state['videos'], '| Images:', state['imgs'])
        print('Recent UI Text:', state['textSample'][-500:])
        print('Buttons:', state['buttons'])

asyncio.run(check_status_and_continue())