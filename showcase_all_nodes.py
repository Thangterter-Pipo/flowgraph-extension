import asyncio
import json
import urllib.request
import websockets

async def showcase_all_nodes():
    print("==========================================================================")
    print("   BIỂU DIỄN & BÀY TRÍ TẤT CẢ CÁC LOẠI NODE TRÊN CANVAS STUDIO EXTENSION   ")
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

        # Nạp tất cả các node đại diện tiêu biểu lên Canvas thành các luồng chuyên biệt
        print("[*] Đang khởi tạo và bố trí 9 loại Node đại diện cho 4 chuyên đề lên Canvas...")
        setup_js = """(() => {
            const rawProj = localStorage.getItem('flowgraph.activeProject');
            const projectId = rawProj ? JSON.parse(rawProj).projectId : 'a412e256-8534-43c7-bfb9-71f15a2944df';

            const showcaseNodes = [
                // --- HÀNG 1: LUỒNG TẠO VIDEO TRUYỀN THỐNG (T2I -> I2V) ---
                {
                    id: 'node-prompt-1',
                    type: 'flowNode',
                    position: { x: 50, y: 50 },
                    data: {
                        kind: 'prompt',
                        title: 'Prompt',
                        tone: 'purple',
                        status: 'success',
                        config: { prompt: 'A futuristic cybernetic tiger prowling in a dark neon rain forest.' }
                    }
                },
                {
                    id: 'node-gemini',
                    type: 'flowNode',
                    position: { x: 420, y: 50 },
                    data: {
                        kind: 'gemini',
                        title: 'Gemini Enhance',
                        tone: 'purple',
                        status: 'success',
                        config: { model: 'Gemini 2.5 Pro', style: 'Cinematic High-Tech' }
                    }
                },
                {
                    id: 'node-t2i',
                    type: 'flowNode',
                    position: { x: 790, y: 50 },
                    data: {
                        kind: 't2i',
                        title: 'Text to Image',
                        tone: 'blue',
                        status: 'success',
                        config: { model: '🍌 Nano Banana 2', aspectRatio: '16:9', batchCount: '1' }
                    }
                },
                {
                    id: 'node-upscale-img',
                    type: 'flowNode',
                    position: { x: 1160, y: 50 },
                    data: {
                        kind: 'imageUpscale',
                        title: 'Image Upscale',
                        tone: 'orange',
                        status: 'ready',
                        config: { model: '4K', targetResolution: '4K' }
                    }
                },

                // --- HÀNG 2: LUỒNG VIDEO NÂNG CAO (Nội suy Start-End Frame, Extend & Video Upscale) ---
                {
                    id: 'node-upload-start',
                    type: 'flowNode',
                    position: { x: 50, y: 440 },
                    data: {
                        kind: 'uploadImage',
                        title: 'Upload Image (Start)',
                        tone: 'blue',
                        status: 'success',
                        config: { source: 'Local Frame A.png', format: 'PNG' }
                    }
                },
                {
                    id: 'node-upload-end',
                    type: 'flowNode',
                    position: { x: 50, y: 680 },
                    data: {
                        kind: 'uploadImage',
                        title: 'Upload Image (End)',
                        tone: 'blue',
                        status: 'success',
                        config: { source: 'Local Frame B.png', format: 'PNG' }
                    }
                },
                {
                    id: 'node-interp',
                    type: 'flowNode',
                    position: { x: 420, y: 540 },
                    data: {
                        kind: 'interpolation',
                        title: 'Start - End Frame',
                        tone: 'green',
                        status: 'ready',
                        config: { model: 'Omni 1.1 Flash', duration: '8 seconds', aspectRatio: '16:9', resolution: '720p', batchCount: '1' }
                    }
                },
                {
                    id: 'node-extend',
                    type: 'flowNode',
                    position: { x: 790, y: 540 },
                    data: {
                        kind: 'extend',
                        title: 'Extend / Edit Video',
                        tone: 'orange',
                        status: 'ready',
                        config: { model: 'Veo 3.1 - Fast', mode: 'Extend Forward', duration: '8 seconds', resolution: '720p' }
                    }
                },
                {
                    id: 'node-video-upscale',
                    type: 'flowNode',
                    position: { x: 1160, y: 540 },
                    data: {
                        kind: 'videoUpscale',
                        title: 'Video Upscale',
                        tone: 'orange',
                        status: 'ready',
                        config: { model: 'Veo 3.1 - Upsampler 1080P', targetResolution: '1080p' }
                    }
                },
                {
                    id: 'node-final-dl',
                    type: 'flowNode',
                    position: { x: 1530, y: 540 },
                    data: {
                        kind: 'download',
                        title: 'Final Video',
                        tone: 'blue',
                        status: 'ready',
                        config: { fileName: 'master-cyber-scene.mp4', autoDownload: 'false' }
                    }
                }
            ];

            const showcaseEdges = [
                { id: 'se-1', source: 'node-prompt-1', sourceHandle: 'prompt', target: 'node-gemini', targetHandle: 'prompt', type: 'default', style: { stroke: '#a855f7' } },
                { id: 'se-2', source: 'node-gemini', sourceHandle: 'prompt', target: 'node-t2i', targetHandle: 'prompt', type: 'default', style: { stroke: '#a855f7' } },
                { id: 'se-3', source: 'node-t2i', sourceHandle: 'image', target: 'node-upscale-img', targetHandle: 'media', type: 'default', style: { stroke: '#0ea5e9' } },
                
                { id: 'se-4', source: 'node-upload-start', sourceHandle: 'image', target: 'node-interp', targetHandle: 'startImage', type: 'default', style: { stroke: '#0ea5e9' } },
                { id: 'se-5', source: 'node-upload-end', sourceHandle: 'image', target: 'node-interp', targetHandle: 'endImage', type: 'default', style: { stroke: '#0ea5e9' } },
                { id: 'se-6', source: 'node-interp', sourceHandle: 'video', target: 'node-extend', targetHandle: 'video', type: 'default', style: { stroke: '#10b981' } },
                { id: 'se-7', source: 'node-extend', sourceHandle: 'video', target: 'node-video-upscale', targetHandle: 'media', type: 'default', style: { stroke: '#10b981' } },
                { id: 'se-8', source: 'node-video-upscale', sourceHandle: 'media', target: 'node-final-dl', targetHandle: 'media', type: 'default', style: { stroke: '#38bdf8' } }
            ];

            // Lưu vào project localStorage
            const key = `flowgraph.workflow.v1.${projectId}.main`;
            const payload = {
                schemaVersion: 4,
                workflowId: 'main',
                name: 'Full Studio Multi-Node Architecture',
                savedAt: new Date().toISOString(),
                nodes: showcaseNodes,
                edges: showcaseEdges,
                projectBinding: { projectId, projectName: 'Full Showcase' }
            };
            localStorage.setItem(key, JSON.stringify(payload));
            return 'Saved showcase graph with ' + showcaseNodes.length + ' nodes and ' + showcaseEdges.length + ' edges.';
        })()"""

        res = await eval_js(setup_js)
        print("[+]", res)

        # 2. Reload Studio để load lại đồ thị trọn vẹn
        print("[*] Đang reload lại Studio Canvas để nạp toàn bộ các node mới...")
        await ws.send(json.dumps({'id': 991, 'method': 'Page.reload'}))
        await ws.recv()

    await asyncio.sleep(2.5)

    # 3. Kết nối lại để Fit View và chụp ảnh màn hình
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

        # Căn chỉnh view cho vừa toàn bộ canvas (Fit View)
        await eval_js_after("""(() => {
            const fitBtn = document.querySelectorAll('.canvas-toolbar button')[0];
            fitBtn?.click();
            return 'Fit view triggered';
        })()""")
        await asyncio.sleep(0.8)

        # Chụp ảnh toàn cảnh Canvas biểu diễn các Node
        await ws.send(json.dumps({
            "id": 9999,
            "method": "Page.captureScreenshot",
            "params": {"format": "png"}
        }))
        res = json.loads(await ws.recv())
        import base64
        with open("E:/Flow_veo/studio_full_nodes_showcase.png", "wb") as f:
            f.write(base64.b64decode(res.get("result", {}).get("data")))
        print("\n[+] Đã xuất ảnh chụp màn hình toàn cảnh Canvas: E:/Flow_veo/studio_full_nodes_showcase.png")

if __name__ == "__main__":
    asyncio.run(showcase_all_nodes())
