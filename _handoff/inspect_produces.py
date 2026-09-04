import json, collections
p=json.load(open(r'E:\Google-flow-skills\skills_plan\plan.json',encoding='utf-8'))
c=collections.Counter()
for s in p['skills']:
    for x in s.get('produces',[]): c[x]+=1
for k,v in c.most_common(): print(v,k)
