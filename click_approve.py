import asyncio
import json
from playwright.async_api import async_playwright

async def click_approve_by_text():
    async with async_playwright() as p:
        browser = await p.chromium.connect_over_cdp('http://localhost:9222')
        context = browser.contexts[0]
        page = [pg for pg in context.pages if 'labs.google' in pg.url][0]

        captured = []
        async def on_req(req):
            if 'aisandbox-pa' in req.url:
                captured.append(('req', req.method, req.url, req.post_data))
        async def on_res(res):
            if 'aisandbox-pa' in res.url:
                try:
                    captured.append(('res', res.status, res.url, await res.text()))
                except Exception:
                    pass
        page.on('request', on_req)
        page.on('response', on_res)

        # Click element containing "Phê duyệt" using DOM find
        res = await page.evaluate("""() => {
            const all = Array.from(document.querySelectorAll('*'));
            const target = all.find(el => {
                const text = (el.innerText || '').trim();
                return text === 'Phê duyệt' || text === 'check\\nPhê duyệt';
            });
            if (target) {
                const clickable = target.closest('button, [role="button"], div') || target;
                clickable.click();
                return { ok: true, tag: clickable.tagName, text: clickable.innerText.slice(0, 50) };
            }
            return { ok: false };
        }""")
        print('[+] Approve click result:', res)

        await asyncio.sleep(12)

        print(f'[+] Captured {len(captured)} network events:')
        for ev in captured:
            kind, status, url, body = ev
            print(f'  {kind.upper()} {status} {url.split("?")[0]}')
            if body and len(str(body)) < 500:
                print('     ', str(body)[:350])

asyncio.run(click_approve_by_text())
