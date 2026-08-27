import asyncio
import json
from playwright.async_api import async_playwright

async def inspect_editor_inputs():
    async with async_playwright() as p:
        browser = await p.chromium.connect_over_cdp('http://localhost:9222')
        context = browser.contexts[0]
        page = [pg for pg in context.pages if 'labs.google' in pg.url][0]

        inputs = await page.evaluate("""() => {
            const all = Array.from(document.querySelectorAll('input, textarea, [contenteditable="true"]'));
            return all.map((el, i) => ({
                i, tag: el.tagName, ph: el.getAttribute('placeholder') || '', text: (el.innerText || el.value || '').trim().replace(/\\n/g, ' ')
            }));
        }""")
        print('Editor inputs:')
        for inp in inputs:
            print('  ', inp)

asyncio.run(inspect_editor_inputs())
