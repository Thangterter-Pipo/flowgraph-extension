import json, sys, urllib.request
import websocket

port = int(sys.argv[1]) if len(sys.argv) > 1 else 9223
needle = sys.argv[2] if len(sys.argv) > 2 else ''
expr_path = sys.argv[3] if len(sys.argv) > 3 else None
expr = open(expr_path, 'r', encoding='utf-8').read() if expr_path else 'document.title'

targets = json.load(urllib.request.urlopen(f'http://127.0.0.1:{port}/json/list'))
matched = [t for t in targets if needle.lower() in ((t.get('url','') + ' ' + t.get('title','') + ' ' + t.get('type','')).lower())]
if not matched:
    print(json.dumps({'ok':False,'error':'TARGET_NOT_FOUND','needle':needle,'targets':[{'type':t.get('type'),'url':t.get('url'),'title':t.get('title')} for t in targets]}, ensure_ascii=False))
    raise SystemExit(2)
t = matched[0]
ws = websocket.create_connection(t['webSocketDebuggerUrl'], timeout=30, suppress_origin=True)
msg = {'id':1,'method':'Runtime.evaluate','params':{'expression':expr,'awaitPromise':True,'returnByValue':True,'userGesture':True}}
ws.send(json.dumps(msg))
while True:
    raw = ws.recv()
    data = json.loads(raw)
    if data.get('id') == 1:
        break
ws.close()
res = data.get('result',{}).get('result',{})
out = {'ok': True, 'target': {'type':t.get('type'),'url':t.get('url'),'title':t.get('title')}, 'type':res.get('type'), 'value':res.get('value'), 'description':res.get('description')}
if 'exceptionDetails' in data.get('result',{}): out['exceptionDetails'] = data['result']['exceptionDetails']
print(json.dumps(out, ensure_ascii=False))
