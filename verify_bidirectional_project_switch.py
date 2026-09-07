import asyncio
import json
import urllib.request
import websockets

async def verify_bidirectional_project_switch():
    print("==========================================================================")
    print("      KIỂM TRA ĐỒNG BỘ 2 CHIỀU: CHỌN DỰ ÁN TRÊN STUDIO -> FLOW TỰ CHUYỂN  ")
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

        # 1. Mở menu Google Flow Projects
        print("[*] 1. Mở menu Google Flow Projects...")
        await call("Runtime.evaluate", {"expression": "document.querySelector('.project-dropdown-trigger')?.click()"})
        await asyncio.sleep(0.5)

        # 2. Click chọn dự án khác: 'Tháng 9 06 - 17:41' (44e4fa83)
        print("[*] 2. Click chọn dự án 'Tháng 9 06 - 17:41' (44e4fa83)...")
        click_res = await call("Runtime.evaluate", {
            "expression": """(() => {
                const items = Array.from(document.querySelectorAll('.project-menu-item'));
                const target = items.find(i => i.innerText.includes('44e4fa83') || i.innerText.includes('17:41'));
                if (target) {
                    target.click();
                    return { clicked: true, text: target.innerText.replace(/\\n/g, ' ') };
                }
                return { clicked: false };
            })()""",
            "returnByValue": True
        })
        print("    -> Click result:", json.dumps(click_res.get("result", {}).get("result", {}).get("value"), indent=2))

        # 3. Đợi 3 giây để Service Worker điều hướng tab Google Flow
        print("[*] 3. Đợi Google Flow tự động điều hướng sang URL dự án mới...")
        await asyncio.sleep(3.5)

        # 4. Kiểm tra URL của tab Google Flow thật xem đã đổi sang 44e4fa83 chưa
        with urllib.request.urlopen("http://127.0.0.1:9222/json") as r2:
            tabs2 = json.loads(r2.read().decode())
        flow_tabs = [t for t in tabs2 if "flow.google.com" in t.get("url", "")]
        for f in flow_tabs:
            print(f"[+] Tab Google Flow hiện tại: {f.get('title')} --> {f.get('url')}")

if __name__ == "__main__":
    asyncio.run(verify_bidirectional_project_switch())
