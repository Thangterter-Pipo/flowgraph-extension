import json
from pathlib import Path
d=json.loads(Path(r'E:\Google-flow-skills\model_registry\normalized_registry.json').read_text(encoding='utf-8'))
for k,v in d.items():
    if any(t in k.lower() for t in ('veo','abra','r2v','i2v','t2v','upsam')):
        print(k, '|', v.get('family'), '|', v.get('requirements'))
