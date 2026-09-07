import asyncio
import json
import urllib.request
import base64
import websockets

async def verify_templates_library():
    print("==========================================================================")
    print("      KIỂM TRA TÍNH NĂNG MY LIBRARY TEMPLATES                            ")
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

        # 1. Click chuyển sang Tab "My Library Templates"
        print("[*] 1. Chuyển sang tab My Library Templates...")
        await call("Runtime.evaluate", {"expression": """(() => {
            const tabs = Array.from(document.querySelectorAll('.library-tab'));
            const tplTab = tabs.find(t => t.innerText.includes('Templates'));
            tplTab?.click();
            return 'Clicked Templates Tab';
        })()"""})
        await asyncio.sleep(0.6)

        # 2. Đọc danh sách templates đang có
        tpl_info = await call("Runtime.evaluate", {
            "expression": """(() => {
                const cards = Array.from(document.querySelectorAll('.template-card')).map(c => ({
                    title: c.querySelector('.template-card-head strong')?.innerText,
                    tag: c.querySelector('.tpl-tag')?.innerText,
                    desc: c.querySelector('.template-card-desc')?.innerText
                }));
                return {
                    activeTab: document.querySelector('.library-tab.active')?.innerText,
                    templateCount: cards.length,
                    cards
                };
            })()""",
            "returnByValue": True
        })
        res = tpl_info.get("result", {}).get("result", {}).get("value")
        print("[+] Kết quả đọc Templates:", json.dumps(res, indent=2))

        # 3. Chụp ảnh màn hình làm bằng chứng
        snap = await call("Page.captureScreenshot", {"format": "png"})
        data = snap.get("result", {}).get("data")
        if data:
            with open("E:/Flow_veo/studio_my_library_templates_verified.png", "wb") as f:
                f.write(base64.b64decode(data))
            print("[+] Đã lưu ảnh chụp Studio với My Library Templates: E:/Flow_veo/studio_my_library_templates_verified.png")

if __name__ == "__main__":
    asyncio.run(verify_templates_library())
