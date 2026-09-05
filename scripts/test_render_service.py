from __future__ import annotations
import json, time, urllib.request
from pathlib import Path

base='http://127.0.0.1:3091'
job=json.loads(Path('scripts/render-v2-test-job.json').read_text(encoding='utf-8'))
req=urllib.request.Request(base+'/render', data=json.dumps(job).encode(), headers={'Content-Type':'application/json'}, method='POST')
created=json.loads(urllib.request.urlopen(req, timeout=5).read().decode())
print(json.dumps(created))
job_id=created['jobId']
for _ in range(60):
    state=json.loads(urllib.request.urlopen(base+'/status/'+job_id, timeout=5).read().decode())
    print(json.dumps({'status':state.get('status'),'progress':state.get('progress'),'output':state.get('output')}))
    if state.get('status') in {'DONE','ERROR','CANCELLED'}:
        raise SystemExit(0 if state.get('status')=='DONE' else 2)
    time.sleep(.25)
raise SystemExit(3)
