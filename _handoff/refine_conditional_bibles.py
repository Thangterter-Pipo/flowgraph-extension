from pathlib import Path
import json,yaml
ROOT=Path(r'E:\Google-flow-skills')
plan_path=ROOT/'skills_plan'/'plan.json'
plan=json.loads(plan_path.read_text(encoding='utf-8'))
by={s['id']:s for s in plan['skills']}
changes={
 'continuity/continuity-supervisor': (['story/shot-spec-builder','foundation/visual-bible-builder'], ['foundation/character-bible-builder']),
 'strategy/reference-asset-director': (['story/shot-spec-builder'], ['foundation/character-bible-builder','foundation/brand-bible-builder']),
}
class D(yaml.SafeDumper):
 def ignore_aliases(self,data): return True
for sid,(deps,opt) in changes.items():
 s=by[sid];s['dependencies']=deps;s['optional_dependencies']=opt
 cat,slug=sid.split('/',1);path=ROOT/'skills'/cat/slug/'SKILL.md'
 text=path.read_text(encoding='utf-8');_,raw,body=text.split('---',2);meta=yaml.safe_load(raw) or {}
 meta['dependencies']=deps;meta['optional_dependencies']=opt
 if sid=='strategy/reference-asset-director':
  meta['triggers']=[
   'use `strategy/reference-asset-director` when a shot needs character, product, wardrobe, location, style, start-frame, or end-frame reference control',
   'invoke `strategy/reference-asset-director` after `story/shot-spec-builder`; consume character or brand bibles only when those optional artifacts exist',
  ]
 path.write_text('---\n'+yaml.dump(meta,Dumper=D,sort_keys=False,allow_unicode=True,width=120).strip()+'\n---\n'+body.lstrip(),encoding='utf-8')
plan_path.write_text(json.dumps(plan,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')

# Keep postprocessor reproducible.
pp=ROOT/'tools'/'postprocess_skill_graph.py'
text=pp.read_text(encoding='utf-8')
needle='idf["optional_dependencies"]=["qc/character-consistency-critic","qc/product-consistency-critic"]\n'
addition='''cont=by["continuity/continuity-supervisor"]\ncont["dependencies"]=["story/shot-spec-builder","foundation/visual-bible-builder"]\ncont["optional_dependencies"]=["foundation/character-bible-builder"]\nref=by["strategy/reference-asset-director"]\nref["dependencies"]=["story/shot-spec-builder"]\nref["optional_dependencies"]=["foundation/character-bible-builder","foundation/brand-bible-builder"]\n'''
if addition not in text:
 text=text.replace(needle,needle+addition)
pp.write_text(text,encoding='utf-8')
print('conditionalized character/brand bible dependencies')
