import asyncio
import json
import urllib.request
import base64
import websockets

async def verify_project_list():
    print("==========================================================================")
    print("      KIỂM TRA MENU DANH SÁCH GOOGLE FLOW PROJECTS                         ")
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

        # 1. Click mở menu project dropdown
        print("[*] 1. Nhấp mở menu Google Flow Projects...")
        await call("Runtime.evaluate", {"expression": "document.querySelector('.project-dropdown-trigger')?.click()"})
        await asyncio.sleep(0.6)

        # 2. Đọc danh sách items trong menu
        menu_info = await call("Runtime.evaluate", {
            "expression": """(() => {
                const menu = document.querySelector('.project-dropdown-menu');
                const items = Array.from(menu?.querySelectorAll('.project-menu-item') || []).map(b => ({
                    name: b.querySelector('.project-menu-item-name')?.innerText,
                    id: b.querySelector('.project-menu-item-id')?.innerText,
                    isActive: b.classList.contains('active')
                }));
                const note = menu?.querySelector('.project-menu-note')?.innerText;
                return {
                    hasMenu: Boolean(menu),
                    itemCount: items.length,
                    items,
                    note
                };
            })()""",
            "returnByValue": True
        })
        res = menu_info.get("result", {}).get("result", {}).get("value")
        print("[+] Kết quả nạp danh sách Projects:", json.dumps(res, indent=2))

        # 3. Chụp ảnh màn hình làm bằng chứng
        snap = await call("Page.captureScreenshot", {"format": "png"})
        data = snap.get("result", {}).get("data")
        if data:
            with open("E:/Flow_veo/studio_projects_dropdown_loaded.png", "wb") as f:
                f.write(base64.b64decode(data))
            print("[+] Đã lưu ảnh chụp menu projects: E:/Flow_veo/studio_projects_dropdown_loaded.png")

if __name__ == "__main__":
    asyncio.run(verify_project_list())
