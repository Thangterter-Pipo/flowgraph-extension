import asyncio
import json
import time
from playwright.async_api import async_playwright

async def wait_for_agent_approval():
    async with async_playwright() as p:
        browser = await p.chromium.connect_over_cdp('http://localhost:9222')
        context = browser.contexts[0]
        page = [pg for pg in context.pages if 'labs.google' in pg.url][0]

        captured = []
        async def on_req(req):
            if 'aisandbox-pa' in req.url:
                pd = req.post_data
                captured.append(('req', req.method, req.url, pd))
        async def on_res(res):
            if 'aisandbox-pa' in res.url:
                try:
                    captured.append(('res', res.status, res.url, await res.text()))
                except Exception:
                    pass
        page.on('request', on_req)
        page.on('response', on_res)

        # Wait 30s for agent to think + respond + generate video
        for i in range(30):
            await asyncio.sleep(2)
            btns = await page.evaluate("""() => {
                const btns = Array.from(document.querySelectorAll('button'));
                return btns.filter(b => {
                    const t = (b.innerText || '').trim().toLowerCase();
                    const aria = (b.getAttribute('aria-label') || '').toLowerCase();
                    return t.includes('phê duyệt') || t.includes('approve') || t.includes('tiếp tục') || t.includes('continue') || aria.includes('approve');
                }).map(b => ({ text: (b.innerText || '').trim().replace(/\\n/g, ' ').slice(0, 60) }));
            }""")
            if btns and len(btns) > 0:
                print(f'[+] Approval button found at ~{i*2}s:', btns[0])
                # Click approval
                await page.evaluate("""() => {
                    const btns = Array.from(document.querySelectorAll('button'));
                    const approve = btns.find(b => {
                        const t = (b.innerText || '').trim().toLowerCase();
                        const aria = (b.getAttribute('aria-label') || '').toLowerCase();
                        return t.includes('phê duyệt') || t.includes('approve') || aria.includes('approve');
                    });
                    if (approve) { approve.click(); return true; }
                    return false;
                }""")
                print('[+] Approval clicked!')
                await asyncio.sleep(20)
                break

        print(f'[+] Captured {len(captured)} events:')
        for ev in captured:
            kind, status, url, body = ev
            print(f'  {kind.upper()} {status} {url.split("?")[0]}')
            if body and len(str(body)) < 500:
                print('     ', str(body)[:350])

asyncio.run(wait_for_agent_approval())