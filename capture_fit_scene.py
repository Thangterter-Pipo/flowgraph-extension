import asyncio
import json
import urllib.request
import base64
import websockets

async def capture_fit_scene():
    with urllib.request.urlopen("http://127.0.0.1:9222/json") as r:
        tabs = json.loads(r.read().decode())
    studio = next(t for t in tabs if "studio.html" in t.get("url", ""))

    async with websockets.connect(studio["webSocketDebuggerUrl"]) as ws:
        msg_id = 0
        async def eval_js(expr):
            nonlocal msg_id
            msg_id += 1
            await ws.send(json.dumps({
                "id": msg_id,
                "method": "Runtime.evaluate",
                "params": {"expression": expr, "returnByValue": True, "awaitPromise": True}
            }))
            res = json.loads(await ws.recv())
            return res.get("result", {}).get("result", {}).get("value")

        # Căn chỉnh view chuẩn xác và zoom out nhẹ để thấy trọn vẹn cả 5 node tạo cảnh
        await eval_js("""(() => {
            const fitBtn = document.querySelectorAll('.react-flow__controls-button')[2] || document.querySelectorAll('.canvas-toolbar button')[0];
            fitBtn?.click();
        })()""")
        await asyncio.sleep(0.8)

        # Chụp ảnh
        await ws.send(json.dumps({"id": 99991, "method": "Page.captureScreenshot", "params": {"format": "png"}}))
        res = json.loads(await ws.recv())
        with open("E:/Flow_veo/studio_scene_creation_perfect_fit.png", "wb") as f:
            f.write(base64.b64decode(res.get("result", {}).get("data")))
        print("[+] Đã chụp ảnh luồng Tạo Cảnh trọn vẹn: E:/Flow_veo/studio_scene_creation_perfect_fit.png")

if __name__ == "__main__":
    asyncio.run(capture_fit_scene())
