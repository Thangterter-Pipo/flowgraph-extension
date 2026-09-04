import json
from collections import defaultdict,Counter
p=r'E:\\Flow_veo\\model_registry\\normalized_registry.json'
with open(p,encoding='utf-8') as f:d=json.load(f)
for kind in ('image','video'):
    fam=defaultdict(list)
    for k,v in d.items():
        if v.get('kind')==kind:
            fam[(v.get('family'),v.get('familyName'))].append((k,v))
    print('\n'+kind.upper())
    for (fid,name),items in fam.items():
        modes=Counter(); durs=set(); ars=set(); costs=set()
        for k,v in items:
            reqs=v.get('requirements') or []
            flat=set(x for req in reqs for x in req)
            mode='other'
            if any('UPSAMPLE' in x for x in flat): mode='upsample'
            elif 'VIDEO_REQUIREMENT_VIDEO_EDIT' in flat: mode='edit'
            elif 'VIDEO_REQUIREMENT_EXTENSION' in flat: mode='extend'
            elif 'VIDEO_REQUIREMENT_START_IMAGE' in flat and 'VIDEO_REQUIREMENT_END_IMAGE' in flat: mode='start+end'
            elif 'VIDEO_REQUIREMENT_START_IMAGE' in flat: mode='i2v'
            elif 'VIDEO_REQUIREMENT_REFERENCES' in flat: mode='r2v'
            elif 'VIDEO_REQUIREMENT_TEXT' in flat: mode='t2v'
            elif any('IMAGE_REQUIREMENT' in x for x in flat): mode='image-gen'
            modes[mode]+=1
            if v.get('durationSeconds') is not None:durs.add(v['durationSeconds'])
            ars.update(v.get('aspectRatios') or [])
            for tier,info in (v.get('creditMapping') or {}).items():
                val=(info or {}).get('cost')
                if isinstance(val,(int,float)): costs.add(val)
        print(json.dumps({'familyId':fid,'name':name,'count':len(items),'modes':dict(modes),'durations':sorted(durs),'aspectRatios':sorted(ars),'costs':sorted(costs)},ensure_ascii=False))
