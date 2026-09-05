import importlib.util, json, time, sys

spec = importlib.util.spec_from_file_location('cdp', 'E:/Flow_veo/_ctl/cdp_tool.py')
cdp = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cdp)

flow_target = cdp.find('studio.html')
s = cdp.Session(flow_target, timeout=600)
s.cmd('Runtime.enable')

run_id = sys.argv[1]
workflow_type = sys.argv[2] # "IMAGE_WORKFLOW" or "VIDEO_WORKFLOW"
media_id = sys.argv[3]
media_type = sys.argv[4] # "IMAGE" or "VIDEO"

print(f"[{run_id}] Bắt đầu Live Utility Workflow...")
print(f"[{run_id}] Workflow: {workflow_type}")
print(f"[{run_id}] Input Media ID: {media_id}")
print(f"[{run_id}] Media Type: {media_type}")

PROJECT_ID = '729eaa19-1c85-4cfc-89c3-5f86de2dffc5'

# Build nodes & edges
input_node_kind = 'imageInput' if media_type == 'IMAGE' else 'videoInput'
output_port = 'image' if media_type == 'IMAGE' else 'video'

nodes = [
    {
        'id': '1',
        'kind': input_node_kind,
        'inputs': [],
        'outputs': [{'id': output_port, 'label': output_port.capitalize(), 'type': media_type}],
        'config': {
            'mediaId': media_id,
            'mediaType': media_type,
            'projectId': PROJECT_ID,
        }
    },
    {
        'id': '2',
        'kind': 'preview',
        'inputs': [{'id': 'media', 'label': 'Media', 'type': 'MEDIA', 'required': True}],
        'outputs': [{'id': 'media', 'label': 'Media', 'type': 'MEDIA'}],
        'config': {}
    },
    {
        'id': '3',
        'kind': 'download',
        'inputs': [{'id': 'media', 'label': 'Media', 'type': 'MEDIA', 'required': True}],
        'outputs': [{'id': 'file', 'label': 'File', 'type': 'FILE'}],
        'config': {
            'fileName': f'flowgraph-live-utility-{media_type.lower()}-{media_id[:8]}'
        }
    }
]

edges = [
    {
        'id': 'e1-2',
        'source': '1',
        'sourceHandle': output_port,
        'target': '2',
        'targetHandle': 'media'
    },
    {
        'id': 'e2-3',
        'source': '2',
        'sourceHandle': 'media',
        'target': '3',
        'targetHandle': 'media'
    }
]

js = f'''
(async () => {{
  // Get or instantiate WorkflowRuntime directly in the studio context
  let runtime = window.studioRuntime;
  if (!runtime) {{
    // Trigger canvas interaction to initialize runtime
    const runBtn = document.querySelector('button.run-button') || document.querySelector('button');
    runtime = window.studioRuntime;
  }}

  // Fallback: use module imports available in studio bundle or instantiate directly
  if (!runtime) {{
    return {{ __error: 'studioRuntime not initialized yet on studio window' }};
  }}

  const activeProject = {{ projectId: '{PROJECT_ID}' }};
  const events = [];
  const emit = (e) => events.push(e);

  const start = Date.now();
  try {{
    await runtime.run({json.dumps(nodes)}, {json.dumps(edges)}, {{ activeProject, bypassCache: true }}, emit);
    return {{
      ok: true,
      duration_ms: Date.now() - start,
      events
    }};
  }} catch (err) {{
    return {{
      ok: false,
      duration_ms: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
      code: err.code || 'UNKNOWN',
      events
    }};
  }}
}})()
'''

print(f"[*] Executing live utility workflow via Studio Canvas...")
out = s.eval(js, await_promise=True)
s.close()
print("\n[=== KẾT QUẢ RUNTIME TRẢ VỀ ===]\n")
print(json.dumps(out, indent=2))
