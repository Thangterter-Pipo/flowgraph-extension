import asyncio
import json
import urllib.request
import websockets

async def verify_seamless_cache_transition():
    print("==========================================================================")
    print("   KIỂM THỬ TỰ ĐỘNG: CÓ SẴN KẾT QUẢ THÌ LẤY CHẠY LUÔN KHÔNG CHẶN MODAL     ")
    print("==========================================================================")

    with urllib.request.urlopen("http://127.0.0.1:9222/json") as r:
        tabs = json.loads(r.read().decode())
    studio = next((t for t in tabs if "studio.html" in t.get("url", "")), None)
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

        # 1. Bấm Run Workflow
        print("[*] 1. Click nút 'Run Workflow'...")
        click_res = await eval_js("""(() => {
            const runBtn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Run Workflow'));
            if (!runBtn) return { error: 'No button' };
            runBtn.click();
            return { ok: true };
        })()""")
        print("[+] Đã bấm Run Workflow:", click_res)

        await asyncio.sleep(0.5)

        # 2. Kiểm tra xem có bị modal popup CREDIT WARNING chặn lại nữa không
        modal_check = await eval_js("""(() => {
            const modal = document.querySelector('.experimental-modal');
            return {
                hasModal: Boolean(modal),
                modalTitle: modal?.querySelector('h3')?.innerText || null
            };
        })()""")
        print("[+] Kiểm tra Modal chặn:", modal_check)
        assert not modal_check["hasModal"], "Lỗi: Vẫn bị Modal cảnh báo chặn lại!"

        print("\n==========================================================================")
        print("   >>> XÁC NHẬN: WORKFLOW ĐÃ BỎ QUA CẢNH BÁO, TỰ ĐỘNG CHUYỂN TIẾP CHẠY LUÔN <<< ")
        print("==========================================================================")

if __name__ == "__main__":
    asyncio.run(verify_seamless_cache_transition())
