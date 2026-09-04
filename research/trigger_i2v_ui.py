import asyncio
import json
import os
import time
import uuid
from playwright.async_api import async_playwright

def sanitize(obj):
    if isinstance(obj, dict):
        res = {}
        for k, v in obj.items():
            if k.lower() in ('authorization', 'cookie', 'token', 'access_token', 'session_cookie') or 'token' in k.lower():
                res[k] = '<REDACTED_TOKEN>'
            elif k.lower() in ('email', 'name', 'image', 'user') and isinstance(v, str):
                res[k] = '<REDACTED_PII>'
            else:
                res[k] = sanitize(v)
        return res
    elif isinstance(obj, list):
        return [sanitize(i) for i in obj]
    return obj

async def run_i2v_from_ui():
    """Trigger I2V through the actual UI: select uploaded image then generate video."""
    async with async_playwright() as p:
        browser = await p.chromium.connect_over_cdp('http://localhost:9222')
        context = browser.contexts[0]
        page = [pg for pg in context.pages if 'labs.google' in pg.url][0]

        # Capture all network traffic
        events = []
        async def on_req(req):
            if 'aisandbox-pa' in req.url:
                events.append(('req', req.method, req.url, req.post_data))
        async def on_res(res):
            if 'aisandbox-pa' in res.url:
                try:
                    txt = await res.text()
                    events.append(('res', res.status, res.url, txt))
                except Exception:
                    events.append(('res', res.status, res.url, None))
        page.on('request', on_req)
        page.on('response', on_res)

        # The uploaded image should now appear as a tile in the project.
        # Try clicking the image tile to select it as the start image.
        clicked = await page.evaluate("""() => {
            const tiles = Array.from(document.querySelectorAll('[data-testid], [role="button"], div'));
            // Look for img elements that are project media tiles (not avatar/placeholder)
            const imgs = Array.from(document.querySelectorAll('img')).filter(i => {
                const src = i.src || '';
                return src.includes('googleusercontent') || src.includes('labs.google/fx') && !src.includes('flower-placeholder');
            });
            if (imgs.length > 0) {
                const tile = imgs[imgs.length - 1].closest('[role="button"], button, div');
                if (tile) { tile.click(); return { ok: true, src: imgs[imgs.length - 1].src.slice(0, 100) }; }
            }
            return { ok: false };
        }""")
        print('Clicked image tile:', clicked)
        await asyncio.sleep(2)

        # Type a prompt into the contenteditable prompt box
        prompt = "A serene lake at sunrise with gentle ripples"
        typed = await page.evaluate("""(text) => {
            const box = document.querySelector('div[contenteditable="true"]');
            if (!box) return { ok: false };
            box.focus();
            document.execCommand('insertText', false, text);
            return { ok: true };
        }""", prompt)
        print('Typed prompt:', typed)
        await asyncio.sleep(1)

        # Click the generate button (arrow_forward Tạo)
        gen = await page.evaluate("""() => {
            const btns = Array.from(document.querySelectorAll('button'));
            const b = btns.find(x => (x.innerText || '').includes('arrow_forward') || (x.innerText || '').trim() === 'Tạo');
            if (b) { b.click(); return { ok: true }; }
            return { ok: false };
        }""")
        print('Clicked generate:', gen)

        # Wait for network capture
        await asyncio.sleep(8)

        # Print captured events
        print(f'Captured {len(events)} events:')
        for ev in events:
            kind, status, url, body = ev
            print(f'  {kind.upper()} {status} {url.split("?")[0]}')
            if body and len(str(body)) < 500:
                print('     ', str(body)[:300])

asyncio.run(run_i2v_from_ui())
