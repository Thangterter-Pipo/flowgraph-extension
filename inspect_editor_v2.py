import asyncio
import json
from playwright.async_api import async_playwright

async def inspect_current_editor():
    async with async_playwright() as p:
        browser = await p.chromium.connect_over_cdp('http://localhost:9222')
        context = browser.contexts[0]
        page = [pg for pg in context.pages if 'labs.google' in pg.url][0]

        print('URL:', page.url)
        info = await page.evaluate("""() => {
            // All buttons with their properties
            const btns = Array.from(document.querySelectorAll('button')).map((b, i) => ({
                i, text: (b.innerText || '').trim().replace(/\\n/g, ' | ').slice(0, 60),
                aria: b.getAttribute('aria-label') || '',
                disabled: b.disabled,
                ariaDisabled: b.getAttribute('aria-disabled')
            })).filter(b => b.text || b.aria);

            // Inputs with focusable info
            const inputs = Array.from(document.querySelectorAll('input, textarea, [contenteditable="true"]')).map((el, i) => ({
                i, tag: el.tagName, type: el.type || '', ph: el.getAttribute('placeholder') || '',
                value: (el.value || '').slice(0, 50), editable: el.getAttribute('contenteditable')
            }));

            return { btns, inputs };
        }""")

        print('=== BUTTONS ===')
        for b in info['btns']:
            print('  ', b)
        print('=== INPUTS ===')
        for inp in info['inputs']:
            print('  ', inp)

asyncio.run(inspect_current_editor())
