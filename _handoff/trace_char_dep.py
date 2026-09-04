import sys
sys.path.insert(0,r'E:\Google-flow-skills\src')
from gfs.skill_registry import SkillRegistry
from gfs.project_orchestrator import ProductionRequest, ProjectOrchestrator
r=SkillRegistry(); o=ProjectOrchestrator(r)
req=ProductionRequest('observational documentary portrait available light factual real location','documentary',documentary_truth_constraints=True)
p=set(o.plan(req)); target='foundation/character-bible-builder'
print('target',target in p)
for sid in sorted(p):
 s=r.get(sid)
 if target in s.dependencies:
  print('direct parent',sid)
