import asyncio
import json
import os
import time
from playwright.async_api import async_playwright

async def create_fresh_project_and_t2i():
    async with async_playwright() as p:
        browser = await p.chromium.connect_over_cdp('http://localhost:9222')
        context = browser.contexts[0]
        page = [pg for pg in context.pages if 'labs.google' in pg.url][0]

        # 1. Create a fresh project via tRPC (does not have Agent Mode enabled)
        session = await page.evaluate("async () => await (await fetch('/fx/api/auth/session')).json()")
        access_token = session['access_token']

        create_res = await page.evaluate("""async () => {
            const r = await fetch('/fx/api/trpc/project.createProject', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ json: { projectTitle: 'Fresh T2I Test', toolName: 'PINHOLE' } })
            });
            return await r.json();
        }""")
        new_project_id = create_res['result']['data']['json']['result']['projectId']
        print('[+] Created fresh project ID:', new_project_id)

        # 2. Navigate to fresh project URL
        new_url = f"https://labs.google/fx/vi/tools/flow/project/{new_project_id}"
        await page.goto(new_url)
        await asyncio.sleep(4)
        print('[+] Navigated to fresh project:', page.url)

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

        # 3. In fresh project, switch media type dropdown to "Hình ảnh" if needed, or type prompt directly
        # Type prompt into box
        box = page.locator('div[contenteditable="true"]').first
        await box.click()
        await asyncio.sleep(0.5)
        prompt = "A cute fluffy kitten sleeping in a sunlit basket, 4k digital art"
        await page.keyboard.type(prompt, delay=12)
        await asyncio.sleep(0.8)

        # Check for mode selector button (currently says "Video · 720p · 8s") and click it to select "Hình ảnh"
        mode_btn = await page.evaluate("""() => {
            const btns = Array.from(document.querySelectorAll('button'));
            const b = btns.find(x => (x.innerText || '').includes('Video · 720p'));
            if (b) { b.click(); return { ok: true, text: b.innerText.trim().replace(/\\n/g, ' ') }; }
            return { ok: false };
        }""")
        print('[+] Mode selector button clicked:', mode_btn)
        await asyncio.sleep(1)

        # Look for "Hình ảnh" option in popup menu
        img_opt = await page.evaluate("""() => {
            const items = Array.from(document.querySelectorAll('button, div[role="menuitem"], [role="option"]'));
            const img = items.find(i => (i.innerText || '').includes('Hình ảnh') || (i.innerText || '').includes('Image'));
            if (img) { img.click(); return { ok: true, text: img.innerText.trim().replace(/\\n/g, ' ') }; }
            return { ok: false };
        }""")
        print('[+] Select Image mode:', img_opt)
        await asyncio.sleep(1)

        # Click generate
        clicked = await page.evaluate("""() => {
            const btns = Array.from(document.querySelectorAll('button'));
            const gen = btns.find(b => (b.innerText || '').includes('arrow_forward'));
            if (gen) { gen.click(); return { ok: true }; }
            return { ok: false };
        }""")
        print('[+] Clicked generate button:', clicked)

        await asyncio.sleep(10)

        print(f'[+] Captured {len(captured)} network events:')
        for ev in captured:
            kind, status, url, body = ev
            print(f'  {kind.upper()} {status} {url.split("?")[0]}')
            if body and len(str(body)) < 700:
                print('     ', str(body)[:500])

asyncio.run(create_fresh_project_and_t2i())
