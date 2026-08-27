import asyncio
from playwright.async_api import async_playwright

async def inspect_bottom_bar():
    async with async_playwright() as p:
        browser = await p.chromium.connect_over_cdp('http://localhost:9222')
        context = browser.contexts[0]
        page = [pg for pg in context.pages if 'labs.google' in pg.url][0]

        # Inspect all input[type="file"] on page
        file_inputs = await page.evaluate("""() => {
            return Array.from(document.querySelectorAll('input[type="file"]'))
                .map(i => ({ accept: i.accept, id: i.id, name: i.name, class: i.className }));
        }""")
        print('File inputs:', file_inputs)

        # Inspect prompt area buttons
        prompt_buttons = await page.evaluate("""() => {
            const area = document.querySelector('div[contenteditable="true"]')?.parentElement?.parentElement;
            if (!area) return [];
            return Array.from(area.querySelectorAll('button, input, label'))
                .map(b => ({ tag: b.tagName, text: (b.innerText || '').trim(), aria: b.getAttribute('aria-label') || '' }));
        }""")
        print('Prompt area controls:', prompt_buttons)

asyncio.run(inspect_bottom_bar())
