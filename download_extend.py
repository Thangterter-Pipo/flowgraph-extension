import asyncio
import os
import base64
import json
from playwright.async_api import async_playwright

async def find_and_download_extend_video():
    async with async_playwright() as p:
        browser = await p.chromium.connect_over_cdp('http://localhost:9222')
        context = browser.contexts[0]
        page = [pg for pg in context.pages if 'labs.google' in pg.url][0]

        # Scan all media IDs in project
        media_info = await page.evaluate("""() => {
            const imgs = Array.from(document.querySelectorAll('img')).map(i => i.src).filter(s => s.includes('getMediaUrlRedirect'));
            const vids = Array.from(document.querySelectorAll('video')).map(v => v.src || v.currentSrc).filter(s => s.includes('getMediaUrlRedirect'));
            return { imgs, vids };
        }""")
        print('Video sources:', media_info['vids'])
        print('Image sources:', media_info['imgs'][-8:])

        import re
        ids = []
        for src in media_info['vids'] + media_info['imgs']:
            m = re.search(r'name=([0-9a-f-]{36})', src)
            if m:
                ids.append(m.group(1))
        ids = list(dict.fromkeys(ids))
        print('All media IDs:', ids)

        # Download the newest video (the last one that appeared)
        if len(media_info['vids']) > 0:
            newest_vid = media_info['vids'][0]
            m = re.search(r'name=([0-9a-f-]{36})', newest_vid)
            if m:
                vid_id = m.group(1)
                print(f'[+] Downloading extend video: {vid_id}')
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
                }""", vid_id)
                print('[+] Content-Type:', res_data['contentType'])
                print('[+] Size:', res_data['length'], 'bytes')
                file_bytes = base64.b64decode(res_data['base64'])
                os.makedirs('evidence/download', exist_ok=True)
                out = f"evidence/download/extend_verified_{vid_id}.mp4"
                with open(out, "wb") as f:
                    f.write(file_bytes)
                print('[+] EXTEND VIDEO SAVED TO:', out)

                # Save extend response fixture
                os.makedirs('evidence/video/extend', exist_ok=True)
                with open('evidence/video/extend/response.json', 'w', encoding='utf-8') as f:
                    json.dump({
                        "mediaId": vid_id,
                        "cdn_url": res_data['finalUrl'],
                        "contentType": res_data['contentType'],
                        "length_bytes": res_data['length'],
                        "verified_field_shape": "videoInput: { mediaId: '<uuid>' }"
                    }, f, indent=2)

asyncio.run(find_and_download_extend_video())