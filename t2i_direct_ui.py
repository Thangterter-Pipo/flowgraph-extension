import asyncio
import json
import time
from playwright.async_api import async_playwright

async def disable_agent_and_t2i():
    project_id = "15e493d2-6465-4a3d-956f-a11c18d41e96"

    async with async_playwright() as p:
        browser = await p.chromium.connect_over_cdp('http://localhost:9222')
        context = browser.contexts[0]
        page = [pg for pg in context.pages if 'labs.google' in pg.url][0]

        session = await page.evaluate("async () => await (await fetch('/fx/api/auth/session')).json()")
        access_token = session['access_token']

        # 1. Disable Agent Mode via PATCH agentInfo
        res = await page.evaluate("""async (args) => {
            const r = await fetch('https://aisandbox-pa.googleapis.com/v1/projects/' + args.projectId + '/agentInfo', {
                method: 'PATCH',
                headers: { 'Authorization': 'Bearer ' + args.token, 'Content-Type': 'application/json' },
                body: JSON.stringify({ agentToggleState: 'AGENT_TOGGLE_STATE_DISABLED' })
            });
            return { status: r.status, json: await r.json() };
        }""", {'token': access_token, 'projectId': project_id})
        print('[+] Agent Mode disabled:', res['status'], res['json'])

        # Reload page to ensure UI state
        await page.reload()
        await asyncio.sleep(4)
        print('[+] Page reloaded')

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

        # 2. Type an image prompt
        box = page.locator('div[contenteditable="true"]').first
        await box.click()
        await asyncio.sleep(0.5)
        await page.keyboard.press('Control+a')
        await page.keyboard.press('Delete')
        prompt = "a cute fluffy kitten sleeping in a sunlit basket, professional photography, 4k"
        await page.keyboard.type(prompt, delay=12)
        await asyncio.sleep(0.8)
        print('[+] Prompt typed:', prompt)

        # 3. Click generate button
        clicked = await page.evaluate("""() => {
            const btns = Array.from(document.querySelectorAll('button'));
            const gen = btns.find(b => (b.innerText || '').includes('arrow_forward'));
            if (gen) { gen.click(); return { ok: true, ariaDisabled: gen.getAttribute('aria-disabled') }; }
            return { ok: false };
        }""")
        print('[+] Clicked generate:', clicked)

        # 4. Wait for generation
        for i in range(20):
            await asyncio.sleep(2)
            imgs = await page.evaluate("""() => {
                return Array.from(document.querySelectorAll('img')).map(i => i.src).filter(s => s.includes('getMediaUrlRedirect'));
            }""")
            if len(imgs) > 0:
                print(f'[+] New image tiles at ~{i*2}s:', imgs[-2:])
                break

        print(f'[+] Captured {len(captured)} network events:')
        for ev in captured:
            kind, status, url, body = ev
            print(f'  {kind.upper()} {status} {url.split("?")[0]}')
            if body and len(str(body)) < 700:
                print('     ', str(body)[:500])

asyncio.run(disable_agent_and_t2i())
