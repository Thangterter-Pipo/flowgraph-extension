import json, sys, urllib.request
import websocket

port = int(sys.argv[1])
target_url_contains = sys.argv[2]
expression = sys.argv[3]
pages = json.load(urllib.request.urlopen(f'http://127.0.0.1:{port}/json/list'))
page = next((x for x in pages if target_url_contains in x.get('url','') and x.get('type')=='page'), None)
if not page:
    raise SystemExit('TARGET_NOT_FOUND')
ws = websocket.create_connection(page['webSocketDebuggerUrl'], timeout=10, suppress_origin=True)
try:
    ws.send(json.dumps({
        'id': 1,
        'method': 'Runtime.evaluate',
        'params': {'expression': expression, 'returnByValue': True, 'awaitPromise': True},
    }))
    while True:
        msg = json.loads(ws.recv())
        if msg.get('id') == 1:
            result = msg.get('result', {}).get('result', {})
            print(json.dumps(result.get('value'), ensure_ascii=False, indent=2))
            break
finally:
    ws.close()
