import asyncio
from playwright.async_api import async_playwright

async def open_add_menu():
    async with async_playwright() as p:
        browser = await p.chromium.connect_over_cdp('http://localhost:9222')
        context = browser.contexts[0]
        page = [pg for pg in context.pages if 'labs.google' in pg.url][0]

        # Click "Thêm nội dung nghe nhìn"
        clicked = await page.evaluate("""() => {
            const buttons = Array.from(document.querySelectorAll('button, [role="button"]'));
            const target = buttons.find(b => (b.innerText || '').includes('Thêm nội dung nghe nhìn'));
            if (target) { target.click(); return { ok: true }; }
            return { ok: false };
        }""")
        print('Clicked add menu:', clicked)
        await asyncio.sleep(2)

        # Inspect dialog / menu that appeared
        elems = await page.evaluate("""() => {
            return Array.from(document.querySelectorAll('button, a, input, [role="button"], [role="menuitem"], [role="dialog"] *, [contenteditable="true"]'))
                .map((el, i) => ({ i, tag: el.tagName, text: (el.innerText || '').trim().slice(0, 60), aria: el.getAttribute('aria-label') || '', role: el.getAttribute('role') || '' }))
                .filter(b => b.text || b.aria || b.role)
                .slice(-50);
        }""")
        print('Dialog elements:')
        for e in elems:
            print('  ', e)

asyncio.run(open_add_menu())
