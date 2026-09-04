import asyncio
import os
import struct
import zlib
from playwright.async_api import async_playwright

def make_png(path, width=128, height=128, color=(200, 100, 50)):
    """Create a simple solid-color PNG file."""
    def chunk(tag, data):
        c = tag + data
        return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c))

    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    raw = b""
    row = b"\x00" + bytes(color) * width
    for _ in range(height):
        raw += row
    idat = zlib.compress(raw)
    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b"")
    with open(path, "wb") as f:
        f.write(png)
    return path

async def upload_test_image():
    test_img = make_png(r"E:\Flow_veo\evidence\upload\test_upload.png")
    print('Test image created:', test_img, os.path.getsize(test_img), 'bytes')

    async with async_playwright() as p:
        browser = await p.chromium.connect_over_cdp('http://localhost:9222')
        context = browser.contexts[0]
        page = [pg for pg in context.pages if 'labs.google' in pg.url][0]

        # Find file input and set files
        file_input = page.locator('input[type="file"][accept="image/*"]')
        count = await file_input.count()
        print('File inputs found:', count)
        if count > 0:
            await file_input.first.set_input_files(test_img)
            print('File set. Waiting for upload flow...')
            await asyncio.sleep(4)

            # Check if an image tile appeared in the project
            tiles = await page.evaluate("""() => {
                const imgs = Array.from(document.querySelectorAll('img'));
                return imgs.map(i => ({ src: (i.src || '').slice(0, 120), alt: i.alt || '' })).slice(-5);
            }""")
            print('Images on page:', tiles)

asyncio.run(upload_test_image())
