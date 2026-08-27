import asyncio
import json
from playwright.async_api import async_playwright

async def inspect_editor_toolbar():
    async with async_playwright() as p:
        browser = await p.chromium.connect_over_cdp('http://localhost:9222')
        context = browser.contexts[0]
        page = [pg for pg in context.pages if 'labs.google' in pg.url][0]

        info = await page.evaluate("""() => {
            const btns = Array.from(document.querySelectorAll('button')).map((b, i) => ({
                i, text: (b.innerText || '').trim().replace(/\\n/g, ' '), aria: b.getAttribute('aria-label') || ''
            })).filter(b => b.text || b.aria);
            return btns;
        }""")
        print("All UI Buttons currently on screen:")
        for b in info:
            print("  ", b)

asyncio.run(inspect_editor_toolbar())
