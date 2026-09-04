import asyncio
import json
from playwright.async_api import async_playwright

async def inspect_button():
    async with async_playwright() as p:
        browser = await p.chromium.connect_over_cdp('http://localhost:9222')
        context = browser.contexts[0]
        page = [pg for pg in context.pages if 'labs.google' in pg.url][0]

        btn_info = await page.evaluate("""() => {
            const btns = Array.from(document.querySelectorAll('button'));
            return btns.map((b, i) => ({ i, text: (b.innerText || '').trim().replace(/\\n/g, ' '), aria: b.getAttribute('aria-label') || '', disabled: b.disabled, ariaDisabled: b.getAttribute('aria-disabled'), tag: b.tagName }))
                .filter(b => b.text || b.aria);
        }""")
        print("Buttons found:")
        for b in btn_info:
            print(" ", b)

asyncio.run(inspect_button())
