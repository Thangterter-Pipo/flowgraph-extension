import asyncio
import json
import urllib.request
import base64
import websockets

async def setup_scene_interpolation_canvas():
    print("==========================================================================")
    print("   THIẾT LẬP LUỒNG TẠO CẢNH CHUYÊN NGHIỆP (START - END FRAME SCENE)      ")
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

        setup_js = """(() => {
            const rawProj = localStorage.getItem('flowgraph.activeProject');
            const projectId = rawProj ? JSON.parse(rawProj).projectId : 'a412e256-8534-43c7-bfb9-71f15a2944df';

            // Cấu trúc luồng TẠO CẢNH (Scene Creation via Keyframes):
            // 1. Frame A (Start Frame): Siêu xe cyberpunk dừng ở vạch xuất phát
            // 2. Frame B (End Frame): Siêu xe cyberpunk tăng tốc xé gió qua vạch đích
            // 3. Prompt (Motion Prompt): Miêu tả quá trình chuyển động giữa 2 mốc
            // 4. Node Start - End Frame (TẠO CẢNH): Nội suy chuyển động mượt mà
            // 5. Final Video: Xem trước và xuất cảnh hoàn chỉnh
            const nodes = [
                {
                    id: 'frame-start',
                    type: 'flowNode',
                    position: { x: 80, y: 80 },
                    data: {
                        kind: 'uploadImage',
                        title: 'Khung Đầu (Start Frame)',
                        tone: 'blue',
                        status: 'success',
                        config: { source: 'cyber-car-start.png' },
                        result: {
                            type: 'image',
                            mediaId: 'c7016448-77fe-4637-9766-2c9df86bd89a',
                            previewUrl: 'https://flow-content.google/image/c7016448-77fe-4637-9766-2c9df86bd89a'
                        }
                    }
                },
                {
                    id: 'motion-prompt',
                    type: 'flowNode',
                    position: { x: 80, y: 390 },
                    data: {
                        kind: 'prompt',
                        title: 'Mô Tả Cảnh (Scene Prompt)',
                        tone: 'purple',
                        status: 'success',
                        config: { prompt: 'The cyber sports car launches forward with intense neon exhaust flames, tearing down the wet street.' }
                    }
                },
                {
                    id: 'frame-end',
                    type: 'flowNode',
                    position: { x: 80, y: 700 },
                    data: {
                        kind: 'uploadImage',
                        title: 'Khung Cuối (End Frame)',
                        tone: 'blue',
                        status: 'success',
                        config: { source: 'cyber-car-finish.png' },
                        result: {
                            type: 'image',
                            mediaId: 'c48a0390-a96c-4452-a9ad-d96d3f0ef8ac',
                            previewUrl: 'https://flow-content.google/image/c48a0390-a96c-4452-a9ad-d96d3f0ef8ac'
                        }
                    }
                },
                {
                    id: 'scene-interpolation',
                    type: 'flowNode',
                    position: { x: 540, y: 360 },
                    data: {
                        kind: 'interpolation',
                        title: 'Tạo Cảnh (Start - End Frame)',
                        tone: 'green',
                        status: 'ready',
                        config: {
                            model: 'Omni 1.1 Flash',
                            duration: '8 seconds',
                            resolution: '720p',
                            aspectRatio: '16:9',
                            batchCount: '1',
                            costCredits: '12'
                        }
                    }
                },
                {
                    id: 'final-scene-video',
                    type: 'flowNode',
                    position: { x: 960, y: 360 },
                    data: {
                        kind: 'download',
                        title: 'Cảnh Hoàn Chỉnh (Final Scene)',
                        tone: 'blue',
                        status: 'ready',
                        config: {
                            fileName: 'scene-01-cyber-drift.mp4',
                            autoDownload: 'false'
                        }
                    }
                }
            ];

            const edges = [
                // Dây 1: Khung Đầu -> Cổng Start của Node Tạo Cảnh
                {
                    id: 'edge-start-frame',
                    source: 'frame-start',
                    sourceHandle: 'image',
                    target: 'scene-interpolation',
                    targetHandle: 'startImage',
                    type: 'default',
                    style: { stroke: '#0ea5e9', strokeWidth: 2.6 }
                },
                // Dây 2: Motion Prompt -> Cổng Prompt của Node Tạo Cảnh
                {
                    id: 'edge-prompt',
                    source: 'motion-prompt',
                    sourceHandle: 'prompt',
                    target: 'scene-interpolation',
                    targetHandle: 'prompt',
                    type: 'default',
                    style: { stroke: '#a855f7', strokeWidth: 2.6 }
                },
                // Dây 3: Khung Cuối -> Cổng End của Node Tạo Cảnh
                {
                    id: 'edge-end-frame',
                    source: 'frame-end',
                    sourceHandle: 'image',
                    target: 'scene-interpolation',
                    targetHandle: 'endImage',
                    type: 'default',
                    style: { stroke: '#0ea5e9', strokeWidth: 2.6 }
                },
                // Dây 4: Video Tạo Cảnh -> Cổng Media của Final Video
                {
                    id: 'edge-final-scene',
                    source: 'scene-interpolation',
                    sourceHandle: 'video',
                    target: 'final-scene-video',
                    targetHandle: 'media',
                    type: 'default',
                    style: { stroke: '#10b981', strokeWidth: 2.6 }
                }
            ];

            const key = `flowgraph.workflow.v1.${projectId}.main`;
            const payload = {
                schemaVersion: 4,
                workflowId: 'main',
                name: '🎬 Quy Trình Tạo Cảnh Điện Ảnh (Scene Interpolation)',
                savedAt: new Date().toISOString(),
                nodes,
                edges,
                projectBinding: { projectId, projectName: 'Scene Creation Pipeline' }
            };
            localStorage.setItem(key, JSON.stringify(payload));
            return 'Đã thiết lập luồng Tạo Cảnh với Start-End Frame thành công!';
        })()"""

        res = await eval_js(setup_js)
        print("[+]", res)

        # Reload studio
        print("[*] Đang reload lại Studio...")
        await ws.send(json.dumps({'id': 991, 'method': 'Page.reload'}))
        await ws.recv()

    await asyncio.sleep(2.5)

    with urllib.request.urlopen("http://127.0.0.1:9222/json") as r:
        tabs = json.loads(r.read().decode())
    studio = next(t for t in tabs if "studio.html" in t.get("url", ""))

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

        # Fit view
        await eval_js_after("document.querySelectorAll('.canvas-toolbar button')[0]?.click()")
        await asyncio.sleep(0.6)

        # Chụp ảnh luồng tạo cảnh
        await ws.send(json.dumps({"id": 99991, "method": "Page.captureScreenshot", "params": {"format": "png"}}))
        res = json.loads(await ws.recv())
        with open("E:/Flow_veo/studio_scene_creation_verified.png", "wb") as f:
            f.write(base64.b64decode(res.get("result", {}).get("data")))
        print("[+] Đã chụp ảnh luồng Tạo Cảnh hoàn chỉnh: E:/Flow_veo/studio_scene_creation_verified.png")

if __name__ == "__main__":
    asyncio.run(setup_scene_interpolation_canvas())
