import asyncio
import json
from playwright.async_api import async_playwright

async def find_extend_submit_button():
    async with async_playwright() as p:
        browser = await p.chromium.connect_over_cdp('http://localhost:9222')
        context = browser.contexts[0]
        page = [pg for pg in context.pages if 'labs.google' in pg.url][0]

        info = await page.evaluate("""() => {
            const btns = Array.from(document.querySelectorAll('button')).map((b, i) => ({
                i,
                text: (b.innerText || '').trim().replace(/\\n/g, ' '),
                aria: b.getAttribute('aria-label') || '',
                disabled: b.disabled,
                ariaDisabled: b.getAttribute('aria-disabled'),
                cls: b.className.slice(0, 40)
            })).filter(b => b.text || b.aria);

            return btns;
        }""")

        print("All buttons currently in Extend UI:")
        for b in info:
            print("  ", b)

asyncio.run(find_extend_submit_button())
