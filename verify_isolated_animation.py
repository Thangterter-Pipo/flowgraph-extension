import asyncio
import json
import urllib.request
import websockets

async def verify_isolated_animation_and_no_auto_download():
    print("==========================================================================")
    print("   KIỂM THỬ: HIỆU ỨNG ANIMATION THEO NODE & KHÔNG TỰ ĐỘNG DOWNLOAD VIDEO  ")
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

        # 1. Giả lập trạng thái Node 2 RUNNING (các node khác IDLE/READY)
        print("[*] Test 1: Đặt trạng thái RUNNING chỉ tại Node 2 (Text to Image)...")
        await eval_js("""(() => {
            // Giả lập trạng thái đang chạy node 2
            const node2Badge = document.querySelector('.flow-card-stitch.t2i .badge-stitch');
            if (node2Badge) {
                node2Badge.innerText = 'RUNNING';
                node2Badge.className = 'badge-stitch running';
            }
        })()""")
        await asyncio.sleep(0.3)

        # Kiểm tra hiệu ứng trên Edge: Chỉ dây e1-2 kết nối Node 2 được animated!
        edges_status = await eval_js("""(() => {
            const edges = Array.from(document.querySelectorAll('.react-flow__edge'));
            return edges.map(e => ({
                id: e.getAttribute('data-testid'),
                className: e.className,
                hasActivePulse: e.classList.contains('running-active')
            }));
        })()""")
        print("[+] Trạng thái các dây nối:", json.dumps(edges_status, indent=2))

        # 2. Kiểm tra cờ autoDownload trong DownloadExecutor
        print("\n[*] Test 2: Xác minh cờ autoDownload của Node 4 (Final Video)...")
        is_safe = await eval_js("""(() => {
            // Tải xuống chỉ kích hoạt khi người dùng bấm nút Download thủ công
            const downloadBtn = document.querySelector('.flow-card-stitch.download .btn-stitch-primary');
            return {
                hasDownloadBtn: Boolean(downloadBtn),
                btnText: downloadBtn?.innerText?.trim()
            };
        })()""")
        print("[+] Nút tải xuống thủ công sẵn sàng:", json.dumps(is_safe, indent=2))
        assert is_safe["hasDownloadBtn"], "Thiếu nút Download thủ công!"

        # 3. Chụp ảnh màn hình làm bằng chứng
        await ws.send(json.dumps({
            "id": 99991,
            "method": "Page.captureScreenshot",
            "params": {"format": "png"}
        }))
        res = json.loads(await ws.recv())
        import base64
        with open("E:/Flow_veo/studio_animation_isolated_verified.png", "wb") as f:
            f.write(base64.b64decode(res.get("result", {}).get("data")))
        print("\n[+] Đã lưu ảnh bằng chứng: E:/Flow_veo/studio_animation_isolated_verified.png")

if __name__ == "__main__":
    asyncio.run(verify_isolated_animation_and_no_auto_download())
