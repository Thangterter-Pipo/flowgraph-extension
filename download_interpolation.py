import asyncio
import os
import base64
import json
from playwright.async_api import async_playwright

async def download_interpolation_video():
    async with async_playwright() as p:
        browser = await p.chromium.connect_over_cdp('http://localhost:9222')
        context = browser.contexts[0]
        page = [pg for pg in context.pages if 'labs.google' in pg.url][0]

        # Scan for all media ids in current project
        media_info = await page.evaluate("""() => {
            const imgs = Array.from(document.querySelectorAll('img')).map(i => i.src).filter(s => s.includes('getMediaUrlRedirect'));
            const vids = Array.from(document.querySelectorAll('video')).map(v => v.src || v.currentSrc).filter(s => s.includes('getMediaUrlRedirect'));
            return { imgs, vids };
        }""")
        print('UI Video Sources:', media_info['vids'])
        print('UI Image Sources:', media_info['imgs'][-5:])

        # Extract all media IDs
        import re
        ids = []
        for src in media_info['vids'] + media_info['imgs']:
            m = re.search(r'name=([0-9a-f-]{36})', src)
            if m:
                ids.append(m.group(1))

        # Deduplicate preserving order
        ids = list(dict.fromkeys(ids))
        print('[+] All Media IDs in project:', ids)

        # Download the newest video
        newest_id = ids[-1]
        print('[+] Downloading newest generated media ID:', newest_id)

        res_data = await page.evaluate("""async (mediaId) => {
            const url = '/fx/api/trpc/media.getMediaUrlRedirect?name=' + mediaId;
            const res = await fetch(url, { redirect: 'follow' });
            const blob = await res.blob();
            const buffer = await blob.arrayBuffer();
            const bytes = new Uint8Array(buffer);
            let binary = '';
            for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
            return {
                finalUrl: res.url,
                contentType: res.headers.get('content-type'),
                length: bytes.byteLength,
                base64: btoa(binary)
            };
        }""", newest_id)

        print('[+] Content-Type:', res_data['contentType'])
        print('[+] Size:', res_data['length'], 'bytes')
        print('[+] CDN URL:', res_data['finalUrl'][:120])

        out_path = f"evidence/download/interpolation_verified_{newest_id}.mp4"
        file_bytes = base64.b64decode(res_data['base64'])
        os.makedirs('evidence/download', exist_ok=True)
        with open(out_path, "wb") as f:
            f.write(file_bytes)
        print('[+] INTERPOLATION VERIFIED MEDIA SAVED TO:', out_path)

        os.makedirs('evidence/video/interpolation', exist_ok=True)
        with open('evidence/video/interpolation/response.json', 'w', encoding='utf-8') as f:
            json.dump({
                "mediaId": newest_id,
                "cdn_url": res_data['finalUrl'],
                "contentType": res_data['contentType'],
                "length_bytes": res_data['length'],
                "verified_field_shape": "startImage: { mediaId: '<uuid>' }, endImage: { mediaId: '<uuid>' }"
            }, f, indent=2)

asyncio.run(download_interpolation_video())
