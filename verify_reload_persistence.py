import asyncio
import json
import urllib.request
import websockets

async def test_persistence_on_reload():
    print("==========================================================================")
    print("    KIỂM THỬ KHẢ NĂNG BẢO TOÀN TIẾN TRÌNH DỰ ÁN KHI RELOAD STUDIO         ")
    print("==========================================================================")

    with urllib.request.urlopen("http://127.0.0.1:9222/json") as r:
        tabs = json.loads(r.read().decode())
    studio = next((t for t in tabs if "studio.html" in t.get("url", "")), None)
    assert studio, "Tab Studio không tồn tại trên CDP 9222!"

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

        # 1. Đặt cấu hình đặc trưng và gán kết quả thành công cho Node 2
        print("[*] Step 1: Thiết lập cấu hình tiến trình và lưu vào workflow...")
        setup = await eval_js("""(() => {
            window.dispatchEvent(new CustomEvent('flowgraph:update-config', {
                detail: { nodeId: '2', key: 'model', value: '🍌 Nano Banana Pro' }
            }));
            window.dispatchEvent(new CustomEvent('flowgraph:update-config', {
                detail: { nodeId: '2', key: 'aspectRatio', value: '9:16' }
            }));
            window.dispatchEvent(new CustomEvent('flowgraph:update-config', {
                detail: { nodeId: '2', key: 'batchCount', value: '2' }
            }));
            
            // Trigger nút Save
            const saveBtn = Array.from(document.querySelectorAll('.topbar-actions button')).find(b => b.innerText.includes('Save'));
            saveBtn?.click();
            return 'Saved';
        })()""")
        print("[+] Trạng thái thiết lập:", setup)
        await asyncio.sleep(0.5)

        # 2. Reload lại trang Studio
        print("[*] Step 2: Reload lại trang Studio...")
        await ws.send(json.dumps({'id': 991, 'method': 'Page.reload'}))
        await ws.recv()

    # Đợi trang reload hoàn tất
    await asyncio.sleep(3)

    # 3. Kết nối lại để kiểm tra xem cấu hình và trạng thái có được phục hồi nguyên vẹn không
    with urllib.request.urlopen("http://127.0.0.1:9222/json") as r:
        tabs = json.loads(r.read().decode())
    studio = next((t for t in tabs if "studio.html" in t.get("url", "")), None)

    async with websockets.connect(studio["webSocketDebuggerUrl"]) as ws:
        msg_id = 0
        async def eval_js_after(expr):
            nonlocal msg_id
            msg_id += 1
            await ws.send(json.dumps({
                "id": msg_id,
                "method": "Runtime.evaluate",
                "params": {"expression": expr, "returnByValue": True, "awaitPromise": True}
            }))
            res = json.loads(await ws.recv())
            return res.get("result", {}).get("result", {}).get("value")

        print("[*] Step 3: Kiểm tra phục hồi dữ liệu từ localStorage sau khi reload...")
        restored = await eval_js_after("""(() => {
            const t2i = document.querySelector('.flow-card-stitch.t2i');
            const modelPill = t2i?.querySelector('.meta-pill.model')?.textContent?.trim();
            const ratioPill = t2i?.querySelector('.meta-pill.aspect')?.textContent?.trim();
            const batchPill = t2i?.querySelector('.meta-pill.batch')?.textContent?.trim();
            const prompt = document.querySelector('.flow-card-stitch.prompt textarea')?.value;
            const nodes = Array.from(document.querySelectorAll('.react-flow__node')).length;

            return {
                nodesCount: nodes,
                modelPill,
                ratioPill,
                batchPill,
                prompt: prompt?.slice(0, 30)
            };
        })()""")

        print("[+] Kết quả phục hồi sau Reload:")
        print(json.dumps(restored, indent=2))
        
        assert restored["nodesCount"] >= 4, "Mất node sau khi reload!"
        assert "Nano Banana Pro" in (restored["modelPill"] or ""), "Mất model sau khi reload!"
        assert restored["ratioPill"] == "9:16", "Mất tỷ lệ 9:16 sau khi reload!"
        assert restored["batchPill"] == "x2", "Mất batch x2 sau khi reload!"
        print("\n==========================================================================")
        print("    >>> XÁC NHẬN: TIẾN TRÌNH DỰ ÁN ĐÃ ĐƯỢC BẢO TOÀN 100% KHI RELOAD <<<   ")
        print("==========================================================================")

if __name__ == "__main__":
    asyncio.run(test_persistence_on_reload())
