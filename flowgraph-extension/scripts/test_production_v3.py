import json, time, urllib.request
from pathlib import Path

BASE='http://127.0.0.1:3091'
ROOT=Path(__file__).resolve().parents[1]
source=(ROOT/'scripts'/'v2-a.mp4').resolve()
project={
 'id':'prod-v3-test','title':'Production V3 Test','sequences':[{'scenes':[{'shots':[{
   'id':'shot-1','shotNumber':'1','takes':[{'id':'take-1','status':'APPROVED','localPath':str(source),'fileName':source.name}]
 }]}]}],
 'timeline':[{'type':'VIDEO','muted':False,'clips':[{'takeId':'take-1'}]}]
}

def post(path, body):
    req=urllib.request.Request(BASE+path,data=json.dumps(body).encode(),headers={'Content-Type':'application/json'},method='POST')
    with urllib.request.urlopen(req,timeout=30) as r:
        return json.loads(r.read().decode())

print('HEALTH', json.loads(urllib.request.urlopen(BASE+'/health').read().decode()))
print('VALIDATE', post('/validate', {'project':project}))
proxy=post('/proxy', {'path':str(source),'takeId':'take-1'})
print('PROXY', proxy)
with urllib.request.urlopen(proxy['proxyUrl'], timeout=30) as r:
    print('PROXY_GET', r.status, r.headers.get('Content-Type'), r.headers.get('Content-Length'))
package=post('/package', {'project':project})
print('PACKAGE', package)
assert Path(package['packagePath']).is_file()

missing=json.loads(json.dumps(project))
missing['sequences'][0]['scenes'][0]['shots'][0]['takes'][0]['localPath']='Z:/missing/'+source.name
print('VALIDATE_MISSING', post('/validate', {'project':missing}))
print('RELINK', post('/relink', {'project':missing,'searchRoot':str(ROOT/'scripts')}))
