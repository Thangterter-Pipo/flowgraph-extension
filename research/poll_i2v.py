import asyncio
import json
import time
import os
from playwright.async_api import async_playwright

async def poll_i2v_generation():
    project_id = "15e493d2-6465-4a3d-956f-a11c18d41e96"

    async with async_playwright() as p:
        browser = await p.chromium.connect_over_cdp('http://localhost:9222')
        context = browser.contexts[0]
        page = [pg for pg in context.pages if 'labs.google' in pg.url][0]

        session = await page.evaluate("async () => await (await fetch('/fx/api/auth/session')).json()")
        access_token = session['access_token']

        print('[+] Polling latest generation status...')
        for i in range(25):
            # Check latest project media/operations via status check
            state = await page.evaluate("""() => {
                const text = document.body.innerText;
                const progress = text.match(/\\d+%/g);
                const videos = document.querySelectorAll('video').length;
                return { progress: progress ? progress.slice(0, 5) : [], videos };
            }""")
            print(f'  [{i*5}s] UI State: {state}')

            # Inspect operations or status via trpc/credits
            cr = await page.evaluate("""async (token) => {
                const r = await fetch('https://aisandbox-pa.googleapis.com/v1/credits', {
                    headers: { 'Authorization': 'Bearer ' + token }
                });
                return await r.json();
            }""", access_token)
            print(f'      Credits remaining: {cr.get("credits")}')
            
            await asyncio.sleep(5)

asyncio.run(poll_i2v_generation())
