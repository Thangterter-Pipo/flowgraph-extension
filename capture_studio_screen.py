import asyncio
import json
import urllib.request
import base64
import websockets

async def capture_studio_screen():
    with urllib.request.urlopen("http://127.0.0.1:9222/json") as r:
        tabs = json.loads(r.read().decode())
    studio = next(t for t in tabs if "studio.html" in t.get("url", ""))
    
    async with websockets.connect(studio["webSocketDebuggerUrl"], max_size=20 * 1024 * 1024) as ws:
        msg_id = 0
        async def call(method, params=None):
            nonlocal msg_id
            msg_id += 1
            await ws.send(json.dumps({"id": msg_id, "method": method, "params": params or {}}))
            while True:
                msg = json.loads(await ws.recv())
                if msg.get("id") == msg_id:
                    return msg

        await call("Runtime.evaluate", {"expression": "document.querySelectorAll('.canvas-toolbar button')[0]?.click()"})
        await asyncio.sleep(0.8)

        snap = await call("Page.captureScreenshot", {"format": "png"})
        data = snap.get("result", {}).get("data")
        if data:
            with open("E:/Flow_veo/studio_both_miko_images_restored.png", "wb") as f:
                f.write(base64.b64decode(data))
            print("[+] Đã chụp màn hình thành công: E:/Flow_veo/studio_both_miko_images_restored.png")
        else:
            print("[-] Lỗi: Không có dữ liệu ảnh:", snap)

if __name__ == "__main__":
    asyncio.run(capture_studio_screen())
