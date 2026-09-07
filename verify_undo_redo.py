import asyncio
import json
import urllib.request
import websockets

async def verify_undo_redo():
    print("==========================================================================")
    print("      KIỂM TRA TÍNH NĂNG HOÀN TÁC (UNDO) VÀ LÀM LẠI (REDO) TRÊN CANVAS     ")
    print("==========================================================================")

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

        # 1. Kiểm tra sự hiện diện của 2 nút Undo và Redo trên canvas toolbar
        buttons = await eval_js("""(() => {
            const btns = Array.from(document.querySelectorAll('.canvas-toolbar button'));
            return btns.map(b => ({
                title: b.getAttribute('title') || b.innerText.trim(),
                disabled: b.disabled
            }));
        })()""")
        print("[+] Các nút trên thanh công cụ Canvas:", json.dumps(buttons, indent=2))

        # 2. Thử mô phỏng phím tắt Ctrl+Z (Undo)
        print("\n[*] Thử nghiệm phím tắt Ctrl+Z...")
        await ws.send(json.dumps({
            "id": 991,
            "method": "Input.dispatchKeyEvent",
            "params": {
                "type": "keyDown",
                "modifiers": 2, # Ctrl
                "windowsVirtualKeyCode": 90, # Z
                "key": "z",
                "code": "KeyZ"
            }
        }))
        await ws.recv()
        await ws.send(json.dumps({
            "id": 992,
            "method": "Input.dispatchKeyEvent",
            "params": {
                "type": "keyUp",
                "modifiers": 2,
                "windowsVirtualKeyCode": 90,
                "key": "z",
                "code": "KeyZ"
            }
        }))
        await ws.recv()

        # Kiểm tra nút Redo đã sáng đèn chưa
        await asyncio.sleep(0.3)
        buttons_after = await eval_js("""(() => {
            const btns = Array.from(document.querySelectorAll('.canvas-toolbar button'));
            return btns.map(b => ({
                title: b.getAttribute('title') || b.innerText.trim(),
                disabled: b.disabled
            }));
        })()""")
        print("[+] Trạng thái các nút sau tương tác:", json.dumps(buttons_after, indent=2))

if __name__ == "__main__":
    asyncio.run(verify_undo_redo())
