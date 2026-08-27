import asyncio
import json
from playwright.async_api import async_playwright

async def create_project_and_inspect():
    async with async_playwright() as p:
        browser = await p.chromium.connect_over_cdp('http://localhost:9222')
        context = browser.contexts[0]
        page = [pg for pg in context.pages if 'labs.google' in pg.url][0]

        print('Current URL:', page.url)
        print('Current title:', await page.title())

        # Look for "Dự án mới" / "New project" button and click it
        clicked = await page.evaluate("""() => {
            const buttons = Array.from(document.querySelectorAll('button, a, [role="button"]'));
            const target = buttons.find(b => {
                const text = (b.innerText || '').trim().toLowerCase();
                return text.includes('dự án mới') || text.includes('new project') || text.includes('create project');
            });
            if (target) {
                target.click();
                return { ok: true, text: target.innerText.trim() };
            }
            return { ok: false };
        }""")
        print('Clicked new project:', clicked)

        await asyncio.sleep(2)

        # Maybe a dialog appeared - check for confirm/create button
        await page.evaluate("""() => {
            const buttons = Array.from(document.querySelectorAll('button, [role="button"]'));
            const target = buttons.find(b => {
                const text = (b.innerText || '').trim().toLowerCase();
                return text.includes('tạo') || text.includes('create');
            });
            if (target) {
                target.click();
                return { ok: true, text: target.innerText.trim() };
            }
            return { ok: false };
        }""")
        await asyncio.sleep(2)

        print('URL after create:', page.url)
        print('Title after create:', await page.title())

        # List interactive elements now
        elems = await page.evaluate("""() => {
            return Array.from(document.querySelectorAll('button, a, input, textarea, [role="button"], [contenteditable="true"]'))
                .map((el, i) => ({ i, tag: el.tagName, text: (el.innerText || '').trim().slice(0, 60), aria: el.getAttribute('aria-label') || '', editable: el.getAttribute('contenteditable') }))
                .filter(b => b.text || b.aria || b.editable)
                .slice(0, 40);
        }""")
        print('Interactive elements now:')
        for e in elems:
            print('  ', e)

asyncio.run(create_project_and_inspect())
