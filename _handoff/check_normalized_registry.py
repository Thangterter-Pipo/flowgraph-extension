import json, collections
from pathlib import Path
p=Path(r'E:\Flow_veo\model_registry\normalized_registry.json')
d=json.loads(p.read_text(encoding='utf-8'))
print('count',len(d))
print('usage_unique',len({v.get('usageKey') for v in d.values()}))
print('kinds',dict(collections.Counter(v.get('kind') for v in d.values())))
print('status',dict(collections.Counter(v.get('status') for v in d.values())))
print('deprecated',dict(collections.Counter(bool(v.get('deprecated')) for v in d.values())))
print('bad_key_match',sum(1 for k,v in d.items() if v.get('usageKey')!=k))
print('audio_output_true',sum(1 for v in d.values() if v.get('outputsAudio') is True))
print('fields',sorted(set().union(*(v.keys() for v in d.values()))))
