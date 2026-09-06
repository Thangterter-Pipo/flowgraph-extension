import asyncio
import json
import urllib.request
import websockets

async def verify_running_status_and_play_btn():
    print("==========================================================================")
    print("   KIỂM THỬ: ĐÃ CÓ KẾT QUẢ THÌ KHÔNG BỊ TREO 'RUNNING' & NÚT PLAY BIẾN MẤT ")
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

        # 1. Kiểm tra trạng thái Node 2 Text to Image (Đã có ảnh kết quả)
        node2_badge = await eval_js("""(() => {
            const n2 = document.querySelector('[data-id=\"2\"] .badge-stitch');
            return {
                text: n2?.innerText,
                className: n2?.className
            };
        })()""")
        print("[+] Trạng thái Badge Node 2 (Text to Image):", json.dumps(node2_badge, indent=2))
        assert "completed" in node2_badge["className"], "Lỗi: Node 2 đã có ảnh nhưng không hiển thị COMPLETED!"

        # 2. Kiểm tra tính năng ẩn nút Play khi đang xem Video ở Node 3
        print("\n[*] Kiểm tra nút Play ở Node 3 (Image to Video)...")
        play_btn_before = await eval_js("Boolean(document.querySelector('[data-id=\"3\"] .play-button-glass'))")
        print("  -> Ban đầu nút Play có hiện diện:", play_btn_before)

        print("[*] Click vào khung video để bắt đầu phát (Playing)...")
        await eval_js("document.querySelector('[data-id=\"3\"] .play-button-glass')?.click()")
        await asyncio.sleep(0.3)

        play_btn_during = await eval_js("Boolean(document.querySelector('[data-id=\"3\"] .play-button-glass'))")
        is_playing_class = await eval_js("document.querySelector('[data-id=\"3\"] .player-overlay')?.classList.contains('is-playing')")
        print("  -> Trong lúc đang xem video:")
        print("     + Lớp overlay có cờ 'is-playing':", is_playing_class)
        print("     + Nút Play tròn ở giữa màn hình đã biến mất:", not play_btn_during)
        assert not play_btn_during, "Lỗi: Đang xem video mà nút Play vẫn chưa biến mất!"

        # Click lại để dừng
        await eval_js("document.querySelector('[data-id=\"3\"] .player-overlay')?.click()")
        await asyncio.sleep(0.3)
        play_btn_after_pause = await eval_js("Boolean(document.querySelector('[data-id=\"3\"] .play-button-glass'))")
        print("  -> Khi tạm dừng, nút Play xuất hiện lại:", play_btn_after_pause)

        # Chụp ảnh xác nhận
        await ws.send(json.dumps({
            "id": 99995,
            "method": "Page.captureScreenshot",
            "params": {"format": "png"}
        }))
        res = json.loads(await ws.recv())
        import base64
        with open("E:/Flow_veo/studio_play_and_status_verified.png", "wb") as f:
            f.write(base64.b64decode(res.get("result", {}).get("data")))
        print("\n[+] Đã chụp ảnh lưu bằng chứng: E:/Flow_veo/studio_play_and_status_verified.png")

if __name__ == "__main__":
    asyncio.run(verify_running_status_and_play_btn())
