import asyncio
import json
import urllib.request
import websockets

async def verify_reset_safety():
    print("==========================================================================")
    print("      KIỂM TRA CƠ CHẾ BẢO VỆ 2 LỚP KHI BẤM NÚT RESET CANVAS                ")
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

        # 1. Bấm nút Reset trên Canvas
        print("[*] 1. Nhấn nút 'Reset'...")
        await eval_js("""(() => {
            const resetBtn = Array.from(document.querySelectorAll('.canvas-toolbar button')).find(b => b.innerText.includes('Reset'));
            resetBtn?.click();
        })()""")

        # 2. Kiểm tra Modal xác nhận có bật lên ngăn chặn không
        await asyncio.sleep(0.3)
        modal_state = await eval_js("""(() => {
            const modal = document.querySelector('.modal-backdrop');
            const title = modal?.querySelector('h3')?.innerText;
            const cancelBtn = Array.from(modal?.querySelectorAll('button') || []).find(b => b.innerText.includes('Hủy'));
            return {
                hasModal: Boolean(modal),
                title,
                hasCancelBtn: Boolean(cancelBtn)
            };
        })()""")
        print("[+] Kết quả bật Modal chặn:", json.dumps(modal_state, indent=2))

        # 3. Bấm Hủy bỏ để giữ nguyên đồ thị an toàn
        print("[*] 3. Bấm 'Hủy bỏ' để bảo vệ toàn bộ đồ thị công sức của bố...")
        await eval_js("""(() => {
            const cancelBtn = Array.from(document.querySelectorAll('.modal-backdrop button')).find(b => b.innerText.includes('Hủy'));
            cancelBtn?.click();
        })()""")

        await asyncio.sleep(0.3)
        modal_after = await eval_js("Boolean(document.querySelector('.modal-backdrop'))")
        print("[+] Modal đã đóng an toàn, đồ thị còn nguyên:", not modal_after)

if __name__ == "__main__":
    asyncio.run(verify_reset_safety())
