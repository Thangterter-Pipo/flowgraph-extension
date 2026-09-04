# -*- coding: utf-8 -*-
"""
Automated runner for Scenes 1-11 on Google Flow using CDP Trusted Input Gesture & Reactivity Unlock.
"""
import asyncio
import json
import time
import urllib.request
import websockets

SCENES = [
    {
        "num": 1,
        "name": "Cảnh 1 — Purée vàng",
        "prompt": "Photorealistic cinematic absurd comedy, luxury fine-dining restaurant. A large black ceramic plate with a thin gold rim sits on a white tablecloth, identical composition throughout the entire sequence. A bizarre humanoid character representing golden potato purée stands beside the plate. The character suddenly turns its back toward the plate, bends slightly, and forcefully launches a thick stream of golden purée-like food from behind toward the center of the plate. The material lands dramatically and spreads into a smooth elegant golden purée base. Funny exaggerated physical reaction, but no graphic anatomy, no visible feces. Static camera, 3/4 low angle, warm restaurant lighting, shallow depth of field, realistic food physics, 4K."
    },
    {
        "num": 2,
        "name": "Cảnh 2 — Ức vịt",
        "prompt": "Continue directly from the previous shot, identical plate, camera angle, lighting and restaurant background. The golden purée is already on the plate. A humanoid character representing roasted duck breast stands beside the plate. It turns its back toward the plate and forcefully launches several pieces of food-like material toward the plate. In mid-air, the pieces magically transform into beautifully seared duck breast slices with crispy golden-brown skin and a pink center. They land neatly on top of the purée in an elegant row. Absurd slapstick comedy, photorealistic food, no graphic anatomy, no visible feces, cinematic slow motion, 4K."
    },
    {
        "num": 3,
        "name": "Cảnh 3 — Nấm rừng",
        "prompt": "Seamless continuation, everything from previous shot remains unchanged. A humanoid character representing wild mushrooms stands next to the completed duck dish. It turns its back toward the plate and suddenly launches a powerful burst of mushroom-like food material. The flying pieces magically transform into sautéed golden-brown wild mushrooms and land naturally on the left side of the duck. Funny absurd restaurant scene, elegant Michelin-style plating, realistic food texture, no graphic anatomy, no visible feces, fixed camera, warm cinematic lighting."
    },
    {
        "num": 4,
        "name": "Cảnh 4 — Măng tây",
        "prompt": "Seamless continuation of the exact same restaurant scene. A humanoid character representing fresh green asparagus stands beside the plate, turns its back toward the dish and forcefully launches asparagus-like food material. During the flight, it transforms into beautifully grilled green asparagus spears. The asparagus lands beside the mushrooms in a precise fine-dining arrangement. Photorealistic, absurd comedy, elegant plating, realistic physics, fixed camera, 4K."
    },
    {
        "num": 5,
        "name": "Cảnh 5 — Cà rốt baby",
        "prompt": "Continue seamlessly with the exact same plate and all previous ingredients preserved. A humanoid character representing baby carrots stands beside the plate, turns its back toward the dish and launches a burst of orange food material. The material transforms mid-air into glossy roasted baby carrots and lands behind the duck breast, adding height and color to the composition. Cinematic absurd humor, realistic food, luxury restaurant atmosphere, no graphic anatomy, no visible feces."
    },
    {
        "num": 6,
        "name": "Cảnh 6 — Củ dền",
        "prompt": "Exact continuation, same camera, same plate, same lighting. A humanoid character representing beetroot turns its back toward the plate and forcefully launches beetroot-colored food material. It magically transforms in mid-air into small glossy roasted beetroot pieces. The pieces land elegantly among the carrots and asparagus. Photorealistic fine dining, absurd slapstick comedy, realistic food physics, cinematic 4K."
    },
    {
        "num": 7,
        "name": "Cảnh 7 — Demi-glace",
        "prompt": "Seamless continuation. A humanoid character representing dark demi-glace sauce stands beside the completed dish. It turns its back toward the plate and launches a thick dark-brown stream of sauce-like material. The stream transforms into glossy demi-glace sauce before landing, then flows naturally around the purée and duck breast in beautiful artistic curves. High-end food commercial, macro food detail, realistic liquid physics, absurd comedy, no graphic anatomy."
    },
    {
        "num": 8,
        "name": "Cảnh 8 — Hành caramelized",
        "prompt": "Continue from the exact previous frame. A humanoid character representing caramelized onions turns its back toward the plate and forcefully launches small golden food-like objects. They transform in mid-air into beautifully caramelized pearl onions and land around the purée and sauce. The existing duck, mushrooms, asparagus, carrots and beetroot remain completely unchanged. Elegant Michelin-style plating combined with ridiculous absurd humor, photorealistic 4K."
    },
    {
        "num": 9,
        "name": "Cảnh 9 — Khoai tây giòn",
        "prompt": "Seamless continuation, identical composition. A humanoid character representing crispy roasted potatoes turns its back toward the plate and launches several golden food-like pieces. They magically transform into crispy golden roasted potato pieces and land beside the purée and vegetables. Extremely satisfying food impact, realistic crispy texture, cinematic slow motion, absurd comedy, luxury restaurant, fixed camera."
    },
    {
        "num": 10,
        "name": "Cảnh 10 — Lớp hoàn thiện",
        "prompt": "Final ingredient scene, exact same plate and composition. A humanoid character representing microgreens and edible flowers stands beside the finished dish. It turns its back toward the plate and makes one final exaggerated launch of tiny green and colorful food-like particles. In mid-air they magically transform into delicate microgreens and purple and yellow edible flowers. They gently rain down onto the sliced duck breast, completing the plating. Cinematic absurd comedy, elegant fine dining, photorealistic food, no graphic anatomy, no visible feces, 4K."
    },
    {
        "num": 11,
        "name": "Cảnh 11 — Hero shot",
        "prompt": "No humanoid character. The fully completed fine-dining dish is now sitting perfectly on the black ceramic plate with gold rim. Sliced medium-rare duck breast, golden purée, wild mushrooms, green asparagus, roasted baby carrots, beetroot, caramelized onions, crispy potatoes, glossy demi-glace and colorful microgreens with edible flowers. The camera slowly pushes toward the dish. Warm luxury restaurant in the background, wine glasses softly out of focus, beautiful cinematic bokeh, realistic steam, extremely appetizing food photography, premium Michelin-starred restaurant commercial, photorealistic, 4K, elegant and cinematic."
    }
]

async def get_flow_ws():
    req = urllib.request.urlopen('http://127.0.0.1:9224/json/list')
    tabs = json.loads(req.read().decode())
    flow_tab = next(t for t in tabs if 'flow' in t.get('url', '').lower() and 'project' in t.get('url', '').lower())
    return flow_tab['webSocketDebuggerUrl']

async def submit_scene_trusted(ws_url, scene_info, total_scenes):
    num = scene_info['num']
    name = scene_info['name']
    prompt = scene_info['prompt']

    print(f"\n==================================================")
    print(f"🚀 [{num}/{total_scenes}] ĐANG XỬ LÝ TRUSTED: {name}")
    print(f"==================================================")

    async with websockets.connect(ws_url) as ws:
        # Step 1: Ensure input box is focused & clicked
        expr_click_ed = '''(() => {
            const ed = document.querySelector('[contenteditable="true"]');
            if (ed) {
                const r = ed.getBoundingClientRect();
                return { x: Math.round(r.left + 20), y: Math.round(r.top + 20) };
            }
            return null;
        })()'''
        await ws.send(json.dumps({'id': 1, 'method': 'Runtime.evaluate', 'params': {'expression': expr_click_ed, 'returnByValue': True}}))
        res = json.loads(await ws.recv())
        pt = res.get('result', {}).get('result', {}).get('value')

        if pt:
            await ws.send(json.dumps({'id': 2, 'method': 'Input.dispatchMouseEvent', 'params': {'type': 'mousePressed', 'x': pt['x'], 'y': pt['y'], 'button': 'left', 'clickCount': 1}}))
            await ws.recv()
            await ws.send(json.dumps({'id': 3, 'method': 'Input.dispatchMouseEvent', 'params': {'type': 'mouseReleased', 'x': pt['x'], 'y': pt['y'], 'button': 'left', 'clickCount': 1}}))
            await ws.recv()
            await asyncio.sleep(0.2)

        # Step 2: Clear old text via Ctrl+A + Backspace
        await ws.send(json.dumps({'id': 4, 'method': 'Input.dispatchKeyEvent', 'params': {'type': 'keyDown', 'modifiers': 2, 'key': 'a', 'code': 'KeyA', 'windowsVirtualKeyCode': 65}}))
        await ws.recv()
        await ws.send(json.dumps({'id': 5, 'method': 'Input.dispatchKeyEvent', 'params': {'type': 'keyDown', 'key': 'Backspace', 'code': 'Backspace', 'windowsVirtualKeyCode': 8}}))
        await ws.recv()
        await ws.send(json.dumps({'id': 6, 'method': 'Input.dispatchKeyEvent', 'params': {'type': 'keyUp', 'key': 'Backspace', 'code': 'Backspace', 'windowsVirtualKeyCode': 8}}))
        await ws.recv()
        await asyncio.sleep(0.3)

        # Step 3: CDP Trusted insertText
        await ws.send(json.dumps({'id': 7, 'method': 'Input.insertText', 'params': {'text': prompt}}))
        await ws.recv()
        await asyncio.sleep(0.3)

        # Step 4: Reactivity Space key
        await ws.send(json.dumps({'id': 8, 'method': 'Input.dispatchKeyEvent', 'params': {'type': 'keyDown', 'key': ' ', 'code': 'Space', 'windowsVirtualKeyCode': 32}}))
        await ws.recv()
        await ws.send(json.dumps({'id': 9, 'method': 'Input.dispatchKeyEvent', 'params': {'type': 'keyUp', 'key': ' ', 'code': 'Space', 'windowsVirtualKeyCode': 32}}))
        await ws.recv()
        await asyncio.sleep(0.5)

        # Step 5: Locate arrow_forward / Generate button
        expr_btn = '''(() => {
            const buttons = [...document.querySelectorAll('button')];
            const arrow = buttons.find(b => (b.innerText || '').includes('arrow_forward') || (b.innerText || '').includes('add_2'));
            if (arrow) {
                const r = arrow.getBoundingClientRect();
                return { found: true, x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), ariaDisabled: arrow.getAttribute('aria-disabled') };
            }
            return { found: false };
        })()'''
        await ws.send(json.dumps({'id': 10, 'method': 'Runtime.evaluate', 'params': {'expression': expr_btn, 'returnByValue': True}}))
        res_btn = json.loads(await ws.recv())
        btn_info = res_btn.get('result', {}).get('result', {}).get('value', {})

        if btn_info.get('found'):
            x, y = btn_info['x'], btn_info['y']
            await ws.send(json.dumps({'id': 11, 'method': 'Input.dispatchMouseEvent', 'params': {'type': 'mouseMoved', 'x': x, 'y': y}}))
            await ws.recv()
            await ws.send(json.dumps({'id': 12, 'method': 'Input.dispatchMouseEvent', 'params': {'type': 'mousePressed', 'x': x, 'y': y, 'button': 'left', 'buttons': 1, 'clickCount': 1}}))
            await ws.recv()
            await asyncio.sleep(0.1)
            await ws.send(json.dumps({'id': 13, 'method': 'Input.dispatchMouseEvent', 'params': {'type': 'mouseReleased', 'x': x, 'y': y, 'button': 'left', 'buttons': 0, 'clickCount': 1}}))
            await ws.recv()
            print(f"✅ ĐÃ TẠO THÀNH CÔNG (TRUSTED) FOR {name}")
        else:
            print(f"⚠️ Nút Tạo không khả dụng hoặc đã tự động submit cho {name}")

async def main():
    ws_url = await get_flow_ws()
    print(f"🔗 Bắt đầu tiến trình Trusted Runner cho 11 Cảnh: {ws_url}")

    total = len(SCENES)
    for scene in SCENES:
        await submit_scene_trusted(ws_url, scene, total)
        print(f"⏳ Chờ 15s giữa các cảnh để Google Flow xử lý render...")
        await asyncio.sleep(15)

    print("\n🎉 HOÀN THÀNH TẤT CẢ 11 CẢNH BẰNG CDP TRUSTED GESTURE!")

if __name__ == '__main__':
    asyncio.run(main())
