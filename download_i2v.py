import asyncio
import json
import os
import base64
from playwright.async_api import async_playwright

async def find_and_download_i2v_video():
    async with async_playwright() as p:
        browser = await p.chromium.connect_over_cdp('http://localhost:9222')
        context = browser.contexts[0]
        page = [pg for pg in context.pages if 'labs.google' in pg.url][0]

        # Find all video tiles in the project
        vids = await page.evaluate("""() => {
            const videos = Array.from(document.querySelectorAll('video'));
            const videoSrcs = videos.map(v => ({ src: (v.src || v.currentSrc || '').slice(0, 200), hasPoster: (v.poster || '').slice(0, 150) }));
            // Also find images with media ids
            const imgs = Array.from(document.querySelectorAll('img')).map(i => i.src).filter(s => s.includes('getMediaUrlRedirect'));
            return { videoSrcs, mediaImgSrcs: imgs.slice(-8) };
        }""")
        print('Video sources:', json.dumps(vids['videoSrcs'], indent=2))
        print('Media image sources:', json.dumps(vids['mediaImgSrcs'], indent=2))

        # Extract video media ID from src or poster
        media_ids = []
        for v in vids['videoSrcs']:
            src = v.get('src') or v.get('hasPoster') or ''
            if 'name=' in src:
                import re
                m = re.search(r'name=([0-9a-f-]{36})', src)
                if m:
                    media_ids.append(m.group(1))
        for s in vids['mediaImgSrcs']:
            import re
            m = re.search(r'name=([0-9a-f-]{36})', s)
            if m:
                media_ids.append(m.group(1))

        # Deduplicate
        media_ids = list(dict.fromkeys(media_ids))
        print('Media IDs found:', media_ids)

        # The I2V video should be the LAST one (newest). Download it.
        if media_ids:
            target_id = media_ids[-1]
            print('[+] Downloading latest media:', target_id)

            res_data = await page.evaluate("""async (mediaId) => {
                const url = '/fx/api/trpc/media.getMediaUrlRedirect?name=' + mediaId;
                const res = await fetch(url, { redirect: 'follow' });
                const blob = await res.blob();
                const buffer = await blob.arrayBuffer();
                const bytes = new Uint8Array(buffer);
                let binary = '';
                for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
                return {
                    finalUrl: res.url.slice(0, 120),
                    contentType: res.headers.get('content-type'),
                    length: bytes.byteLength,
                    base64: btoa(binary)
                };
            }""", target_id)

            print('[+] CDN URL:', res_data['finalUrl'])
            print('[+] Content-Type:', res_data['contentType'])
            print('[+] Size:', res_data['length'], 'bytes')

            file_bytes = base64.b64decode(res_data['base64'])
            os.makedirs('evidence/download', exist_ok=True)
            out = f"evidence/download/i2v_{target_id}.mp4"
            with open(out, "wb") as f:
                f.write(file_bytes)
            print('[+] Saved:', out)

            # Save fixtures
            with open('evidence/video/i2v/response.json', 'w', encoding='utf-8') as f:
                json.dump({
                    "media_id": target_id,
                    "cdn_url": res_data['finalUrl'],
                    "contentType": res_data['contentType'],
                    "length_bytes": res_data['length']
                }, f, indent=2)

asyncio.run(find_and_download_i2v_video())
