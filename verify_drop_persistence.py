import asyncio
import json
import urllib.request
import websockets

async def verify_persistent_dropped_images():
    print("==========================================================================")
    print("      KIỂM TRA LƯU VĨNH VIỄN ẢNH KÉO THẢ TỪ NGOÀI VÀO SAU KHI RELOAD     ")
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

        # 1. Giả lập kéo thả một ảnh cục bộ với DataURL thật vào Node #2 (Text to Image)
        dummy_base64_png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkWPjfDwAEfQHzG8v/4AAAAABJRU5ErkJggg=="
        print("[*] 1. Dispatch sự kiện gán ảnh cục bộ vào node...")
        await call("Runtime.evaluate", {
            "expression": f"""(() => {{
                window.dispatchEvent(new CustomEvent('flowgraph:node-drop-media', {{
                    detail: {{
                        nodeId: '2',
                        type: 'image',
                        file: new File(["dummy"], "test-drop.png", {{ type: "image/png" }}),
                        blobUrl: "{dummy_base64_png}"
                    }}
                }}));
                return 'Dispatched drop event';
            }})()"""
        })
        await asyncio.sleep(0.5)

        # 2. Bấm Save để persist
        print("[*] 2. Bấm Save để lưu workflow...")
        await call("Runtime.evaluate", {
            "expression": """(() => {
                const saveBtn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Save'));
                saveBtn?.click();
                return 'Saved';
            })()"""
        })
        await asyncio.sleep(0.5)

        # 3. Reload lại trang Studio
        print("[*] 3. Reload lại toàn bộ trang Studio...")
        await call("Page.reload")
        await asyncio.sleep(2)

        # 4. Kiểm tra lại Node #2 sau khi reload
        res = await call("Runtime.evaluate", {
            "expression": """(() => {
                const node2 = document.querySelector('.react-flow__node[data-id="2"]');
                const img = node2?.querySelector('img');
                return {
                    node2Exists: Boolean(node2),
                    imgSrcPrefix: img?.src?.slice(0, 30),
                    hasImage: Boolean(img && img.src && !img.src.endsWith('/'))
                };
            })()""",
            "returnByValue": True
        })
        val = res.get("result", {}).get("result", {}).get("value")
        print("[+] Trạng thái ảnh Node #2 sau khi Reload:", json.dumps(val, indent=2))
        assert val.get("hasImage") == True, "LỖI: Ảnh vẫn bị mất sau khi reload!"
        print("[+] XÁC MINH THÀNH CÔNG: Ảnh kéo thả từ ngoài vào ĐÃ ĐƯỢC GIỮ VĨNH VIỄN 100%!")

if __name__ == "__main__":
    asyncio.run(verify_persistent_dropped_images())
