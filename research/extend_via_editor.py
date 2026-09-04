import asyncio
import json
import time
from playwright.async_api import async_playwright

async def open_video_editor_and_extend():
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

        # Click the video tile to open editor (video d6e527a8 is latest)
        clicked_video = await page.evaluate("""() => {
            const videos = Array.from(document.querySelectorAll('video'));
            if (videos.length > 0) {
                const tile = videos[0].closest('[role="button"], button, div');
                if (tile) { tile.click(); return { ok: true, src: (videos[0].src || '').slice(0, 100) }; }
            }
            return { ok: false };
        }""")
        print('[+] Clicked video tile:', clicked_video)
        await asyncio.sleep(3)

        # Check if we're in editor now
        editor = await page.evaluate("""() => {
            const text = document.body.innerText;
            return {
                hasExtendBtn: text.includes('Thêm đoạn trích video'),
                hasFrameBtn: text.includes('Lưu khung hình'),
                hasDesc: text.includes('Mô tả nội dung'),
                hasXong: text.includes('Xong')
            };
        }""")
        print('[+] Editor state:', editor)

        # If in editor, click "Thêm đoạn trích video" to open extend UI
        if editor['hasExtendBtn']:
            await page.evaluate("""() => {
                const btns = Array.from(document.querySelectorAll('button'));
                const b = btns.find(x => (x.innerText || '').includes('Thêm đoạn trích video'));
                if (b) b.click();
            }""")
            print('[+] Clicked "Thêm đoạn trích video"')
            await asyncio.sleep(2)

            # Type extend description into the edit prompt
            typed = await page.evaluate("""() => {
                const box = Array.from(document.querySelectorAll('[contenteditable="true"], textarea, input')).find(el => {
                    const ph = el.getAttribute('placeholder') || '';
                    return !el.value && !ph && el.tagName !== 'INPUT' || (el.getAttribute('aria-label') || '').includes('Mô tả');
                });
                // Try the specific description contenteditable
                const desc = Array.from(document.querySelectorAll('[contenteditable="true"]')).find(d => (d.innerText || '').includes('Mô tả') || (d.parentElement?.innerText || '').includes('Mô tả nội dung'));
                if (desc) {
                    desc.focus();
                    document.execCommand('insertText', false, 'Extend the video with the fox running further into a magical glowing forest');
                    desc.dispatchEvent(new Event('input', { bubbles: true }));
                    return { ok: true, found: 'desc' };
                }
                if (box) {
                    box.focus();
                    document.execCommand('insertText', false, 'Extend the video with the fox running further into a magical glowing forest');
                    box.dispatchEvent(new Event('input', { bubbles: true }));
                    return { ok: true, found: 'box' };
                }
                return { ok: false };
            }""")
            print('[+] Typed extend description:', typed)
            await asyncio.sleep(1)

            # Click generate in editor
            clicked = await page.evaluate("""() => {
                const btns = Array.from(document.querySelectorAll('button'));
                const gen = btns.find(b => (b.innerText || '').includes('arrow_forward') && !(b.getAttribute('aria-disabled') === 'true'));
                if (gen) { gen.click(); return { ok: true, text: gen.innerText.trim().replace(/\\n/g, ' ') }; }
                return { ok: false };
            }""")
            print('[+] Clicked editor generate:', clicked)
            await asyncio.sleep(10)

        print(f'[+] Captured {len(captured)} network events:')
        for ev in captured:
            kind, status, url, body = ev
            print(f'  {kind.upper()} {status} {url.split("?")[0]}')
            if body and len(str(body)) < 700:
                print('     ', str(body)[:500])

asyncio.run(open_video_editor_and_extend())
