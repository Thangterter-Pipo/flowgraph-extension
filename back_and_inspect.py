import asyncio
import json
from playwright.async_api import async_playwright

async def go_back_and_inspect():
    async with async_playwright() as p:
        browser = await p.chromium.connect_over_cdp('http://localhost:9222')
        context = browser.contexts[0]
        page = [pg for pg in context.pages if 'labs.google' in pg.url][0]

        print('Current URL:', page.url)

        # Navigate back to the main project (15e493d2) which has all media
        target_url = "https://labs.google/fx/vi/tools/flow/project/15e493d2-6465-4a3d-956f-a11c18d41e96"
        await page.goto(target_url)
        await asyncio.sleep(4)
        print('Now at:', page.url)

        # Inspect video tiles with context menus
        vids = await page.evaluate("""() => {
            const videos = Array.from(document.querySelectorAll('video'));
            const result = [];
            videos.forEach((v, i) => {
                const src = (v.src || v.currentSrc || '');
                const tile = v.closest('[role="button"], div') || v;
                result.push({ i, src: src.slice(0, 150) });
            });
            // Find images that are videos (poster + play button)
            const imgs = Array.from(document.querySelectorAll('img')).map(i => i.src).filter(s => s.includes('getMediaUrlRedirect'));
            return { videos: result, mediaImgs: imgs.slice(-10) };
        }""")
        print('Videos:', json.dumps(vids['videos'], indent=2))
        print('Media images:', json.dumps(vids['mediaImgs'], indent=2))

asyncio.run(go_back_and_inspect())
