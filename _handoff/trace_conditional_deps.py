import sys
sys.path.insert(0,r'E:\Google-flow-skills\src')
from gfs.skill_registry import SkillRegistry
from gfs.project_orchestrator import ProductionRequest, ProjectOrchestrator
r=SkillRegistry(); o=ProjectOrchestrator(r)
req=ProductionRequest('observational documentary portrait available light factual real location','documentary',documentary_truth_constraints=True)
p=set(o.plan(req))
for target in ['foundation/character-bible-builder','foundation/brand-bible-builder','qc/character-consistency-critic','qc/product-consistency-critic','qc/brand-consistency-critic']:
 print('\nTARGET',target,target in p)
 for sid in sorted(p):
  if target in r.get(sid).dependencies:
   print(' parent',sid)
