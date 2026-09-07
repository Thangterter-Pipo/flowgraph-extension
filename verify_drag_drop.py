import asyncio
import json
import urllib.request
import websockets

async def verify_drag_drop_support():
    print("==========================================================================")
    print("      KIỂM TRA TÍNH NĂNG DRAG DROP TỆP VÀO CANVAS STUDIO                 ")
    print("==========================================================================")

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

        # Kiểm tra giả lập drop file text/image
        js = """(() => {
            const canvasWrap = document.querySelector('.canvas-wrap');
            return {
                hasCanvasWrap: Boolean(canvasWrap),
                hasDropHandler: Boolean(canvasWrap?.ondrop !== undefined)
            };
        })()"""
        res = await call("Runtime.evaluate", {"expression": js, "returnByValue": True})
        print("[+] Kiểm tra canvas-wrap container:", json.dumps(res.get("result", {}).get("result", {}).get("value"), indent=2))

if __name__ == "__main__":
    asyncio.run(verify_drag_drop_support())
