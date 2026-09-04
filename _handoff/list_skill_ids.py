import json,collections
p=json.load(open(r'E:\Google-flow-skills\skills_plan\plan.json',encoding='utf-8'))
by=collections.defaultdict(list)
for s in p['skills']: by[s['category']].append(s['id'])
for c,ids in by.items():
 print('\n###',c,len(ids)); print('\n'.join(ids))
