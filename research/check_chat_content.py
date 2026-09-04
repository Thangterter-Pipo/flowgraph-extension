import asyncio
from playwright.async_api import async_playwright

async def check_chat_content():
    async with async_playwright() as p:
        browser = await p.chromium.connect_over_cdp('http://localhost:9222')
        context = browser.contexts[0]
        page = [pg for pg in context.pages if 'labs.google' in pg.url][0]

        info = await page.evaluate("""() => {
            const pageText = document.body.innerText;
            const buttons = Array.from(document.querySelectorAll('button')).map(b => (b.innerText || '').trim().replace(/\\n/g, ' ')).filter(Boolean);
            return {
                textSample: pageText.slice(-1000),
                buttons: buttons.slice(-20)
            };
        }""")
        print('UI Buttons near bottom:')
        for b in info['buttons']:
            print('  -', b)
        print('\nRecent UI Text:\n', info['textSample'][-500:])

asyncio.run(check_chat_content())
