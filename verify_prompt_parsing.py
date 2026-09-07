import asyncio
import json
import urllib.request
import websockets

async def verify_prompt_config_parser():
    print("==========================================================================")
    print("      KIỂM TRA TÍNH NĂNG: GÕ PROMPT TỰ ĐỘNG CHỈNH CẤU HÌNH NODE           ")
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

        # 1. Nhập prompt có chứa từ khóa cấu hình vào Prompt Node đầu tiên
        test_prompt = "A futuristic cyberpunk car drifting in the neon rain, 9:16 portrait, 8s, 4K, x2, Veo Lite"
        print(f"[*] 1. Nhập prompt: '{test_prompt}'")

        await call("Runtime.evaluate", {
            "expression": f"""(() => {{
                const textarea = document.querySelector('.prompt-textarea');
                if (!textarea) return 'Textarea not found';
                // Trigger react onChange
                const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
                nativeInputValueSetter.call(textarea, {json.dumps(test_prompt)});
                const ev = new Event('input', {{ bubbles: true }});
                textarea.dispatchEvent(ev);
                const evChange = new Event('change', {{ bubbles: true }});
                textarea.dispatchEvent(evChange);
                return 'Dispatched prompt input';
            }})()"""
        })

        await asyncio.sleep(1.2)

        # 2. Đọc lại cấu hình trên các node downstream xem có tự cập nhật không
        configs = await call("Runtime.evaluate", {
            "expression": """(() => {
                const cards = Array.from(document.querySelectorAll('.flow-card-stitch')).map(c => {
                    const title = c.querySelector('.card-title strong')?.innerText || c.querySelector('.card-title')?.innerText;
                    const comboboxes = Array.from(c.querySelectorAll('.custom-combobox')).map(cb => ({
                        label: cb.querySelector('.combobox-display-label')?.innerText
                    }));
                    return { title, comboboxes };
                });
                return cards;
            })()""",
            "returnByValue": True
        })

        res = configs.get("result", {}).get("result", {}).get("value")
        print("[+] Cấu hình các Node trên Canvas sau khi nhập prompt:")
        print(json.dumps(res, indent=2, ensure_ascii=False))

if __name__ == "__main__":
    asyncio.run(verify_prompt_config_parser())
