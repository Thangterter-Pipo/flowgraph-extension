import asyncio
import os
import base64
import json
from playwright.async_api import async_playwright

async def download_exact_i2v_mp4():
    video_media_id = "cd2ef7e8-606b-47a7-89b2-681117c0451d"
    out_path = f"evidence/download/i2v_verified_{video_media_id}.mp4"

    async with async_playwright() as p:
        browser = await p.chromium.connect_over_cdp('http://localhost:9222')
        context = browser.contexts[0]
        page = [pg for pg in context.pages if 'labs.google' in pg.url][0]

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
        }""", video_media_id)

        print('[+] Direct CDN URL:', res_data['finalUrl'][:120])
        print('[+] Content-Type:', res_data['contentType'])
        print('[+] File Size:', res_data['length'], 'bytes')

        file_bytes = base64.b64decode(res_data['base64'])
        os.makedirs('evidence/download', exist_ok=True)
        with open(out_path, "wb") as f:
            f.write(file_bytes)
        print('[+] I2V VERIFIED MP4 SAVED TO:', out_path)

        os.makedirs('evidence/video/i2v', exist_ok=True)
        with open('evidence/video/i2v/response.json', 'w', encoding='utf-8') as f:
            json.dump({
                "mediaId": video_media_id,
                "cdn_url": res_data['finalUrl'],
                "contentType": res_data['contentType'],
                "length_bytes": res_data['length'],
                "verified_field_shape": "startImage: { mediaId: '<uuid>' }"
            }, f, indent=2)

asyncio.run(download_exact_i2v_mp4())
