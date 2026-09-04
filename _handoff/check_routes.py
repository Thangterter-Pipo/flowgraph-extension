import sys
sys.path.insert(0, r'E:\Google-flow-skills\src')
from gfs.project_orchestrator import ProductionRequest, ProjectOrchestrator

o=ProjectOrchestrator()
cases=[
 ProductionRequest('20 second luxury watch commercial exact dial macro reflections vertical','luxury-commercial',has_brand=True,product_critical=True,vertical=True),
 ProductionRequest('30 second perfume film female recurring character Paris night low key anamorphic','perfume-ad-director',has_brand=True,recurring_character=True),
 ProductionRequest('observational documentary portrait available light factual real location','documentary',documentary_truth_constraints=True),
]
for r in cases:
 p=o.plan(r)
 print('\n'+r.genre, len(p))
 print('\n'.join(x for x in p if x.startswith('genre/') or 'product-' in x or 'character-' in x or 'documentary' in x))
