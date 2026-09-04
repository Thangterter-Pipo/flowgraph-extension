import asyncio
import json
import time
from playwright.async_api import async_playwright

async def force_generate_click():
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
                    txt = await res.text()
                    captured.append(('res', res.status, res.url, txt))
                except Exception:
                    pass
        page.on('request', on_req)
        page.on('response', on_res)

        # Find the generate button bounding box and dispatch full pointer sequence
        result = await page.evaluate("""() => {
            const btns = Array.from(document.querySelectorAll('button'));
            const gen = btns.find(b => (b.innerText || '').includes('arrow_forward'));
            if (!gen) return { ok: false };
            const r = gen.getBoundingClientRect();
            const x = r.left + r.width / 2;
            const y = r.top + r.height / 2;
            const base = { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, view: window };
            gen.scrollIntoView({ block: 'center' });
            gen.dispatchEvent(new PointerEvent('pointerover',  { ...base, pointerId: 1, isPrimary: true }));
            gen.dispatchEvent(new PointerEvent('pointerenter', { ...base, pointerId: 1, isPrimary: true }));
            gen.dispatchEvent(new MouseEvent('mouseover', base));
            gen.dispatchEvent(new PointerEvent('pointerdown', { ...base, pointerId: 1, isPrimary: true, button: 0, buttons: 1 }));
            gen.dispatchEvent(new MouseEvent('mousedown', { ...base, button: 0, buttons: 1 }));
            gen.focus();
            gen.dispatchEvent(new PointerEvent('pointerup', { ...base, pointerId: 1, isPrimary: true, button: 0, buttons: 0 }));
            gen.dispatchEvent(new MouseEvent('mouseup', { ...base, button: 0, buttons: 0 }));
            gen.dispatchEvent(new MouseEvent('click', { ...base, button: 0 }));
            return { ok: true, x, y };
        }""")
        print('[+] Pointer sequence dispatched:', result)
        await asyncio.sleep(1)

        # Also try clicking via page.mouse at coordinates
        if result.get('ok'):
            await page.mouse.click(result['x'], result['y'])
            print('[+] Mouse click at coordinates done')

        print('[+] Waiting 20s for generation...')
        await asyncio.sleep(20)

        print(f'[+] Captured {len(captured)} network events:')
        for ev in captured:
            kind, status, url, body = ev
            print(f'  {kind.upper()} {status} {url.split("?")[0]}')
            if body and len(str(body)) < 400:
                print('     ', str(body)[:250])

        state = await page.evaluate("""() => {
            const videos = document.querySelectorAll('video').length;
            const imgs = document.querySelectorAll('img').length;
            const progress = document.body.innerText.match(/\\d+%/g);
            return { videos, imgs, progress: progress ? progress.slice(0,5) : [] };
        }""")
        print('[+] Page state:', state)

asyncio.run(force_generate_click())
