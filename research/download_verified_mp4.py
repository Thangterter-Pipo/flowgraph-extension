import asyncio
import os
import requests
from playwright.async_api import async_playwright

async def download_mp4_video():
    media_id = "b834294a-0e9a-4dd3-b2ff-f6cfdeb30550"
    out_path = r"E:\Flow_veo\evidence\download\verified_fox_video.mp4"

    async with async_playwright() as p:
        browser = await p.chromium.connect_over_cdp('http://localhost:9222')
        context = browser.contexts[0]
        page = [pg for pg in context.pages if 'labs.google' in pg.url][0]

        # Fetch session cookies from page
        cookies = await context.cookies('https://labs.google')
        cookie_hdr = "; ".join([f"{c['name']}={c['value']}" for c in cookies])

        redirect_url = f"https://labs.google/fx/api/trpc/media.getMediaUrlRedirect?name={media_id}"
        print('[+] Requesting redirect URL:', redirect_url)

        # Download stream in page context
        res_data = await page.evaluate("""async (url) => {
            const res = await fetch(url, { redirect: 'follow' });
            const blob = await res.blob();
            const buffer = await blob.arrayBuffer();
            const bytes = new Uint8Array(buffer);
            let binary = '';
            for (let i = 0; i < bytes.byteLength; i++) {
                binary += String.fromCharCode(bytes[i]);
            }
            return {
                url: res.url,
                contentType: res.headers.get('content-type'),
                length: bytes.byteLength,
                base64: btoa(binary)
            };
        }""", redirect_url)

        print('[+] Direct CDN Signed URL:', res_data['url'][:120])
        print('[+] Content Type:', res_data['contentType'])
        print('[+] File Size:', res_data['length'], 'bytes')

        import base64
        file_bytes = base64.b64decode(res_data['base64'])
        os.makedirs(os.path.dirname(out_path), exist_ok=True)
        with open(out_path, "wb") as f:
            f.write(file_bytes)
        print('[+] MP4 FILE SAVED SUCCESSFULLY TO:', out_path)

        # Save download evidence fixtures
        import json
        with open(r"E:\Flow_veo\evidence\download\request.json", "w") as f:
            json.dump({"mediaId": media_id, "url": redirect_url}, f, indent=2)
        with open(r"E:\Flow_veo\evidence\download\response.json", "w") as f:
            json.dump({
                "direct_cdn_url": res_data['url'],
                "contentType": res_data['contentType'],
                "length_bytes": res_data['length']
            }, f, indent=2)

asyncio.run(download_mp4_video())
