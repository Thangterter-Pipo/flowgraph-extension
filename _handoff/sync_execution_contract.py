from __future__ import annotations

from pathlib import Path
import json, re, yaml

ROOT=Path(r'E:\Google-flow-skills')

# 1) Skill registry/executor version fidelity.
p=ROOT/'src'/'gfs'/'skill_registry.py'
s=p.read_text(encoding='utf-8')
s=s.replace('class RegisteredSkill:\n    id: str\n    name: str', 'class RegisteredSkill:\n    id: str\n    version: str\n    name: str')
s=s.replace('id=row["id"], name=row.get("name", row["id"]), category=row["category"]', 'id=row["id"], version=row.get("version", "1.0.0"), name=row.get("name", row["id"]), category=row["category"]')
p.write_text(s,encoding='utf-8')

p=ROOT/'src'/'gfs'/'executor.py'
s=p.read_text(encoding='utf-8').replace('skill_version="1.0.0",','skill_version=skill.version,')
p.write_text(s,encoding='utf-8')

# 2) Sync every SKILL body I/O documentation with machine frontmatter pointers.
def replace_section(body:str,title:str,new_content:str)->str:
    pat=re.compile(rf'(?ms)^## {re.escape(title)}\n.*?(?=^## |\Z)')
    replacement=f'## {title}\n\n{new_content.strip()}\n\n'
    if not pat.search(body):
        raise RuntimeError(f'missing section {title}')
    return pat.sub(replacement,body,count=1)

for path in sorted((ROOT/'skills').glob('*/*/SKILL.md')):
    text=path.read_text(encoding='utf-8')
    _,raw,body=text.split('---',2)
    meta=yaml.safe_load(raw) or {}
    consumes=meta.get('consumes') or []
    produces=meta.get('produces') or []
    owns=meta.get('owns') or []
    validates=meta.get('validates') or []
    in_lines=['This skill reads only the schema-qualified contract slices declared below:','']+[f'- `{x}`' for x in consumes]
    if not consumes: in_lines += ['- None; invocation context is supplied by dependencies/runtime.']
    in_lines += ['', 'Read access does not grant mutation authority. `owns` is the write boundary; `validates` is read/score-only.']
    out_lines=['This skill emits only the schema-qualified artifacts/slices declared below:','']+[f'- `{x}`' for x in produces]
    if not produces: out_lines += ['- Standard skill envelope only.']
    out_lines += ['', '**Write authority (`owns`):']
    out_lines += [f'- `{x}`' for x in owns] if owns else ['- None. This skill coordinates, proposes, or validates without directly owning a shared-state field.']
    out_lines += ['', '**Validation-only scope (`validates`):**']
    out_lines += [f'- `{x}`' for x in validates] if validates else ['- None.']
    out_lines += ['', 'Any proposed change outside `owns` is a contract violation and must be handed to the registered owner.']
    body=replace_section(body.lstrip(),'Inputs','\n'.join(in_lines))
    body=replace_section(body,'Outputs','\n'.join(out_lines))
    path.write_text('---\n'+raw.strip()+'\n---\n'+body,encoding='utf-8')

# 3) Install reproducible pointer-ownership tool from the applied migration, with repo-relative root and no alias-prone shared lists.
src=Path(r'E:\Flow_veo\_handoff\phase2_execution.py').read_text(encoding='utf-8')
src=src.replace('ROOT = Path(r"E:\\Google-flow-skills")','ROOT = Path(__file__).resolve().parents[1]')
src=src.replace('if sid in OWNS: return OWNS[sid]','if sid in OWNS: return list(OWNS[sid])')
src=src.replace('    skill["produces"] = output_for(skill)\n    skill["owns"] = OWNS.get(sid, [])\n    skill["validates"] = VALIDATES.get(sid, [])', '    skill["produces"] = list(output_for(skill))\n    skill["owns"] = list(OWNS.get(sid, []))\n    skill["validates"] = list(VALIDATES.get(sid, []))')
src=src.replace('    meta["produces"] = skill["produces"]\n    meta["owns"] = skill["owns"]\n    meta["validates"] = skill["validates"]', '    meta["produces"] = list(skill["produces"])\n    meta["owns"] = list(skill["owns"])\n    meta["validates"] = list(skill["validates"])')
(ROOT/'tools'/'apply_pointer_ownership.py').write_text(src,encoding='utf-8')

# Postprocessor retains conditional dependencies and removes YAML aliases after generation.
(ROOT/'tools'/'postprocess_skill_graph.py').write_text('''from pathlib import Path\nimport json, yaml\n\nROOT=Path(__file__).resolve().parents[1]\nplan_path=ROOT/"skills_plan"/"plan.json"\nplan=json.loads(plan_path.read_text(encoding="utf-8"))\nby={s["id"]:s for s in plan["skills"]}\nsc=by["qc/generation-result-scorer"]\nsc["dependencies"]=["qc/prompt-quality-critic","qc/cinematography-critic","qc/lighting-critic","qc/composition-critic","qc/motion-critic","qc/physics-critic","qc/artifact-detector"]\nsc["optional_dependencies"]=["qc/anatomy-critic","qc/character-consistency-critic","qc/product-consistency-critic","qc/brand-consistency-critic","qc/continuity-critic"]\nidf=by["failure/identity-drift-analyzer"]\nidf["dependencies"]=[]\nidf["optional_dependencies"]=["qc/character-consistency-critic","qc/product-consistency-critic"]\nplan_path.write_text(json.dumps(plan,ensure_ascii=False,indent=2)+"\\n",encoding="utf-8")\nclass D(yaml.SafeDumper):\n    def ignore_aliases(self,data): return True\nfields=("dependencies","optional_dependencies","consumes","produces","owns","validates")\nfor skill in plan["skills"]:\n    cat,slug=skill["id"].split("/",1); path=ROOT/"skills"/cat/slug/"SKILL.md"\n    text=path.read_text(encoding="utf-8"); _,raw,body=text.split("---",2); meta=yaml.safe_load(raw) or {}\n    for f in fields: meta[f]=list(skill.get(f) or [])\n    path.write_text("---\\n"+yaml.dump(meta,Dumper=D,sort_keys=False,allow_unicode=True,width=120).strip()+"\\n---\\n"+body.lstrip(),encoding="utf-8")\nprint("Postprocessed conditional dependency graph and normalized frontmatter")\n''',encoding='utf-8')

# Ensure full-skill regeneration re-applies the execution contract.
exp=ROOT/'tools'/'expand_skills.py'
es=exp.read_text(encoding='utf-8')
marker='print(f"Expanded explicit specialist inventory to {len(FULL)} skills; created {len(FULL)-len(BASE)} new packages")'
if 'apply_pointer_ownership.py' not in es:
    repl=marker+'\n\n# Re-apply executable pointer ownership and conditional dependency graph after regeneration.\nimport subprocess, sys\nsubprocess.check_call([sys.executable, str(ROOT / "tools" / "apply_pointer_ownership.py")])\nsubprocess.check_call([sys.executable, str(ROOT / "tools" / "postprocess_skill_graph.py")])'
    es=es.replace(marker,repl)
    exp.write_text(es,encoding='utf-8')

# 4) Contract docs.
contract=ROOT/'SKILL_CONTRACT.md'
c=contract.read_text(encoding='utf-8')
c=c.replace('`continuity_state`, `visual_bible`, `character_bible`, `brand_bible`,\n`generation_plan`, `generation_record`, `qc_report`, `project_manifest`.', '`continuity_state`, `visual_bible`, `character_bible`, `brand_bible`, `creative_plan`,\n`genre_profile`, `generation_plan`, `generation_record`, `critic_result`, `qc_report`,\n`failure_diagnosis`, `production_plan`, `asset_ledger`, `project_state`, `runtime_context`,\n`continuity_check`, `dispatch_plan`, and `project_manifest`.')
old='''consumes:                          # named inputs, each a schema id\n  - shot_spec\n  - visual_bible\nproduces:\n  - shot_spec.cinematography.lens\ntriggers:'''
new='''consumes:                          # schema-qualified read scopes\n  - shot_spec#\n  - visual_bible#/properties/camera_system\nproduces:                          # typed artifacts/slices emitted\n  - shot_spec#/properties/cinematography/properties/lens\nowns:                              # only these pointers may be mutated\n  - shot_spec#/properties/cinematography/properties/lens\nvalidates:                         # read/score only; never mutation authority\n  - continuity_state#/properties/domains/properties/camera\ntriggers:'''
c=c.replace(old,new)
needle='- `side_effects: credits` requires the body to document a budget interaction.\n'
add='''- every `consumes`, `produces`, `owns`, and `validates` entry is a resolvable `<schema>#<JSON Pointer>` reference.\n- `owns` is the mutation boundary; a skill may not write a pointer that it merely `validates`.\n- parent directors normally validate coordinated regions while narrow specialists own individual fields.\n'''
if add.strip() not in c:
    c=c.replace(needle,needle+add)
io='''\n### Executable skill contract\n\n`src/gfs/executor.py` loads the registered skill, parses its Decision Framework into machine-readable condition → choice → reason rules, and emits the standard envelope. `RuleDecisionBackend` is an explicitly offline fallback; it does **not** pretend to replace a creative model. A production AI decision backend can be injected through the same interface.\n\n`src/gfs/case_runner.py` executes every `skills/*/*/tests/cases.yaml` file through the same executor and evaluates the expectation grammar. Runtime/network/credit side effects are not performed by this offline executor. `src/gfs/project_orchestrator.py` defers all `flow/*`, network, and credit skills during offline planning.\n'''
if '### Executable skill contract' not in c:
    c=c.replace('## 5. Tests (`tests/cases.yaml`)',io+'\n---\n\n## 5. Tests (`tests/cases.yaml`)')
contract.write_text(c,encoding='utf-8')

arch=ROOT/'SKILLS_ARCHITECTURE.md'
a=arch.read_text(encoding='utf-8')
insert='''\n## 6. Ownership and executable coordination\n\nEvery contract reference is schema-qualified (`<schema>#<JSON Pointer>`). `consumes` declares reads, `produces` declares emitted artifacts, `owns` is the only write authority, and `validates` is read/score-only. Parent directors therefore coordinate without silently overwriting specialist fields. `src/gfs/schema_refs.py` resolves these references and registry build fails on drift.\n\nThe executable offline layer is intentionally separated from live Flow mutations:\n\n```text\nSkillRegistry → SkillExecutor → DecisionBackend → standard envelope\n                    ↓\n             SkillCaseRunner (all declared cases)\n                    ↓\nProjectOrchestrator → dependency closure → creative/spec execution\n                    └→ defer flow/network/credits until authorized runtime dispatch\n```\n\nShared execution artifacts include `creative_plan`, `genre_profile`, `critic_result`, `failure_diagnosis`, `production_plan`, `asset_ledger`, `project_state`, `runtime_context`, `continuity_check`, and `dispatch_plan`. This prevents story, genre, QC, failure, and orchestration skills from abusing `project_bible` or `shot_spec` as generic dumping grounds.\n\n---\n\n'''
if '## 6. Ownership and executable coordination' not in a:
    a=a.replace('## 6. Evidence-aware Flow runtime',insert+'## 7. Evidence-aware Flow runtime')
    a=a.replace('## 7. Generation control hierarchy','## 8. Generation control hierarchy').replace('## 8. State and media identity','## 9. State and media identity')
arch.write_text(a,encoding='utf-8')

pipe=ROOT/'VIDEO_PRODUCTION_PIPELINE.md'
ptext=pipe.read_text(encoding='utf-8')
block='''\n## Executable offline planning path\n\nThe repository now has a real coordination path, not only Markdown contracts:\n\n```text\nProductionRequest\n  → ProjectOrchestrator.plan()\n  → SkillRegistry dependency closure + distinctive-token specialist routing\n  → SkillExecutor for specification/creative skills\n  → standard envelopes with ownership + rationale\n  → flow/network/credit skills deferred in offline mode\n  → authorized runtime adapter executes only after an explicit live stage\n```\n\nThis separation is deliberate: planning and testing cannot spend credits, reuse security tokens, or accidentally turn a browser/session helper into a background mutation.\n\n'''
if '## Executable offline planning path' not in ptext:
    ptext=block+ptext
pipe.write_text(ptext,encoding='utf-8')

brief=ROOT/'docs'/'AUTHORING_BRIEF.md'
b=brief.read_text(encoding='utf-8')
b=b.replace('consumes: []\nproduces: []\ntriggers: []', 'consumes: []        # every entry is <schema>#<JSON Pointer>\nproduces: []        # emitted artifact/slice\nowns: []            # mutation authority only\nvalidates: []       # read/score-only scope\ntriggers: []')
if 'Ownership rule:' not in b:
    b=b.replace('`responsibility` is exactly one sentence.', 'Ownership rule: `owns` is the only shared-state mutation authority. A parent coordinator should normally `validate` a child-owned region rather than also owning it. Registry build resolves all four reference fields against `/schemas`.\n\n`responsibility` is exactly one sentence.')
brief.write_text(b,encoding='utf-8')

# 5) Regression tests for no YAML anchors and version fidelity.
t=ROOT/'tests'/'test_contract_hygiene.py'
t.write_text('''from gfs.executor import SkillExecutor\n\n\ndef test_frontmatter_contains_no_yaml_alias_artifacts(repo_root):\n    for path in (repo_root / "skills").glob("*/*/SKILL.md"):\n        front = path.read_text(encoding="utf-8").split("---", 2)[1]\n        assert "&id" not in front and "*id" not in front, path\n\n\ndef test_executor_uses_registered_skill_version():\n    out = SkillExecutor().execute("craft/focal-length-designer", {"brief": "portrait"}, produced_at="2026-08-29T00:00:00Z")\n    assert out["skill_version"] == SkillExecutor().registry.get("craft/focal-length-designer").version\n''',encoding='utf-8')

print('Synchronized executable contract, skill I/O docs, reproducibility tools, and architecture docs')
