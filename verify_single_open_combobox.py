import asyncio
import json
import urllib.request
import websockets

async def verify_single_open_combobox():
    print("==========================================================================")
    print("   KIỂM THỬ ĐỘC QUYỀN TRẠNG THÁI: CHỈ MỞ DUY NHẤT 1 COMBOBOX CÙNG LÚC      ")
    print("==========================================================================")

    with urllib.request.urlopen("http://127.0.0.1:9222/json") as r:
        tabs = json.loads(r.read().decode())
    studio = next(t for t in tabs if "studio.html" in t.get("url", ""))
    assert studio, "Không tìm thấy tab Studio!"

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

        # 1. Ban đầu: Kiểm tra số lượng dropdown đang mở
        count_init = await eval_js("document.querySelectorAll('.custom-combobox-dropdown').length")
        print(f"[*] Ban đầu: Số combobox đang mở = {count_init}")
        assert count_init == 0, "Ban đầu không được mở combobox nào!"

        # 2. Click mở Combobox Model
        print("\n[*] Click mở Combobox Model...")
        await eval_js("document.querySelector('.flow-card-stitch.i2v .model-wrap')?.click()")
        await asyncio.sleep(0.3)
        count_after_1 = await eval_js("document.querySelectorAll('.custom-combobox-dropdown').length")
        print(f"  -> Số combobox đang mở = {count_after_1}")
        assert count_after_1 == 1, "Chỉ được mở duy nhất 1 combobox!"

        # 3. Click mở Combobox Duration -> Combobox Model PHẢI TỰ ĐỘNG ĐÓNG!
        print("\n[*] Click mở Combobox Duration (Kiểm tra Model có tự đóng không)...")
        await eval_js("document.querySelector('.flow-card-stitch.i2v .duration-wrap')?.click()")
        await asyncio.sleep(0.3)
        count_after_2 = await eval_js("document.querySelectorAll('.custom-combobox-dropdown').length")
        text_open = await eval_js("document.querySelector('.custom-combobox-dropdown')?.innerText?.replace(/\\n/g, ' ')")
        print(f"  -> Số combobox đang mở = {count_after_2} (Nội dung dropdown đang mở: '{text_open}')")
        assert count_after_2 == 1, "Chỉ được mở đúng 1 combobox, cái cũ phải tự đóng!"

        # 4. Click mở Combobox Batch -> Duration PHẢI TỰ ĐỘNG ĐÓNG!
        print("\n[*] Click mở Combobox Batch (Kiểm tra Duration có tự đóng không)...")
        await eval_js("document.querySelector('.flow-card-stitch.i2v .batch-wrap')?.click()")
        await asyncio.sleep(0.3)
        count_after_3 = await eval_js("document.querySelectorAll('.custom-combobox-dropdown').length")
        text_batch = await eval_js("document.querySelector('.custom-combobox-dropdown')?.innerText?.replace(/\\n/g, ' ')")
        print(f"  -> Số combobox đang mở = {count_after_3} (Nội dung dropdown đang mở: '{text_batch}')")
        assert count_after_3 == 1, "Chỉ được mở đúng 1 combobox, cái cũ phải tự đóng!"

        # 5. Click ra ngoài canvas -> Tất cả phải đóng lại hoàn toàn!
        print("\n[*] Click ra ngoài màn hình Canvas...")
        await eval_js("document.querySelector('.react-flow__pane')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))")
        await asyncio.sleep(0.3)
        count_final = await eval_js("document.querySelectorAll('.custom-combobox-dropdown').length")
        print(f"  -> Số combobox đang mở sau khi click ra ngoài = {count_final}")
        assert count_final == 0, "Click ra ngoài canvas phải đóng toàn bộ combobox!"

        print("\n==========================================================================")
        print("   >>> XÁC NHẬN: CƠ CHẾ ĐỘC QUYỀN SINGLE-OPEN COMBOBOX HOẠT ĐỘNG 100% <<<   ")
        print("==========================================================================")

if __name__ == "__main__":
    asyncio.run(verify_single_open_combobox())
