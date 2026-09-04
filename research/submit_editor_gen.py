import asyncio
import json
from playwright.async_api import async_playwright

async def submit_editor_generation():
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

        # Type prompt into input[0] or contenteditable in editor bar
        prompt = "The fox turns towards a bright sunny clearing and smiles"
        
        typed = await page.evaluate("""(text) => {
            const inputs = Array.from(document.querySelectorAll('input'));
            if (inputs.length > 0) {
                inputs[0].value = text;
                inputs[0].dispatchEvent(new Event('input', { bubbles: true }));
                inputs[0].dispatchEvent(new Event('change', { bubbles: true }));
                return { ok: true, input: 'input[0]' };
            }
            return { ok: false };
        }""", prompt)
        print('[+] Typed:', typed)
        await asyncio.sleep(0.5)

        # Click the generate button inside the editor
        clicked = await page.evaluate("""() => {
            const btns = Array.from(document.querySelectorAll('button'));
            const gen = btns.find(b => (b.innerText || '').includes('arrow_forward'));
            if (gen) { gen.click(); return { ok: true }; }
            return { ok: false };
        }""")
        print('[+] Clicked generate button:', clicked)

        await asyncio.sleep(8)

        print(f'[+] Captured {len(captured)} network events:')
        for ev in captured:
            kind, status, url, body = ev
            print(f'  {kind.upper()} {status} {url.split("?")[0]}')
            if body and len(str(body)) < 600:
                print('     ', str(body)[:400])

asyncio.run(submit_editor_generation())
