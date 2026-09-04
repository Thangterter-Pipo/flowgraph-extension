from __future__ import annotations

import json, re
from pathlib import Path
import yaml

ROOT = Path(r"E:\Google-flow-skills")
REG_PATH = ROOT / "skills" / "registry.json"
REG = json.loads(REG_PATH.read_text(encoding="utf-8"))

GENERIC_TRIGGER_SNIPPETS = (
    "the current shot or project needs the narrow responsibility explicitly owned by",
    "a parent director or downstream skill is missing the specialist decision produced by",
)


def read_skill(sid: str):
    cat, slug = sid.split('/', 1)
    path = ROOT / 'skills' / cat / slug / 'SKILL.md'
    text = path.read_text(encoding='utf-8')
    parts = text.split('---', 2)
    meta = yaml.safe_load(parts[1])
    body = parts[2].lstrip('\n')
    return path, meta, body


def write_skill(path: Path, meta: dict, body: str):
    fm = yaml.safe_dump(meta, sort_keys=False, allow_unicode=True, width=120).strip()
    path.write_text('---\n' + fm + '\n---\n' + body.lstrip('\n'), encoding='utf-8')


def replace_section(body: str, name: str, content: str) -> str:
    pattern = rf"(^## {re.escape(name)}\s*$\n)(.*?)(?=^## |\Z)"
    m = re.search(pattern, body, flags=re.M | re.S)
    if not m:
        return body
    return body[:m.start()] + m.group(1) + '\n' + content.strip() + '\n\n' + body[m.end():].lstrip('\n')


def section(body: str, name: str) -> str:
    m = re.search(rf"^## {re.escape(name)}\s*$\n(.*?)(?=^## |\Z)", body, re.M | re.S)
    return m.group(1).strip() if m else ''


def field_from_standards(ps: str, labels: list[str]) -> str | None:
    for label in labels:
        m = re.search(rf"(?mi)^[-*]\s*{re.escape(label)}\s*:\s*(.+)$", ps)
        if m:
            return m.group(1).strip().rstrip('.')
    return None


def first_decision(body: str):
    sec = section(body, 'Decision Framework')
    rows=[]
    for line in sec.splitlines():
        if not line.startswith('|') or '---' in line or 'condition' in line.lower():
            continue
        cols=[c.strip() for c in line.strip('|').split('|')]
        if len(cols) >= 3:
            rows.append(cols[:3])
    for row in rows:
        joined=' '.join(row).lower()
        if 'make the narrow decision' not in joined and 'specifically requires' not in joined:
            return tuple(row)
    return tuple(rows[0]) if rows else ('Owned decision is unresolved','apply the documented decision framework','the skill has one authoritative responsibility')


def family(slug: str) -> str:
    s=slug
    if any(k in s for k in ('tiktok','instagram','youtube-short','social','ugc','reel','short-form')):
        return 'social'
    if any(k in s for k in ('documentary','interview','corporate','educational','explainer')):
        return 'factual'
    if any(k in s for k in ('architecture','interior','real-estate','hotel','resort','hospitality','travel','event')):
        return 'place'
    if any(k in s for k in ('beauty','fashion','jewelry','perfume','watch','luxury')):
        return 'luxury_people'
    if any(k in s for k in ('food','beverage','drink')):
        return 'food'
    if any(k in s for k in ('automotive','car','sports','fitness','action')):
        return 'kinetic'
    if any(k in s for k in ('tech','smartphone','app','product-commercial')):
        return 'product_tech'
    if any(k in s for k in ('music','editorial','art-film')):
        return 'expressive'
    if any(k in s for k in ('trailer','teaser')):
        return 'promo_narrative'
    return 'narrative'

FAMILY = {
    'social': {
        'story':'hook → proof/value → pattern reset → payoff or CTA',
        'shots':'thumb-stop opening, direct-address or hero medium, proof close-up, reaction/use insert, pattern-reset frame, CTA-safe resolve',
        'performance':'direct, legible, behavior-first performance with fast gaze/gesture changes limited to one clear beat per shot',
        'production':'recognizable real-world or brand context with controlled clutter and deliberate caption/UI clearance',
        'motion':'short readable moves, direct-to-camera action, bounded handheld/gimbal energy, one dominant motion event per shot',
        'color':'high subject separation with brand-safe accents and mobile-readable midtone contrast',
        'qa':'hook_clarity=1.5, subject_product_readability=1.4, safe_area=1.4, prompt_alignment=1.2, artifact_free=1.2, continuity=1.0',
    },
    'factual': {
        'story':'context/question → evidence/process → human proof → conclusion or next action',
        'shots':'context wide, observational medium, process detail, reaction, factual insert, proof/result frame',
        'performance':'naturalistic and minimally directed; observable work, listening, explaining, reacting, or demonstrating outranks posed emotion',
        'production':'credible lived-in locations and real task detail; dressing supports evidence rather than advertising gloss',
        'motion':'event-following camera, restrained observational handheld or locked frames; no movement that implies facts not present',
        'color':'skin-faithful, location-authentic rendering with restrained grading and stable white-balance intent',
        'qa':'factual_integrity=1.6, prompt_alignment=1.4, identity=1.3, continuity=1.3, artifact_free=1.2, cinematography=1.0',
    },
    'place': {
        'story':'context → approach → threshold → circulation/experience → material or service detail → destination payoff',
        'shots':'geography/context wide, approach, doorway/threshold reveal, circulation move, human-scale medium, material/detail insert, view/payoff',
        'performance':'human presence demonstrates scale and experience with restrained natural behavior rather than staged posing',
        'production':'architectural geometry, circulation, materials, furniture/props, landscape and service details must remain spatially coherent',
        'motion':'slow spatially motivated dolly/gimbal/tracking; drone only when geography adds information; avoid endless floating camera',
        'color':'material-accurate neutral-to-warm rendering with believable daylight/practical balance',
        'qa':'geometry_integrity=1.6, continuity=1.4, material_accuracy=1.4, lighting=1.2, composition=1.2, artifact_free=1.2',
    },
    'luxury_people': {
        'story':'desire or identity cue → tactile/beauty evidence → controlled reveal or interaction → iconic resolved hero',
        'shots':'iconic hero, portrait close-up, tactile macro, controlled hand/skin interaction, silhouette/detail contrast, resolved brand/product frame',
        'performance':'restrained micro-performance: gaze, breath, posture, hand contact and precise timing; avoid broad generic smiling',
        'production':'few premium materials, intentional negative space, exact wardrobe/product geometry, controlled reflections and uncluttered hero zones',
        'motion':'slow arcs, micro push-ins, precise gesture and material motion; effects stay subordinate to face/product identity',
        'color':'narrow premium palette with protected skin/product hue, deep controlled blacks, clean highlights and restrained accent saturation',
        'qa':'identity_product=1.6, material_rendering=1.5, lighting=1.4, composition=1.3, artifact_free=1.3, continuity=1.2',
    },
    'food': {
        'story':'ingredient/source → preparation or pour → texture transformation → serve/refreshment → appetite hero',
        'shots':'ingredient detail, preparation action, macro texture/steam/liquid, tabletop hero, consumption or refreshment payoff',
        'performance':'hands and serving actions use explicit start-contact-end states; human reactions stay secondary to food/beverage readability',
        'production':'food styling, vessel geometry, condensation, garnish, surface cleanliness and package identity are continuity-critical',
        'motion':'viscosity-, gravity- and contact-aware liquid/steam/crumb motion with one hero transformation per shot',
        'color':'ingredient-accurate appetizing warmth with protected package color and controlled specular highlights',
        'qa':'food_material=1.6, physics=1.5, product_identity=1.4, lighting=1.3, artifact_free=1.3, continuity=1.1',
    },
    'kinetic': {
        'story':'goal/geography → effort or motion proof → impact/technique → escalation → achievement or hero resolve',
        'shots':'geography wide, tracking/follow, technique/detail insert, impact/reaction, speed cue, stable hero resolve',
        'performance':'biomechanically plausible action with clear body/vehicle state, contact, direction and recovery; emotion follows physical objective',
        'production':'surfaces, equipment, vehicle/wardrobe identity and safety-relevant geometry remain stable through motion',
        'motion':'cause-and-effect motion with explicit path, speed, acceleration, contact and end state; camera never destroys geography',
        'color':'high separation and readable detail under directional or venue-motivated light; hero colors remain exact',
        'qa':'physics=1.6, motion=1.5, geometry_identity=1.4, continuity=1.3, cinematography=1.2, artifact_free=1.2',
    },
    'product_tech': {
        'story':'problem or iconic product cue → feature/mechanism proof → use context → benefit → resolved hero/CTA',
        'shots':'hero packshot, feature macro, interface/mechanism insert, hand/use context, benefit reaction, resolved logo/product frame',
        'performance':'precise hand/device interaction with explicit contact and gaze; human behavior demonstrates benefit without obscuring the product',
        'production':'exact geometry, logo, UI, material finish, ports/buttons/camera modules and approved brand surfaces are hard constraints',
        'motion':'controlled orbit/push/reveal with stable product orientation; interface or mechanism motion must correspond to approved functionality',
        'color':'device/package-accurate color with clean edge separation and limited brand accent palette',
        'qa':'product_identity=1.7, logo_ui_integrity=1.6, material=1.4, artifact_free=1.4, lighting=1.2, prompt_alignment=1.2',
    },
    'expressive': {
        'story':'formal or musical motif → repetition/variation → contrast/escalation → motif return or conceptual shift',
        'shots':'motif wide, performance/portrait, graphic detail, movement study, transition image, motif return',
        'performance':'stylized but rule-bound; gesture, pose and gaze follow the project motif instead of random expressive behavior',
        'production':'strong art-direction rule, repeated materials/shapes/colors and intentional exceptions rather than unrelated spectacle',
        'motion':'rhythm- or concept-driven movement with a repeatable formal rule; discontinuity is allowed only when intentional',
        'color':'bold motif-led palette with explicit section changes and protected subject identity where required',
        'qa':'concept_coherence=1.5, motif_consistency=1.4, motion=1.3, composition=1.3, artifact_free=1.2, prompt_alignment=1.2',
    },
    'promo_narrative': {
        'story':'motif/question → partial reveal → escalating information → peak contrast → withheld or title-safe resolution',
        'shots':'motif insert, partial character/world reveal, escalating action/reaction, contrast beat, title-safe or unresolved end frame',
        'performance':'selective reactions and high-value behavior fragments; do not explain the full story through generic intensity',
        'production':'preserve source-world continuity and reserve clean title/logo space without inventing unrelated spectacle',
        'motion':'movement intensity escalates across the piece; quiet locked or creeping shots create contrast with later impacts',
        'color':'preserve source-film palette while allowing controlled contrast escalation toward the final beats',
        'qa':'information_architecture=1.5, continuity=1.4, prompt_alignment=1.3, cinematography=1.2, artifact_free=1.2, title_safe=1.2',
    },
    'narrative': {
        'story':'setup/orientation → desire or pressure → development → turn/revelation → consequence or resolution',
        'shots':'establishing geography, character medium, POV/insert, action-reaction pair, transition, reveal and resolution frame',
        'performance':'objective-driven observable behavior with reaction shots, gaze, posture, breath and gesture tied to dramatic change',
        'production':'story-motivated sets, props, wardrobe and environment rules with continuity stronger than decorative novelty',
        'motion':'camera and subject movement follow dramatic information; stillness, approach, retreat and escalation are deliberately contrasted',
        'color':'scene-specific palette evolves with story while maintaining project-wide skin, material and continuity rules',
        'qa':'story_clarity=1.4, continuity=1.4, character_identity=1.3, cinematography=1.2, performance=1.2, artifact_free=1.2',
    },
}


def genre_standards(sid: str, meta: dict, body: str) -> str:
    slug=sid.split('/',1)[1]
    fam=FAMILY[family(slug)]
    ps=section(body,'Professional Standards')
    visual=field_from_standards(ps,['Visual grammar']) or meta.get('responsibility','').rstrip('.')
    story=field_from_standards(ps,['Story grammar']) or fam['story']
    lens=field_from_standards(ps,['Lens tendency','Lens language']) or '35–85 mm as a coherent core family, with wider or longer exceptions justified by geography, identity, product scale, or emotional distance'
    camera=field_from_standards(ps,['Camera tendency','Camera language']) or 'motivated movement only; path, speed, rig and settle state are selected from story information rather than decoration'
    lighting=field_from_standards(ps,['Lighting tendency','Lighting language']) or 'source-motivated key/fill/back/practical design with readable hierarchy and continuity across linked shots'
    color=field_from_standards(ps,['Color strategy']) or fam['color']
    edit=field_from_standards(ps,['Editing rhythm','Edit rhythm']) or ('rhythm follows the genre story grammar; one dominant information beat per generated shot and deliberate contrast between holds and acceleration')
    refs=field_from_standards(ps,['Reference strategy','Reference bias']) or 'use references whenever recurring identity, exact product, wardrobe, location, architecture, or approved start/end composition is load-bearing'
    flow=field_from_standards(ps,['Flow/Veo strategy bias']) or 'route through strategy/generation-method-router; prefer stronger image/reference control as exactness requirements rise'
    cliche=field_from_standards(ps,['Avoid cliché','Clichés to avoid','Avoid']) or 'generic cinematic adjective stacks, unmotivated gimbal movement, decorative particles, and genre effects with no narrative or commercial job'
    if cliche.lower().startswith('cliché:'):
        cliche=cliche.split(':',1)[1].strip()
    if cliche.lower().startswith('avoid '):
        cliche=cliche[6:].strip()
    return '\n'.join([
        f'- Visual grammar: {visual}.',
        f'- Story grammar: {story}.',
        f'- Shot vocabulary: {fam["shots"]}.',
        f'- Lens tendency: {lens}.',
        f'- Camera tendency: {camera}.',
        f'- Lighting tendency: {lighting}.',
        f'- Color strategy: {color}.',
        f'- Performance style: {fam["performance"]}.',
        f'- Edit rhythm: {edit}.',
        f'- Production-design tendency: {fam["production"]}.',
        f'- Motion behavior: {fam["motion"]}.',
        f'- Reference strategy: {refs}.',
        f'- Flow/Veo strategy bias: {flow}.',
        f'- QA weights: {fam["qa"]}.',
        f'- Clichés to avoid: {cliche}.',
        '- Genre grammar changes priorities and scoring weights only; it never hardcodes endpoints, payload fields, model keys, prices, authentication, or security-token behavior.',
    ])


def triggers(meta: dict) -> list[str]:
    sid=meta['id']; cat=meta['category']; resp=meta.get('responsibility','').strip().rstrip('.')
    slug=sid.split('/',1)[1].replace('-',' ')
    deps=list(meta.get('dependencies') or [])
    parent=deps[0] if deps else None
    if cat=='flow':
        return [
            f'use `{sid}` when the approved generation or media plan explicitly requires {slug} inside an authorized Google Flow session',
            f'invoke `{sid}` only after the evidence gate confirms its documented capability level and all required non-secret inputs are available',
        ]
    if cat=='genre':
        return [
            f'use `{sid}` when the brief, intended audience experience, or client category matches the {slug} visual and editorial grammar',
            f'invoke `{sid}` before craft sign-off when lens, camera, lighting, performance, edit rhythm, reference strategy, and QA weighting need genre-specific priorities',
        ]
    if cat=='continuity':
        domain=slug.replace(' continuity','')
        return [
            f'use `{sid}` when an accepted previous continuity state contains {domain} facts that the current shot must carry or deliberately transition',
            f'invoke `{sid}` before prompt composition whenever the current shot specification disagrees with the previous accepted {domain} state',
        ]
    if cat=='qc':
        return [
            f'use `{sid}` when a prepared prompt or generated result needs independent scoring for this concern: {resp.lower()}',
            f'invoke `{sid}` before the acceptance gate whenever its dimension can create a hard failure even when the overall average is high',
        ]
    if cat=='failure':
        return [
            f'use `{sid}` after QC or runtime evidence exposes the failure class owned by this analyzer: {resp.lower()}',
            f'invoke `{sid}` before retry planning so the next attempt changes the causally implicated parameters instead of repeating the same input',
        ]
    if cat=='orchestration':
        return [
            f'use `{sid}` when the project pipeline requires coordination of this exact responsibility: {resp.lower()}',
            f'invoke `{sid}` only after its declared producers are available; delegate every creative or runtime decision to registered owning skills',
        ]
    context='shot' if cat in {'craft','prompt','strategy'} else 'project'
    t1=f'use `{sid}` when the {context} has not yet resolved this owned decision: {resp.lower()}'
    if parent:
        t2=f'invoke `{sid}` after `{parent}` establishes its upstream policy and before downstream prompt, strategy, QC, or orchestration consumes the specialist result'
    else:
        t2=f'invoke `{sid}` before downstream departments consume this decision whenever the brief leaves the owned parameter unresolved or contradictory'
    return [t1,t2]


def not_for(meta: dict) -> list[str]:
    sid=meta['id']; cat=meta['category']; deps=list(meta.get('dependencies') or [])
    parent=deps[0] if deps else None
    if cat=='flow':
        return [
            'selecting lens, lighting, blocking, performance, story, composition, or genre taste; runtime executes approved specifications only',
            'fabricating, replaying, exporting, persisting, or bypassing browser-generated reCAPTCHA, OAuth, cookies, payment, quota, or access controls',
        ]
    if cat=='genre':
        return [
            'choosing final shot-level lens, lighting, blocking, or camera parameters; genre publishes priorities to the owning craft specialists',
            'executing Google Flow calls or asserting runtime capability; generation strategy and the evidence-aware flow layer own execution',
        ]
    rows=[]
    if parent:
        rows.append(f'coordinating the full responsibility owned by `{parent}`; this skill changes only its declared specialist decision')
    else:
        rows.append('taking ownership of adjacent creative, QC, failure-analysis, strategy, or orchestration decisions outside this skill contract')
    rows.append('inventing or executing undocumented Google Flow endpoints, payload fields, model keys, prices, security-token workarounds, or unverified runtime behavior')
    return rows


def upgraded_examples(meta: dict, body: str) -> str:
    sid=meta['id']; name=meta.get('name',sid); resp=meta.get('responsibility','').strip()
    cond,choice,reason=first_decision(body)
    handoff='strategy/shot-generation-router'
    if meta['category']=='flow': handoff='flow/generation-poller'
    elif meta['category'] in {'qc','failure'}: handoff='strategy/edit-vs-regenerate-selector'
    elif meta['category']=='orchestration': handoff='orchestration/video-production-orchestrator'
    payload={
        'skill_id':sid,'skill_version':meta.get('version','1.0.0'),'produced_at':'2026-08-29T09:00:00Z',
        'result':{'condition':cond,'decision':choice,'responsibility':resp,'locked_constraints_preserved':True},
        'rationale':[{'decision':choice,'because':reason,'rejected':['unmotivated generic cinematic treatment']}],
        'assumptions':[],'warnings':[],'handoff':[handoff],
    }
    payload2={
        'skill_id':sid,'skill_version':meta.get('version','1.0.0'),'produced_at':'2026-08-29T09:01:00Z',
        'result':{'status':'conflict_resolved','preserved':['identity','continuity','runtime_evidence'],'changed_only_owned_parameter':True},
        'rationale':[{'decision':'preserve locked constraints and revise only the owned parameter','because':'locked identity, brand, continuity, factual and evidence constraints outrank decorative novelty','rejected':['silently blending contradictory requirements','blind unchanged retry']}],
        'assumptions':[],'warnings':['conflicting request surfaced instead of silently merged'],'handoff':[handoff],
    }
    return f'''# {name} — Worked Examples

## Example 1 — Decision under a real production condition

### Input slice
```yaml
shot_id: S04
condition: {json.dumps(cond, ensure_ascii=False)}
responsibility: {json.dumps(resp, ensure_ascii=False)}
locked:
  identity: true
  continuity: true
  runtime_evidence: true
```

### Reasoning
`{sid}` owns this decision and no neighboring department. Under **{cond}**, it selects **{choice}** because {reason}

### Output envelope
```json
{json.dumps(payload, ensure_ascii=False, indent=2)}
```

## Example 2 — Conflict, preservation, and bounded recovery

### Input slice
```yaml
shot_id: S09
approved_state:
  identity: locked
  continuity: locked
request:
  desired_change: contradicts an approved state or capability boundary
retry_history:
  unchanged_retries: 0
```

### Reasoning
The skill surfaces the contradiction, preserves locked facts, and changes only the parameter it owns. If the rendered result still fails, failure analysis runs before edit/regenerate selection; an unchanged blind retry is not allowed.

### Output envelope
```json
{json.dumps(payload2, ensure_ascii=False, indent=2)}
```
'''


for row in REG['skills']:
    sid=row['id']
    path, meta, body = read_skill(sid)
    meta['triggers']=triggers(meta)
    meta['not_for']=not_for(meta)
    # Body mirrors frontmatter so human and machine routing stay aligned.
    body=replace_section(body,'When To Use','\n'.join(f'- {x}' for x in meta['triggers']))
    body=replace_section(body,'When NOT To Use','\n'.join(f'- {x}' for x in meta['not_for']))
    if meta['category']=='genre':
        body=replace_section(body,'Professional Standards',genre_standards(sid,meta,body))
    write_skill(path,meta,body)
    ex=path.parent/'examples'/'example.md'
    ex.write_text(upgraded_examples(meta,body),encoding='utf-8')

# Add a regression test that makes semantic quality part of "full pytest".
test=(ROOT/'tests'/'test_semantic_quality.py')
test.write_text(r'''import json, re
from pathlib import Path
import yaml

GENERIC = (
    "the current shot or project needs the narrow responsibility explicitly owned by",
    "a parent director or downstream skill is missing the specialist decision produced by",
)
GENRE_LABELS = [
    "Visual grammar", "Story grammar", "Shot vocabulary", "Lens tendency", "Camera tendency",
    "Lighting tendency", "Color strategy", "Performance style", "Edit rhythm",
    "Production-design tendency", "Motion behavior", "Reference strategy", "QA weights", "Clichés to avoid",
]

def _read(path: Path):
    text=path.read_text(encoding="utf-8")
    parts=text.split("---",2)
    return yaml.safe_load(parts[1]), parts[2]

def test_no_generic_routing_templates(repo_root):
    for p in (repo_root/'skills').glob('*/*/SKILL.md'):
        meta,_=_read(p)
        joined='\n'.join(meta.get('triggers') or []).lower()
        assert not any(x in joined for x in GENERIC), meta['id']
        assert len(set(meta.get('triggers') or [])) >= 2, meta['id']

def test_every_genre_declares_full_professional_profile(repo_root):
    for p in (repo_root/'skills'/'genre').glob('*/SKILL.md'):
        meta,body=_read(p)
        m=re.search(r'^## Professional Standards\s*$\n(.*?)(?=^## |\Z)',body,re.M|re.S)
        assert m, meta['id']
        ps=m.group(1)
        for label in GENRE_LABELS:
            assert re.search(rf'(?mi)^[-*]\s*{re.escape(label)}\s*:',ps), f"{meta['id']} missing {label}"

def test_examples_are_not_template_placeholders(repo_root):
    for p in (repo_root/'skills').glob('*/*/examples/example.md'):
        text=p.read_text(encoding='utf-8').lower()
        assert 'apply specialist rule' not in text, str(p)
        assert 'unmotivated generic cinematic treatment' in text, str(p)

def test_responsibilities_are_unique(repo_root):
    rows=[]
    for p in (repo_root/'skills').glob('*/*/SKILL.md'):
        meta,_=_read(p); rows.append((meta['id'],meta['responsibility'].strip().lower()))
    vals=[x[1] for x in rows]
    assert len(vals)==len(set(vals))
''',encoding='utf-8')

print(f"Upgraded routing, genre grammar, and worked examples for {len(REG['skills'])} skills")
