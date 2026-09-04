import json
from collections import Counter, defaultdict
p=r'E:\\Flow_veo\\model_registry\\normalized_registry.json'
with open(p,encoding='utf-8') as f:
    d=json.load(f)
print('TOTAL',len(d))
print('KINDS',dict(Counter(v.get('kind') for v in d.values())))
print('DEPRECATED',sum(bool(v.get('deprecated')) for v in d.values()))
for kind in ('image','video'):
    print('\n###',kind.upper())
    rows=[]
    for k,v in d.items():
        if v.get('kind')!=kind: continue
        cm=v.get('creditMapping') or {}
        costs={tier:(info or {}).get('cost') for tier,info in cm.items()}
        rows.append((k,v.get('familyName'),v.get('family'),v.get('durationSeconds'),v.get('aspectRatios'),v.get('outputsAudio'),v.get('deprecated'),v.get('status'),costs,v.get('requirements'),v.get('maxImageRefs'),v.get('maxCharacters')))
    print('COUNT',len(rows))
    for r in rows:
        print(json.dumps(r,ensure_ascii=False))
