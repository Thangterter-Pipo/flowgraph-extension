from __future__ import annotations
import json, re, sys
from collections import Counter, defaultdict
from difflib import SequenceMatcher
from pathlib import Path
import yaml

ROOT = Path(r"E:\Google-flow-skills")
REG = json.loads((ROOT / "skills" / "registry.json").read_text(encoding="utf-8"))
SKILLS = REG["skills"]
BY_ID = {s["id"]: s for s in SKILLS}

GENERIC_TRIGGER_SNIPPETS = (
    "the current shot or project needs the narrow responsibility explicitly owned by",
    "a parent director or downstream skill is missing the specialist decision produced by",
)
GENERIC_NOTFOR_SNIPPETS = (
    "taking over neighboring specialist responsibilities or making unrelated taste decisions",
    "inventing Google Flow endpoints, model keys, payload fields, credits, security tokens, or unverified capabilities",
)

def tokens(text: str):
    stop = {"the","and","for","from","with","into","that","this","their","each","across","without","using","through","only","must","when","where","while","video","shot","project","skill","design","define","choose","set","control","current"}
    return {t for t in re.findall(r"[a-z0-9]+", text.lower()) if len(t) > 2 and t not in stop}

def read_skill(sid: str) -> tuple[dict,str]:
    cat,name=sid.split('/',1)
    p=ROOT/'skills'/cat/name/'SKILL.md'
    text=p.read_text(encoding='utf-8')
    parts=text.split('---',2)
    fm=yaml.safe_load(parts[1]) if len(parts)>=3 else {}
    return fm, parts[2] if len(parts)>=3 else text

def section(body: str, name: str) -> str:
    m=re.search(rf"^## {re.escape(name)}\s*$\n(.*?)(?=^## |\Z)",body,re.M|re.S)
    return m.group(1).strip() if m else ""

issues=[]
trigger_counter=Counter()
notfor_counter=Counter()
section_hashes=defaultdict(list)
line_counts=[]
for s in SKILLS:
    sid=s['id']; fm,body=read_skill(sid)
    line_counts.append((len(body.splitlines()),sid))
    for t in fm.get('triggers') or []: trigger_counter[t.strip()].update() if False else None
    for t in fm.get('triggers') or []: trigger_counter[t.strip()] += 1
    for t in fm.get('not_for') or []: notfor_counter[t.strip()] += 1
    for phrase in GENERIC_TRIGGER_SNIPPETS:
        if any(phrase in t for t in (fm.get('triggers') or [])):
            issues.append(("HIGH","generic_trigger",sid,phrase))
    for phrase in GENERIC_NOTFOR_SNIPPETS:
        if any(phrase in t for t in (fm.get('not_for') or [])):
            issues.append(("MEDIUM","generic_not_for",sid,phrase))
    # Narrow specialists should not claim the entire canonical document as the produced field.
    if s['category'] in {'craft','continuity','prompt','strategy','qc','failure'} and s.get('dependencies'):
        broad=[p for p in (s.get('produces') or []) if p in {'shot_spec','project_bible','visual_bible','character_bible','brand_bible','continuity_state','generation_plan','generation_record','qc_report'}]
        if broad and any(k in sid for k in ('designer','supervisor','director','selector','writer','critic','analyzer','planner')):
            issues.append(("MEDIUM","broad_produces",sid,','.join(broad)))
    for sec in ('Decision Framework','Professional Standards'):
        val=section(body,sec)
        norm=re.sub(r"\s+"," ",val).strip().lower()
        if norm:
            section_hashes[(sec,norm)].append(sid)

# Genre completeness: demand explicit labeled entries rather than a sentence saying they must exist.
required_genre_labels = {
    'Visual grammar': r'(?mi)^[-*]\s*Visual grammar\s*:',
    'Story grammar': r'(?mi)^[-*]\s*Story grammar\s*:',
    'Shot vocabulary': r'(?mi)^[-*]\s*Shot vocabulary\s*:',
    'Lens tendency': r'(?mi)^[-*]\s*Lens (?:tendency|language)\s*:',
    'Camera tendency': r'(?mi)^[-*]\s*Camera (?:tendency|language)\s*:',
    'Lighting tendency': r'(?mi)^[-*]\s*Lighting (?:tendency|language)\s*:',
    'Color strategy': r'(?mi)^[-*]\s*Colou?r strategy\s*:',
    'Performance style': r'(?mi)^[-*]\s*Performance style\s*:',
    'Edit rhythm': r'(?mi)^[-*]\s*(?:Edit|Editing) rhythm\s*:',
    'Production design': r'(?mi)^[-*]\s*Production[- ]design (?:tendency|language|strategy)\s*:',
    'Motion behavior': r'(?mi)^[-*]\s*Motion (?:behavior|characteristics|strategy)\s*:',
    'Reference strategy': r'(?mi)^[-*]\s*Reference (?:strategy|bias)\s*:',
    'QA weights': r'(?mi)^[-*]\s*(?:QA|QC) (?:weights|weighting|rubric)\s*:',
    'Cliches': r'(?mi)^[-*]\s*(?:Avoid cliché|Clichés to avoid)\s*:',
}
for s in SKILLS:
    if s['category']!='genre': continue
    _,body=read_skill(s['id'])
    ps=section(body,'Professional Standards')
    missing=[label for label,pat in required_genre_labels.items() if not re.search(pat,ps)]
    if missing:
        issues.append(("HIGH","genre_profile_incomplete",s['id'],', '.join(missing)))

# High responsibility similarity candidates.
pairs=[]
for i,a in enumerate(SKILLS):
    ta=tokens(a.get('responsibility',''))
    if not ta: continue
    for b in SKILLS[i+1:]:
        if a['category']!=b['category']: continue
        tb=tokens(b.get('responsibility',''))
        if not tb: continue
        jac=len(ta&tb)/max(1,len(ta|tb))
        seq=SequenceMatcher(None,a.get('responsibility','').lower(),b.get('responsibility','').lower()).ratio()
        score=max(jac,seq)
        if score>=0.72:
            pairs.append((score,a['id'],b['id'],jac,seq))
pairs.sort(reverse=True)

# Exact duplicate important sections.
dup_sections=[]
for (sec,norm),ids in section_hashes.items():
    if len(ids)>=3:
        dup_sections.append((len(ids),sec,ids[:12]))
dup_sections.sort(reverse=True)

report=[]
report.append('# Semantic Skill Audit')
report.append('')
report.append(f'- Registry skills: **{len(SKILLS)}**')
report.append(f'- High issues: **{sum(1 for x in issues if x[0]=="HIGH")}**')
report.append(f'- Medium issues: **{sum(1 for x in issues if x[0]=="MEDIUM")}**')
report.append(f'- Responsibility similarity candidates >= 0.72: **{len(pairs)}**')
report.append(f'- Exact repeated Decision/Standards blocks shared by >=3 skills: **{len(dup_sections)}**')
report.append('')
report.append('## High / medium findings')
report.append('')
for sev,kind,sid,detail in issues[:1200]:
    report.append(f'- **{sev} · {kind} · `{sid}`** — {detail}')
report.append('')
report.append('## Responsibility overlap candidates')
report.append('')
for score,a,b,jac,seq in pairs[:100]:
    report.append(f'- `{a}` ↔ `{b}` — score {score:.3f} (Jaccard {jac:.3f}, sequence {seq:.3f})')
report.append('')
report.append('## Repeated important sections')
report.append('')
for count,sec,ids in dup_sections[:100]:
    report.append(f'- **{sec}** repeated exactly across {count} skills: ' + ', '.join(f'`{x}`' for x in ids))
report.append('')
report.append('## Shortest skill bodies')
report.append('')
for n,sid in sorted(line_counts)[:30]: report.append(f'- `{sid}` — {n} body lines')

out=ROOT/'SEMANTIC_AUDIT.md'
out.write_text('\n'.join(report)+'\n',encoding='utf-8')
print(json.dumps({
    'skills':len(SKILLS),
    'high':sum(1 for x in issues if x[0]=='HIGH'),
    'medium':sum(1 for x in issues if x[0]=='MEDIUM'),
    'overlap_candidates':len(pairs),
    'duplicate_sections':len(dup_sections),
    'generic_trigger_skills':sum(1 for x in issues if x[1]=='generic_trigger'),
    'genre_incomplete':sum(1 for x in issues if x[1]=='genre_profile_incomplete'),
    'broad_produces':sum(1 for x in issues if x[1]=='broad_produces'),
    'report':str(out),
}, indent=2))
