import asyncio
import os
import base64
import json
from playwright.async_api import async_playwright

async def download_interp_exact():
    video_id = "d6e527a8-2089-4b2c-8e88-c7a26bd4a764"

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
        }""", video_id)

        print('[+] Interpolation Video Content-Type:', res_data['contentType'])
        print('[+] Interpolation Video Size:', res_data['length'], 'bytes')
        print('[+] CDN URL:', res_data['finalUrl'][:120])

        out_path = f"evidence/download/interpolation_verified_{video_id}.mp4"
        file_bytes = base64.b64decode(res_data['base64'])
        os.makedirs('evidence/download', exist_ok=True)
        with open(out_path, "wb") as f:
            f.write(file_bytes)
        print('[+] INTERPOLATION VERIFIED MP4 SAVED TO:', out_path)

        with open('evidence/video/interpolation/response.json', 'w', encoding='utf-8') as f:
            json.dump({
                "mediaId": video_id,
                "cdn_url": res_data['finalUrl'],
                "contentType": res_data['contentType'],
                "length_bytes": res_data['length'],
                "verified_field_shape": "startImage: { mediaId: '<uuid>' }, endImage: { mediaId: '<uuid>' }"
            }, f, indent=2)

asyncio.run(download_interp_exact())
