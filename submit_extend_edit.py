import asyncio
import json
from playwright.async_api import async_playwright

async def submit_extend_edit():
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

        # Type into the edit description field
        typed = await page.evaluate("""() => {
            // The description field is likely the prompt contenteditable/textarea in the editor
            const boxes = Array.from(document.querySelectorAll('[contenteditable="true"], textarea, input'));
            const target = boxes.find(b => {
                const ph = b.getAttribute('placeholder') || b.getAttribute('aria-label') || '';
                return ph.includes('Mô tả') || ph.includes('chỉnh sửa') || (b.placeholder || '').includes('describe');
            });
            if (!target) return { ok: false, boxes: boxes.length };
            target.focus();
            const text = "The fox keeps walking, then looks back at the camera and smiles";
            // Use execCommand to insert text (works in contenteditable)
            document.execCommand('insertText', false, text);
            target.dispatchEvent(new Event('input', { bubbles: true }));
            return { ok: true, text };
        }""")
        print('[+] Typed extend description:', typed)
        await asyncio.sleep(1)

        # Click the generate button in the editor
        clicked = await page.evaluate("""() => {
            const btns = Array.from(document.querySelectorAll('button'));
            const gen = btns.find(b => (b.innerText || '').includes('arrow_forward') && !(b.innerText || '').includes('Phê duyệt'));
            if (gen) { gen.click(); return { ok: true, text: gen.innerText.trim().replace(/\\n/g, ' ') }; }
            return { ok: false };
        }""")
        print('[+] Clicked generate in editor:', clicked)

        await asyncio.sleep(10)

        print(f'[+] Captured {len(captured)} events:')
        for ev in captured:
            kind, status, url, body = ev
            print(f'  {kind.upper()} {status} {url.split("?")[0]}')
            if body and len(str(body)) < 600:
                print('     ', str(body)[:450])

asyncio.run(submit_extend_edit())
