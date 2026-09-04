from pathlib import Path
ROOT=Path(r'E:\Google-flow-skills')
# Fix formatting in all skill docs.
for p in (ROOT/'skills').glob('*/*/SKILL.md'):
 s=p.read_text(encoding='utf-8').replace('**Write authority (`owns`):\n','**Write authority (`owns`):**\n')
 p.write_text(s,encoding='utf-8')

# Document ArtifactStore and local-only validation.
p=ROOT/'SKILL_CONTRACT.md';s=p.read_text(encoding='utf-8')
needle='`src/gfs/case_runner.py` executes every `skills/*/*/tests/cases.yaml` file through the same executor and evaluates the expectation grammar. Runtime/network/credit side effects are not performed by this offline executor. `src/gfs/project_orchestrator.py` defers all `flow/*`, network, and credit skills during offline planning.\n'
add='\n`src/gfs/artifact_store.py` enforces `owns` at write time. A skill cannot mutate a neighbouring pointer even if it can read or validate it. Subschema values are validated against the local Draft 2020-12 schema registry; schema resolution is local-only and never falls back to DNS/HTTP.\n'
if add.strip() not in s: s=s.replace(needle,needle+add)
p.write_text(s,encoding='utf-8')

p=ROOT/'SKILLS_ARCHITECTURE.md';s=p.read_text(encoding='utf-8')
needle='Shared execution artifacts include `creative_plan`, `genre_profile`, `critic_result`, `failure_diagnosis`, `production_plan`, `asset_ledger`, `project_state`, `runtime_context`, `continuity_check`, and `dispatch_plan`. This prevents story, genre, QC, failure, and orchestration skills from abusing `project_bible` or `shot_spec` as generic dumping grounds.\n'
add='\n`ArtifactStore` is the runtime enforcement boundary for these pointers: it maps schema pointers to instance paths, checks the calling skill\'s `owns`, validates the written value using a preloaded local schema registry, and rejects cross-discipline mutation. Offline project orchestration persists a typed `production_plan` and `project_state` snapshot while deferring all Flow/network/credit work.\n'
if add.strip() not in s: s=s.replace(needle,needle+add)
p.write_text(s,encoding='utf-8')

# Reproducibility smoke tests: regeneration pipeline must retain postprocessors.
p=ROOT/'tests'/'test_reproducibility_hooks.py'
p.write_text('''def test_full_generator_reapplies_execution_contract(repo_root):\n    text = (repo_root / "tools" / "expand_skills.py").read_text(encoding="utf-8")\n    assert "apply_pointer_ownership.py" in text\n    assert "postprocess_skill_graph.py" in text\n\n\ndef test_ownership_postprocessor_is_repo_relative(repo_root):\n    text = (repo_root / "tools" / "apply_pointer_ownership.py").read_text(encoding="utf-8")\n    assert "Path(__file__).resolve().parents[1]" in text\n    assert "E:\\\\Google-flow-skills" not in text\n''',encoding='utf-8')
print('Finalized phase-2 docs and reproducibility hooks')
