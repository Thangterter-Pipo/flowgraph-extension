import asyncio
import json
import urllib.request
import websockets

async def verify_auto_layout_button():
    print("==========================================================================")
    print("      KIỂM TRA NÚT TỰ ĐỘNG SẮP XẾP CÁC NODE (AUTO LAYOUT)                 ")
    print("==========================================================================")

    with urllib.request.urlopen("http://127.0.0.1:9222/json") as r:
        tabs = json.loads(r.read().decode())
    studio = next(t for t in tabs if "studio.html" in t.get("url", ""))

    async with websockets.connect(studio["webSocketDebuggerUrl"], max_size=20*1024*1024) as ws:
        msg_id = 0
        async def call(method, params=None):
            nonlocal msg_id
            msg_id += 1
            await ws.send(json.dumps({"id": msg_id, "method": method, "params": params or {}}))
            while True:
                msg = json.loads(await ws.recv())
                if msg.get("id") == msg_id: return msg

        # 1. Tìm nút Auto Layout trên thanh Canvas Toolbar
        btn_info = await call("Runtime.evaluate", {
            "expression": """(() => {
                const btn = Array.from(document.querySelectorAll('.canvas-toolbar button')).find(b => b.title.includes('Auto Layout'));
                return {
                    exists: Boolean(btn),
                    title: btn?.title,
                    disabled: btn?.disabled
                };
            })()""",
            "returnByValue": True
        })
        print("[+] Thông tin nút Auto Layout:", json.dumps(btn_info.get("result", {}).get("result", {}).get("value"), indent=2))
        assert btn_info.get("result", {}).get("result", {}).get("value", {}).get("exists") == True, "Nút Auto Layout chưa xuất hiện!"

        # 2. Click nút Auto Layout để sắp xếp đồ thị
        print("[*] 2. Nhấp nút Auto Layout để căn chỉnh lại vị trí các node...")
        await call("Runtime.evaluate", {
            "expression": """(() => {
                const btn = Array.from(document.querySelectorAll('.canvas-toolbar button')).find(b => b.title.includes('Auto Layout'));
                btn?.click();
                return 'Clicked Auto Layout';
            })()"""
        })
        await asyncio.sleep(1)

        # 3. Chụp ảnh xác thực kết quả bố trí đồ thị
        snap = await call("Page.captureScreenshot", {"format": "png"})
        import base64
        with open("E:/Flow_veo/studio_auto_layout_verified.png", "wb") as f:
            f.write(base64.b64decode(snap.get("result", {}).get("data", "")))
        print("[+] Đã chụp ảnh màn hình sau khi sắp xếp: E:/Flow_veo/studio_auto_layout_verified.png")

if __name__ == "__main__":
    asyncio.run(verify_auto_layout_button())
