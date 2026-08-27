import asyncio
import json
from playwright.async_api import async_playwright

async def inspect_fresh_project():
    async with async_playwright() as p:
        browser = await p.chromium.connect_over_cdp('http://localhost:9222')
        context = browser.contexts[0]
        page = [pg for pg in context.pages if 'labs.google' in pg.url][0]

        print('URL:', page.url)
        info = await page.evaluate("""() => {
            // All buttons
            const buttons = Array.from(document.querySelectorAll('button')).map((b, i) => ({ i, text: (b.innerText || '').trim().replace(/\\n/g, ' | '), aria: b.getAttribute('aria-label') || '' })).filter(b => b.text || b.aria);
            // All divs with role
            const roles = Array.from(document.querySelectorAll('[role]')).map((e, i) => ({ i, role: e.getAttribute('role'), text: (e.innerText || '').slice(0, 40).trim(), aria: e.getAttribute('aria-label') || '' })).slice(-20);
            // tabs / chips
            const chips = Array.from(document.querySelectorAll('[role="tab"], [role="radio"], [data-state]')).map(c => ({ tag: c.tagName, role: c.getAttribute('role'), state: c.getAttribute('data-state'), text: (c.innerText || '').slice(0, 30), aria: c.getAttribute('aria-checked') || '' }));
            return { buttons, roles, chips };
        }""")
        print('BUTTONS:')
        for b in info['buttons']:
            print('  ', b)
        print('\nROLES:')
        for r in info['roles']:
            print('  ', r)
        print('\nCHIPS:')
        for c in info['chips']:
            print('  ', c)

asyncio.run(inspect_fresh_project())
