// Load a Prompt -> T2V -> Download workflow into the Studio canvas using the
// app's own persistence mechanism (localStorage 'flowgraph.demo.workflow') and
// then reload the Studio page so restoreSavedNodes/Edges hydrate it.
// This does NOT touch production code. It backs up the existing workflow first.

const CDP = 'http://127.0.0.1:9224';
const STUDIO_PAGE = 'chrome-extension://doibgbebcgbecadimjcclbbhpaodijdp/studio.html';

async function listPages() {
  return await fetch(`${CDP}/json/list`).then((r) => r.json());
}

async function findTab(needle) {
  const pages = await listPages();
  return pages.find((x) => x.type === 'page' && (x.url || '').includes(needle));
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function connect(url) {
  const ws = new WebSocket(url);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', rej, { once: true });
  });
  return ws;
}

async function cdp(ws, method, params = {}) {
  const id = Math.floor(Math.random() * 1e9);
  ws.send(JSON.stringify({ id, method, params }));
  return await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), 20000);
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id === id) {
        clearTimeout(t);
        resolve(m.result ?? m);
      }
    });
  });
}

async function evalv(ws, expression) {
  const r = await cdp(ws, 'Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  return r?.result?.value;
}

async function main() {
  const tab = await findTab(STUDIO_PAGE);
  if (!tab) {
    console.error('STUDIO_NOT_FOUND');
    process.exit(2);
  }
  const ws = await connect(tab.webSocketDebuggerUrl);

  // 1. Back up the current saved workflow (V1) if present.
  const backup = await evalv(ws, `(() => {
    const raw = localStorage.getItem('flowgraph.demo.workflow');
    if (!raw) return { backedUp: false };
    localStorage.setItem('flowgraph.demo.workflow.v1backup', raw);
    const w = JSON.parse(raw);
    return { backedUp: true, name: w.name, nodeCount: (w.nodes||[]).length, edgeCount: (w.edges||[]).length };
  })()`);
  console.log('BACKUP', JSON.stringify(backup));

  // 2. Write the T2V workflow. Schema v3. Node data mirrors hydrateNodeData
  //    for the t2v palette spec. Edges connect Prompt(prompt)->T2V(prompt)
  //    and T2V(video)->Download(media).
  const workflow = {
    schemaVersion: 3,
    name: 'FlowGraph T2V Probe',
    savedAt: new Date().toISOString(),
    projectBinding: { projectId: '23e7d6d8-d0bc-441b-b720-e63b0ffa9d32', projectName: 'Flow project' },
    nodes: [
      {
        id: 'p1',
        type: 'flowNode',
        position: { x: 60, y: 120 },
        data: {
          title: 'Prompt',
          kind: 'prompt',
          subtitle: 'Create text prompts',
          tone: 'purple',
          status: 'idle',
          config: { prompt: 'A cinematic aerial dolly shot over a neon city at night, rain reflections, dramatic clouds, photorealistic, 4K.' },
          maturity: 'RUNTIME_VERIFIED',
          capabilityLabel: 'Prompt',
          capabilitySummary: 'Text prompt input',
        },
      },
      {
        id: 't2v',
        type: 'flowNode',
        position: { x: 340, y: 120 },
        data: {
          title: 'Text to Video',
          kind: 't2v',
          subtitle: 'Veo 3.1 / Omni 1.1 Flash',
          tone: 'green',
          status: 'idle',
          config: {
            model: 'Veo 3.1 - Fast',
            serviceTier: 'SERVICE_TIER_INTERMEDIATE',
            aspectRatio: '16:9 (Landscape)',
            duration: '8 seconds',
            resolution: '720p',
            frameRate: '24 fps',
            nativeAudio: 'Enabled',
            estimatedCredits: '15 credits',
          },
          maturity: 'RUNTIME_PARTIAL',
          capabilityLabel: 'Text to Video',
          capabilitySummary: 'Generate video from text prompt',
          isNew: true,
          preview: 'video',
        },
      },
      {
        id: 'dl',
        type: 'flowNode',
        position: { x: 620, y: 120 },
        data: {
          title: 'Download',
          kind: 'download',
          subtitle: 'Export generated media',
          tone: 'blue',
          status: 'idle',
          config: { format: 'Original media', fileName: 'flowgraph-output' },
          maturity: 'RUNTIME_VERIFIED',
          capabilityLabel: 'Download',
          capabilitySummary: 'Export generated media',
        },
      },
    ],
    edges: [
      { id: 'e-p-t', source: 'p1', sourceHandle: 'prompt', target: 't2v', targetHandle: 'prompt', type: 'smoothstep', animated: false, style: { stroke: '#9a52f8' } },
      { id: 'e-t-d', source: 't2v', sourceHandle: 'video', target: 'dl', targetHandle: 'media', type: 'smoothstep', animated: false, style: { stroke: '#3ad39c' } },
    ],
  };

  const setResult = await evalv(ws, `(() => {
    localStorage.setItem('flowgraph.demo.workflow', ${JSON.stringify(JSON.stringify(workflow))});
    return { ok: true };
  })()`);
  console.log('SET', JSON.stringify(setResult));
  ws.close();

  // 3. Reload Studio so restoreSavedNodes/Edges pick up the new workflow.
  const tab2 = await findTab(STUDIO_PAGE);
  if (!tab2) {
    console.error('STUDIO_NOT_FOUND_RELOAD');
    process.exit(3);
  }
  const ws2 = await connect(tab2.webSocketDebuggerUrl);
  await cdp(ws2, 'Page.reload', { ignoreCache: false });
  await sleep(2500);
  ws2.close();
  console.log('RELOADED');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
