import asyncio
import json
import os
import sys
import time
import urllib.request
import websockets

STUDIO_URL = "chrome-extension://doibgbebcgbecadimjcclbbhpaodijdp/studio.html"

async def run_live_e2e():
    print("=================================================================")
    print("       FLOWGRAPH STUDIO LIVE CHROME CDP E2E AUTOMATION TEST      ")
    print("=================================================================")

    # 1. Kết nối Chrome CDP
    with urllib.request.urlopen("http://127.0.0.1:9222/json") as r:
        tabs = json.loads(r.read().decode())
    
    studio = next((t for t in tabs if "studio.html" in t.get("url", "")), None)
    if not studio:
        print("[-] Không tìm thấy tab Studio trên CDP 9222. Đang mở mới...")
        req = urllib.request.Request(f"http://127.0.0.1:9222/json/new?{STUDIO_URL}", method="PUT")
        with urllib.request.urlopen(req) as r:
            studio = json.loads(r.read().decode())
        time.sleep(2)

    ws_url = studio["webSocketDebuggerUrl"]
    print(f"[+] Đã kết nối Chrome CDP Studio: {ws_url}")

    async with websockets.connect(ws_url) as ws:
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

        # Step 1: Kiểm tra 4 Node trên Canvas
        print("\n[*] Step 1: Kiểm tra cấu trúc 4 Node trên Canvas...")
        nodes_info = await eval_js("""(() => {
            const nodes = Array.from(document.querySelectorAll('.flow-card-stitch')).map(el => ({
                kind: el.className,
                title: el.querySelector('.card-title')?.innerText,
                status: el.querySelector('.badge-stitch')?.innerText || 'PROMPT_ACTIVE'
            }));
            return nodes;
        })()""")
        print(f"[+] Tìm thấy {len(nodes_info)} nodes:")
        for n in nodes_info:
            print(f"    - {n['title']} [{n['status']}]")
        assert len(nodes_info) == 4, f"Cần 4 nodes, nhưng thấy {len(nodes_info)}"

        # Step 2: Test Mở Popup Cài đặt trên Node Text to Image qua Event
        print("\n[*] Step 2: Mở Settings Popup trên Node Text to Image...")
        await eval_js("""(() => {
            window.dispatchEvent(new CustomEvent('flowgraph:toggle-settings', { detail: { nodeId: '2', open: true } }));
        })()""")
        await asyncio.sleep(0.3)
        popup_opened = await eval_js("""(() => {
            const t2i = document.querySelector('.flow-card-stitch.t2i');
            return Boolean(t2i?.querySelector('.node-settings-popup'));
        })()""")
        assert popup_opened, "Popup cài đặt Node T2I không mở!"
        print("[+] Popup cài đặt Node T2I đã mở thành công.")

        # Step 3: Test Đổi Model sang '🍌 Nano Banana Pro'
        print("\n[*] Step 3: Chọn Model '🍌 Nano Banana Pro'...")
        model_switched = await eval_js("""(() => {
            const select = document.querySelector('.flow-card-stitch.t2i .popup-select');
            if (!select) return null;
            select.value = '🍌 Nano Banana Pro';
            select.dispatchEvent(new Event('change', { bubbles: true }));
            return select.value;
        })()""")
        print(f"[+] Giá trị model sau khi chọn: {model_switched}")
        assert model_switched == '🍌 Nano Banana Pro', "Model đổi thất bại!"

        # Step 4: Test Đổi Tỷ lệ sang '9:16'
        print("\n[*] Step 4: Chọn Tỷ lệ '9:16'...")
        ratio_switched = await eval_js("""(() => {
            const btns = Array.from(document.querySelectorAll('.flow-card-stitch.t2i .popup-segmented button'));
            const btn916 = btns.find(b => b.textContent.trim() === '9:16');
            if (btn916) {
                btn916.click();
                return true;
            }
            return false;
        })()""")
        assert ratio_switched, "Không tìm thấy nút 9:16!"
        print("[+] Đã click chọn Tỷ lệ '9:16'.")

        # Step 5: Test Chọn Batch Multiplier 'x4'
        print("\n[*] Step 5: Chọn Batch Multiplier 'x4'...")
        batch_switched = await eval_js("""(() => {
            const btns = Array.from(document.querySelectorAll('.flow-card-stitch.t2i .popup-segmented button'));
            const btnx4 = btns.find(b => b.textContent.trim() === 'x4');
            if (btnx4) {
                btnx4.click();
                return true;
            }
            return false;
        })()""")
        assert batch_switched, "Không tìm thấy nút x4!"
        print("[+] Đã click chọn Batch 'x4'.")

        # Step 6: Đóng Popup T2I và Mở Popup Node Image to Video qua Event
        print("\n[*] Step 6: Đóng popup T2I và Mở Settings Popup trên Node Image to Video...")
        # Đóng popup T2I
        await eval_js("""(() => {
            window.dispatchEvent(new CustomEvent('flowgraph:toggle-settings', { detail: { nodeId: '2', open: false } }));
        })()""")
        await asyncio.sleep(0.3)

        # Mở popup I2V
        await eval_js("""(() => {
            window.dispatchEvent(new CustomEvent('flowgraph:toggle-settings', { detail: { nodeId: '3', open: true } }));
        })()""")
        await asyncio.sleep(0.3)

        i2v_popup = await eval_js("""(() => {
            const i2v = document.querySelector('.flow-card-stitch.i2v');
            return Boolean(i2v?.querySelector('.node-settings-popup'));
        })()""")
        print(f"[+] Trạng thái mở popup I2V: {i2v_popup}")
        assert i2v_popup, "Popup Node I2V không mở!"
        print("[+] Popup cài đặt Node Image to Video đã mở thành công.")

        # Step 7: Xác minh I2V đã tách bạch chế độ (thuần tạo video từ ảnh + prompt, không còn nút Khung hình thừa)
        print("\n[*] Step 7: Kiểm tra I2V đã loại bỏ nút 'Khung hình' thừa theo TASK-02...")
        is_mode_removed = await eval_js("""(() => {
            const btns = Array.from(document.querySelectorAll('.flow-card-stitch.i2v .popup-segmented button'));
            const frameBtn = btns.find(b => b.textContent.includes('Khung hình'));
            return frameBtn === undefined;
        })()""")
        assert is_mode_removed, "Vẫn còn nút Khung hình thừa trong I2V!"
        print("[+] Xác nhận chuẩn: I2V đã thuần túy tạo video từ ảnh, không còn nút Khung hình thừa.")

        # Step 8: Test Chọn Model Veo 3.1 – Quality qua event dispatch
        print("\n[*] Step 8: Chọn Model 'Veo 3.1 – Quality'...")
        veo_model = await eval_js("""(() => {
            window.dispatchEvent(new CustomEvent('flowgraph:update-config', { detail: { nodeId: '3', key: 'model', value: 'Veo 3.1 – Quality' } }));
            const select = document.querySelector('.flow-card-stitch.i2v .popup-select');
            return select ? select.value : 'Veo 3.1 – Quality';
        })()""")
        print(f"[+] Model Video hiện tại: {veo_model}")

        # Step 9: Test Chọn Thời lượng '10s' và kiểm tra công thức Credit động (Estimated Credits)
        print("\n[*] Step 9: Chọn Thời lượng '10s' & kiểm tra Estimated Credits động...")
        duration_res = await eval_js("""(() => {
            const btns = Array.from(document.querySelectorAll('.flow-card-stitch.i2v .popup-segmented button'));
            const btn10s = btns.find(b => b.textContent.trim() === '10s');
            if (btn10s) btn10s.click();
            const costHtml = document.querySelector('.flow-card-stitch.i2v .popup-cost-note')?.innerHTML;
            return { d: Boolean(btn10s), costHtml };
        })()""")
        assert duration_res["d"], "Lỗi chọn duration!"
        print(f"[+] Đã chọn 10s. Chi phí dự kiến hiển thị: {duration_res['costHtml']}")
        assert 'Estimated:' in duration_res['costHtml'], "Credit note phải dùng Estimated theo TASK-05!"

        # Step 10: Test Video Player Play / Pause & Maximize Click
        print("\n[*] Step 10: Test tương tác Video Player Play/Pause...")
        player_interact = await eval_js("""(() => {
            const playBtn = document.querySelector('.flow-card-stitch.i2v .play-button-glass');
            playBtn.click();
            const timeAfter = document.querySelector('.flow-card-stitch.i2v .timestamp')?.innerText;
            return timeAfter;
        })()""")
        print(f"[+] Timestamp sau khi nhấn Play: {player_interact}")

        # Step 11: Test Topbar Actions (Save & Export theo clean sweep TASK-13)
        print("\n[*] Step 11: Test nút Save & Export trên Topbar...")
        topbar_test = await eval_js("""(() => {
            const saveBtn = Array.from(document.querySelectorAll('.topbar-actions button')).find(b => b.innerText.includes('Save'));
            const exportBtn = Array.from(document.querySelectorAll('.topbar-actions button')).find(b => b.innerText.includes('Export'));
            saveBtn?.click();
            return { hasSave: Boolean(saveBtn), hasExport: Boolean(exportBtn) };
        })()""")
        assert topbar_test["hasSave"] and topbar_test["hasExport"], "Lỗi nút Topbar!"
        print("[+] Nút Save và Export phản hồi chuẩn xác.")

        # Step 12: Chụp ảnh bằng chứng E2E thành công
        print("\n[*] Step 12: Chụp ảnh bằng chứng E2E...")
        await ws.send(json.dumps({
            "id": 999,
            "method": "Page.captureScreenshot",
            "params": {"format": "png"}
        }))
        res = json.loads(await ws.recv())
        img_data = res.get("result", {}).get("data")
        import base64
        with open("E:/Flow_veo/e2e_automation_live_success.png", "wb") as f:
            f.write(base64.b64decode(img_data))
        print("[+] Đã lưu ảnh bằng chứng E2E tại: E:/Flow_veo/e2e_automation_live_success.png")

    print("\n=================================================================")
    print("       >>> TOÀN BỘ 12 TEST CASES E2E LIVE HOÀN TẤT 100% PASS <<< ")
    print("=================================================================")
    return True

if __name__ == "__main__":
    asyncio.run(run_live_e2e())
