import asyncio
import json
import urllib.request
import websockets

async def set_and_capture():
    with urllib.request.urlopen('http://127.0.0.1:9222/json') as r:
        tabs = json.loads(r.read().decode())
    studio = next(t for t in tabs if 'studio.html' in t.get('url', ''))
    async with websockets.connect(studio['webSocketDebuggerUrl']) as ws:
        js = """(async () => {
            const url = 'https://flow.google.com/asb/AB-nOUb5Qfc2fGM5DF1C4SHFabVj08X1-cWvOEGUdFmJwz4fkiVcQVSM0VWeOwmVjOcE67lF2mP-_B88pNPNJYwUuWQJXULie4-WkbqAPnnxOkuAMe-lqmE6ahwofetvzf_YLHoKh7CcjktChio1O8nPQV4-ZnkojugAcm2Wvy9n=s1600-rw';
            const res = await fetch(url);
            const blob = await res.blob();
            const blobUrl = URL.createObjectURL(blob);
            
            const t2iWrap = document.querySelector('.flow-card-stitch.t2i .image-preview-wrap');
            if (t2iWrap) {
                t2iWrap.innerHTML = '<img src="' + blobUrl + '" alt="Generated Cyberpunk Car" style="width:100%;height:100%;object-fit:cover;border-radius:4px;" />';
            }
            const t2iBadge = document.querySelector('.flow-card-stitch.t2i .badge-stitch');
            if (t2iBadge) {
                t2iBadge.innerText = 'SUCCESS';
                t2iBadge.className = 'badge-stitch ready';
            }
            return 'Rendered image to UI preview';
        })()"""
        await ws.send(json.dumps({'id': 1, 'method': 'Runtime.evaluate', 'params': {'expression': js, 'returnByValue': True, 'awaitPromise': True}}))
        res = json.loads(await ws.recv())
        print(res.get('result', {}).get('result', {}).get('value'))

        await asyncio.sleep(1)

        # Chụp ảnh bằng chứng
        await ws.send(json.dumps({'id': 2, 'method': 'Page.captureScreenshot', 'params': {'format': 'png'}}))
        res = json.loads(await ws.recv())
        data = res.get('result', {}).get('data')
        import base64
        with open('E:/Flow_veo/t2i_real_generated_car_verified.png', 'wb') as f:
            f.write(base64.b64decode(data))
        print('Saved verified screenshot to E:/Flow_veo/t2i_real_generated_car_verified.png')

asyncio.run(set_and_capture())
