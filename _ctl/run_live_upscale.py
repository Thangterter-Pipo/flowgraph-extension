import importlib.util, json, time, sys

spec = importlib.util.spec_from_file_location('cdp', 'E:/Flow_veo/_ctl/cdp_tool.py')
cdp = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cdp)

flow_target = cdp.find('studio.html')
s = cdp.Session(flow_target)
s.cmd('Runtime.enable')

run_id = sys.argv[1]
kind = sys.argv[2] # "imageUpscale" or "videoUpscale"
input_media_id = sys.argv[3]
target_resolution = sys.argv[4] # "2K", "4K", "1080p"

print(f"[{run_id}] Bắt đầu Live Upscale Run...")
print(f"[{run_id}] Kind: {kind}")
print(f"[{run_id}] Input Media ID: {input_media_id}")
print(f"[{run_id}] Target Resolution: {target_resolution}")

payload = {
    'kind': kind,
    'projectId': '729eaa19-1c85-4cfc-89c3-5f86de2dffc5',
    'targetResolution': target_resolution,
}

if kind == 'imageUpscale':
    payload['modelKey'] = 'GEM_PIX_2_UPSAMPLE_4K' if target_resolution == '4K' else 'GEM_PIX_2_UPSAMPLE_2K'
    payload['imageRefs'] = [{'mediaId': input_media_id}]
else:
    payload['modelKey'] = 'veo_3_1_upsampler_4k' if target_resolution == '4K' else 'veo_3_1_upsampler_1080p'
    payload['videoInput'] = {'mediaId': input_media_id}

js = f'''
(async () => {{
  const call = (type, payload, ms) => new Promise((res) => {{
    const id = 'gen_' + Math.random().toString(36).slice(2);
    const t = setTimeout(() => res({{ __timeout: true, type }}), ms || 360000);
    chrome.runtime.sendMessage({{ type, requestId: id, payload }}, (r) => {{
      clearTimeout(t);
      if (chrome.runtime.lastError) res({{ __lastError: chrome.runtime.lastError.message }});
      else res(r);
    }});
  }});

  const gen = await call('FLOWGRAPH_GENERATE', {json.dumps(payload)}, 360000);
  return gen;
}})()
'''

print(f"[*] Gửi lệnh FLOWGRAPH_GENERATE sang Service Worker...")
out = s.eval(js, await_promise=True)
s.close()
print("\n[=== KẾT QUẢ PROVIDER TRẢ VỀ ===]\n")
print(json.dumps(out, indent=2))
