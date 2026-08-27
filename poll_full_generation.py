import asyncio
import json
import time
from playwright.async_api import async_playwright

async def poll_full_generation():
    media_id = "b834294a-0e9a-4dd3-b2ff-f6cfdeb30550"
    project_id = "15e493d2-6465-4a3d-956f-a11c18d41e96"

    async with async_playwright() as p:
        browser = await p.chromium.connect_over_cdp('http://localhost:9222')
        context = browser.contexts[0]
        page = [pg for pg in context.pages if 'labs.google' in pg.url][0]

        captured = []
        async def on_req(req):
            if 'aisandbox-pa' in req.url or 'getMediaUrlRedirect' in req.url:
                captured.append(('req', req.method, req.url, req.post_data))
        async def on_res(res):
            if 'aisandbox-pa' in res.url or 'getMediaUrlRedirect' in res.url:
                try:
                    txt = await res.text()
                    captured.append(('res', res.status, res.url, txt))
                except Exception:
                    captured.append(('res', res.status, res.url, None))
        page.on('request', on_req)
        page.on('response', on_res)

        session = await page.evaluate("async () => await (await fetch('/fx/api/auth/session')).json()")
        access_token = session['access_token']

        # Poll the generation status loop
        print('[+] Polling generation status...')
        for i in range(60):
            res = await page.evaluate("""async (args) => {
                const r = await fetch('https://aisandbox-pa.googleapis.com/v1/video:batchCheckAsyncVideoGenerationStatus', {
                    method: 'POST',
                    headers: { 'Authorization': 'Bearer ' + args.token, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ media: [{ name: args.mediaId, projectId: args.projectId }] })
                });
                return { status: r.status, json: await r.json() };
            }""", {'token': access_token, 'mediaId': media_id, 'projectId': project_id})

            status = res['json'].get('media', [{}])[0].get('mediaMetadata', {}).get('mediaStatus', {}).get('mediaGenerationStatus')
            print(f'  [{i*10}s] {status}')

            if status in ('MEDIA_GENERATION_STATUS_SUCCESSFUL', 'MEDIA_GENERATION_STATUS_COMPLETE'):
                print('[+] GENERATION COMPLETE!')
                # Save response
                with open('evidence/polling/poll_final.json', 'w') as f:
                    json.dump(res['json'], f, indent=2)
                # Try download
                dl = await page.evaluate("""async (mediaId) => {
                    const r = await fetch('/fx/api/trpc/media.getMediaUrlRedirect?name=' + mediaId, { redirect: 'manual' });
                    return { status: r.status, url: r.url, headers: Object.fromEntries(r.headers.entries()) };
                }""", media_id)
                print('[+] Download redirect:', dl['status'], dl['url'][:120])
                break
            if status in ('MEDIA_GENERATION_STATUS_FAILED', 'MEDIA_GENERATION_STATUS_CANCELED'):
                print('[-] Generation FAILED:', json.dumps(res['json'], indent=2)[:500])
                break
            await asyncio.sleep(10)

        print(f'[+] Total captured events: {len(captured)}')
        for ev in captured[-10:]:
            kind, status, url, body = ev
            print(f'  {kind.upper()} {status} {url.split("?")[0]}')
            if body and len(str(body)) < 300:
                print('     ', str(body)[:200])

asyncio.run(poll_full_generation())
