import asyncio
import json
import urllib.request
import base64
import websockets

async def verify_fullscreen_templates_modal():
    print("==========================================================================")
    print("      KIỂM TRA KHUNG LỚN FULL-SCREEN: MY LIBRARY TEMPLATES               ")
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

        # 1. Click vào banner nút tím "My Library Templates" ở cột bên trái
        print("[*] 1. Nhấp mở khung lớn Templates Modal...")
        await call("Runtime.evaluate", {"expression": "document.querySelector('.open-templates-btn')?.click()"})
        await asyncio.sleep(0.6)

        # 2. Đọc thông tin khung modal lớn vừa mở
        modal_info = await call("Runtime.evaluate", {
            "expression": """(() => {
                const modal = document.querySelector('.templates-modal-window');
                const title = modal?.querySelector('.tpl-modal-title h2')?.innerText;
                const cards = Array.from(modal?.querySelectorAll('.tpl-card-showcase') || []).map(c => ({
                    title: c.querySelector('.tpl-card-showcase-title')?.innerText,
                    badge: c.querySelector('.tpl-badge')?.innerText,
                    desc: c.querySelector('.tpl-card-showcase-desc')?.innerText
                }));
                const inspectorTitle = modal?.querySelector('.tpl-preview-header h3')?.innerText;
                const flowNodes = Array.from(modal?.querySelectorAll('.tpl-flow-item strong') || []).map(s => s.innerText);
                return {
                    isOpen: Boolean(modal),
                    modalTitle: title,
                    cardCount: cards.length,
                    cards,
                    inspectorTitle,
                    flowNodes
                };
            })()""",
            "returnByValue": True
        })
        res = modal_info.get("result", {}).get("result", {}).get("value")
        print("[+] Thông tin chi tiết Khung Lớn Templates:", json.dumps(res, indent=2))

        # 3. Chụp ảnh màn hình làm bằng chứng
        snap = await call("Page.captureScreenshot", {"format": "png"})
        data = snap.get("result", {}).get("data")
        if data:
            with open("E:/Flow_veo/studio_fullscreen_templates_modal_verified.png", "wb") as f:
                f.write(base64.b64decode(data))
            print("[+] Đã lưu ảnh chụp khung lớn Templates Modal: E:/Flow_veo/studio_fullscreen_templates_modal_verified.png")

if __name__ == "__main__":
    asyncio.run(verify_fullscreen_templates_modal())
