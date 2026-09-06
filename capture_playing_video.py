import asyncio
import json
import urllib.request
import base64
import websockets

async def capture_playing():
    with urllib.request.urlopen("http://127.0.0.1:9222/json") as r:
        tabs = json.loads(r.read().decode())
    studio = next(t for t in tabs if "studio.html" in t.get("url", ""))
    
    async with websockets.connect(studio["webSocketDebuggerUrl"]) as ws:
        msg_id = 0
        async def call_cmd(method, params=None):
            nonlocal msg_id
            msg_id += 1
            await ws.send(json.dumps({"id": msg_id, "method": method, "params": params or {}}))
            res = json.loads(await ws.recv())
            return res

        # 1. Click Play on Node 3
        print("[*] Click Play on Node 3...")
        await call_cmd("Runtime.evaluate", {"expression": "document.querySelector('[data-id=\"3\"] .play-button-glass')?.click()"})
        await asyncio.sleep(0.4)

        # 2. Capture screenshot
        snap = await call_cmd("Page.captureScreenshot", {"format": "png"})
        data = snap.get("result", {}).get("data")
        with open("E:/Flow_veo/studio_video_playing_no_button.png", "wb") as f:
            f.write(base64.b64decode(data))
        print("[+] Đã lưu ảnh đang phát video: E:/Flow_veo/studio_video_playing_no_button.png")

if __name__ == "__main__":
    asyncio.run(capture_playing())
