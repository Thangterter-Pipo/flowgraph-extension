import sys
sys.path.insert(0,r'E:\Google-flow-skills\src')
from gfs.skill_registry import SkillRegistry
from gfs.project_orchestrator import ProductionRequest, ProjectOrchestrator
r=SkillRegistry(); o=ProjectOrchestrator(r)
req=ProductionRequest('30 second perfume film female recurring character Paris night low key anamorphic','perfume-ad-director',has_brand=True,recurring_character=True)
p=set(o.plan(req))
target='qc/product-consistency-critic'
print('target in plan',target in p)
for sid in sorted(p):
 s=r.get(sid)
 if target in s.dependencies:
  print('direct parent',sid)
