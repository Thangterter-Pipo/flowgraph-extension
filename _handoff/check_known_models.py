import json
from pathlib import Path
d=json.loads(Path(r'E:\Google-flow-skills\model_registry\normalized_registry.json').read_text(encoding='utf-8'))
keys=['NARWHAL','abra_t2v_8s','abra_i2v_8s','veo_3_1_t2v_fast','abra_r2v_4s','veo_3_1_edit_lite','veo_3_1_upsampler_1080p','veo_3_1_upsampler_4k']
for k in keys:
    v=d.get(k)
    print(k, bool(v), None if not v else {x:v.get(x) for x in ('kind','durationSeconds','outputsAudio','status','deprecated')})
