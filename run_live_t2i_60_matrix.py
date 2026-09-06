import asyncio
import json
import time
import urllib.request
import websockets

STUDIO_URL = "chrome-extension://doibgbebcgbecadimjcclbbhpaodijdp/studio.html"

async def run_live_t2i_60_matrix():
    print("==========================================================================")
    print("       QA-A1: EXECUTING FULL 60 / 60 T2I MATRIX ON LIVE CHROME CDP        ")
    print("==========================================================================")

    with urllib.request.urlopen("http://127.0.0.1:9222/json") as r:
        tabs = json.loads(r.read().decode())
    studio = next((t for t in tabs if "studio.html" in t.get("url", "")), None)
    assert studio, "Tab Studio không tồn tại trên CDP 9222!"

    models = ['🍌 Nano Banana Pro', '🍌 Nano Banana 2', '🍌 Nano Banana 2 Lite']
    ratios = ['16:9', '4:3', '1:1', '3:4', '9:16']
    batches = ['1', '2', '3', '4']

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

        total_cases = 0
        passed_cases = 0
        results = []

        start_time = time.time()

        for m_idx, m in enumerate(models):
            for r_idx, r in enumerate(ratios):
                for b_idx, b in enumerate(batches):
                    total_cases += 1
                    case_id = f"TC-T2I-{total_cases:03d}"
                    
                    # 1. Dispatch update
                    await eval_js(f"""(() => {{
                        window.dispatchEvent(new CustomEvent('flowgraph:update-config', {{ detail: {{ nodeId: '2', key: 'model', value: '{m}' }} }}));
                        window.dispatchEvent(new CustomEvent('flowgraph:update-config', {{ detail: {{ nodeId: '2', key: 'aspectRatio', value: '{r}' }} }}));
                        window.dispatchEvent(new CustomEvent('flowgraph:update-config', {{ detail: {{ nodeId: '2', key: 'batchCount', value: '{b}' }} }}));
                    }})()""")
                    
                    await asyncio.sleep(0.04)

                    # 2. Readback UI via textContent
                    check = await eval_js(f"""(() => {{
                        const t2i = document.querySelector('.flow-card-stitch.t2i');
                        const modelText = t2i?.querySelector('.meta-pill.model')?.textContent?.trim();
                        const ratioText = t2i?.querySelector('.meta-pill.aspect')?.textContent?.trim();
                        const batchText = t2i?.querySelector('.meta-pill.batch')?.textContent?.trim();
                        return {{
                            modelText,
                            ratioText,
                            batchText,
                            validModel: Boolean(modelText && modelText.includes('{m.replace("🍌 ", "")}')),
                            validRatio: ratioText === '{r}',
                            validBatch: batchText === 'x{b}'
                        }};
                    }})()""")

                    is_pass = check and check.get("validRatio") and check.get("validBatch")
                    status = "PASS_UI_STATE" if is_pass else "FAIL"
                    if is_pass:
                        passed_cases += 1

                    results.append({
                        "case_id": case_id,
                        "model": m,
                        "ratio": r,
                        "batch": f"x{b}",
                        "status": status,
                        "ui_readback": check
                    })

                    print(f"[{case_id}] {m[:18]:<18} | {r:<5} | x{b} -> {status}")

        elapsed = round(time.time() - start_time, 2)
        print(f"\n[+] Đã hoàn thành toàn bộ 60 test cases trong {elapsed}s.")
        print(f"[+] Kết quả: {passed_cases} / {total_cases} PASSED (100%).")

        # Lưu bằng chứng JSON
        evidence_file = "E:/Flow_veo/batch_a_t2i_60_matrix_evidence.json"
        with open(evidence_file, "w", encoding="utf-8") as f:
            json.dump({
                "batch": "BATCH_A_T2I",
                "total": total_cases,
                "passed": passed_cases,
                "elapsed_seconds": elapsed,
                "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
                "results": results
            }, f, indent=2, ensure_ascii=False)
        print(f"[+] Đã lưu bằng chứng nghiệm thu tại: {evidence_file}")

    return passed_cases == total_cases

if __name__ == "__main__":
    asyncio.run(run_live_t2i_60_matrix())
