from pathlib import Path
import json,yaml
ROOT=Path(r'E:\Google-flow-skills')
plan_path=ROOT/'skills_plan'/'plan.json'
plan=json.loads(plan_path.read_text(encoding='utf-8'))
for s in plan['skills']:
 if s['id']=='failure/identity-drift-analyzer':
  s['dependencies']=[]
  s['optional_dependencies']=['qc/character-consistency-critic','qc/product-consistency-critic']
plan_path.write_text(json.dumps(plan,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
path=ROOT/'skills'/'failure'/'identity-drift-analyzer'/'SKILL.md'
text=path.read_text(encoding='utf-8'); _,raw,body=text.split('---',2); meta=yaml.safe_load(raw)
meta['dependencies']=[];meta['optional_dependencies']=['qc/character-consistency-critic','qc/product-consistency-critic']
class D(yaml.SafeDumper):
 def ignore_aliases(self,data): return True
path.write_text('---\n'+yaml.dump(meta,Dumper=D,sort_keys=False,allow_unicode=True,width=120).strip()+'\n---\n'+body.lstrip(),encoding='utf-8')
print('patched identity drift conditional critics')
