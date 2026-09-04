from __future__ import annotations
import json,re
from pathlib import Path
import yaml
ROOT=Path(r'E:\Google-flow-skills')
reg=json.loads((ROOT/'skills'/'registry.json').read_text(encoding='utf-8'))

def read(p):
    t=p.read_text(encoding='utf-8'); parts=t.split('---',2); return yaml.safe_load(parts[1]),parts[2].lstrip('\n')
def write(p,m,b):
    p.write_text('---\n'+yaml.safe_dump(m,sort_keys=False,allow_unicode=True,width=120).strip()+'\n---\n'+b.lstrip('\n'),encoding='utf-8')
def sec(b,n):
    m=re.search(rf'^## {re.escape(n)}\s*$\n(.*?)(?=^## |\Z)',b,re.M|re.S); return m.group(1).strip() if m else ''
def replace(b,n,c):
    pat=rf'(^## {re.escape(n)}\s*$\n)(.*?)(?=^## |\Z)'; m=re.search(pat,b,re.M|re.S)
    if not m:return b
    return b[:m.start()]+m.group(1)+'\n'+c.strip()+'\n\n'+b[m.end():].lstrip('\n')

def row(meta):
    sid=meta['id']; cat=meta['category']; r=meta['responsibility'].strip().rstrip('.')
    if cat=='flow':
        return (f'The approved runtime plan selects `{sid}`',f'perform only this documented operation: {r.lower()}',f'Runtime execution stays bounded to `{sid}` and its declared evidence level instead of absorbing neighboring Flow operations.')
    if cat=='qc':
        return (f'The result requires the criterion owned by `{sid}`',f'score observable evidence only for this criterion: {r.lower()}',f'Independent critic ownership prevents a strong average in unrelated dimensions from hiding a failure in `{sid}`.')
    if cat=='failure':
        return (f'The observed defect matches the failure class owned by `{sid}`',f'attribute the defect and propose the minimum causal change: {r.lower()}',f'A named owner and bounded parameter delta are required before any retry is authorized.')
    if cat=='strategy':
        return (f'The generation plan needs the decision owned by `{sid}`',r,f'Strategy must resolve this exact trade-off before runtime dispatch without changing creative taste.')
    if cat=='orchestration':
        return (f'The pipeline reaches the coordination point owned by `{sid}`',r,f'Orchestration schedules and records this responsibility while delegating domain decisions to registered owners.')
    if cat=='continuity':
        return (f'The previous accepted state contains facts governed by `{sid}`',r,f'This domain must be carried exactly or changed through an explicit transition instead of drifting implicitly.')
    if cat=='prompt':
        return (f'The approved shot and generation method require `{sid}`',r,f'Prompt work must preserve structured hierarchy and method constraints instead of adding generic cinematic language.')
    if cat=='genre':
        return (f'The brief is routed to `{sid}`',r,f'Genre grammar must change concrete priorities, shot vocabulary, reference bias and QA weights rather than merely add style adjectives.')
    return (f'The upstream project or shot has not resolved the decision owned by `{sid}`',r,f'This skill has one authoritative responsibility and must leave adjacent fields to their registered owners.')

def specialize_decision(body,meta):
    s=sec(body,'Decision Framework'); a,b,c=row(meta)
    unique=f'| {a} | {b} | {c} |'
    lines=s.splitlines()
    if unique not in lines:
        # insert after markdown table separator if present
        idx=0
        for i,line in enumerate(lines):
            if line.startswith('|---') or ('---' in line and line.startswith('|')):
                idx=i+1;break
        lines.insert(idx,unique)
    return replace(body,'Decision Framework','\n'.join(lines))

def specialize_standards(body,meta):
    s=sec(body,'Professional Standards')
    line=f"- Skill-specific acceptance: `{meta['id']}` must demonstrably satisfy this owned responsibility — {meta['responsibility'].strip().rstrip('.')} — while leaving neighboring responsibilities unchanged."
    if line not in s:
        s=line+'\n'+s
    return replace(body,'Professional Standards',s)

for item in reg['skills']:
    p=ROOT/'skills'/item['category']/item['id'].split('/',1)[1]/'SKILL.md'
    m,b=read(p)
    b=specialize_decision(b,m)
    b=specialize_standards(b,m)
    write(p,m,b)
print(f'Specialized Decision Framework and Professional Standards for {len(reg["skills"])} skills')
