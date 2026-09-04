from pathlib import Path
import re
from textwrap import dedent

ROOT=Path(r'E:\Google-flow-skills')
HANDOFF=Path(r'E:\Flow_veo\_handoff')

# Install add_pipeline generator, but remove its stale rebuild_repository writer.
src=HANDOFF/'add_pipeline.py'
s=src.read_text(encoding='utf-8')
pattern=r"\nw\('tools/rebuild_repository\.py', r'''[\s\S]*?'''\)\n\nprint\(\"Added executable registry/planning/prompt/continuity/budget/orchestration layer\"\)"
replacement='\n# tools/rebuild_repository.py is owned by the canonical build harness, not this generator.\n\nprint("Added executable registry/planning/prompt/continuity/budget/orchestration layer")'
s2,n=re.subn(pattern,replacement,s,count=1)
if n!=1:
    raise SystemExit(f'failed to remove stale rebuild writer: matches={n}')
(ROOT/'tools'/'add_pipeline.py').write_text(s2,encoding='utf-8')

finalizer=dedent(r"""
from pathlib import Path
from textwrap import dedent

ROOT=Path(__file__).resolve().parents[1]
SRC=ROOT/'src'/'gfs'
TESTS=ROOT/'tests'

# Restore package/runtime entry surface after bootstrap/add_pipeline regeneration.
(SRC/'__init__.py').write_text(dedent('''
"""Google Flow Skills runtime and authoring toolkit."""

from .executor import SkillExecutor, SkillEnvelope, RuleDecisionBackend
from .artifact_store import ArtifactStore, OwnershipViolation, ArtifactValidationError
from .skill_registry import SkillRegistry, RegisteredSkill
from .project_orchestrator import ProjectOrchestrator, ProductionRequest, OfflineProjectRun
from .production_engine import ProductionEngine
from .workspace import ProjectWorkspace
from .runtime_policy import RuntimePolicy, RuntimeMode, RuntimePolicyError
from .flow_runtime import FlowRuntime, TrustedMutationEnvelope, TransportResponse
from .qc_runtime import QCEngine, VisualBackendUnavailable
from .repair_loop import RepairController, RepairAction
from .production_state_machine import validate_transition, ALLOWED_TRANSITIONS
from .page_bridge import PageFunctionTransport, ReadOnlyPageFetchTransport

__all__ = [
    "SkillExecutor", "SkillEnvelope", "RuleDecisionBackend", "ArtifactStore", "OwnershipViolation", "ArtifactValidationError",
    "SkillRegistry", "RegisteredSkill", "ProjectOrchestrator", "ProductionRequest", "OfflineProjectRun",
    "ProductionEngine", "ProjectWorkspace", "RuntimePolicy", "RuntimeMode", "RuntimePolicyError",
    "FlowRuntime", "TrustedMutationEnvelope", "TransportResponse", "QCEngine", "VisualBackendUnavailable",
    "RepairController", "RepairAction", "validate_transition", "ALLOWED_TRANSITIONS", "PageFunctionTransport", "ReadOnlyPageFetchTransport",
]
''').lstrip(),encoding='utf-8')

# Restore strict state transition hook after bootstrap rewrites state.py.
p=SRC/'state.py';s=p.read_text(encoding='utf-8')
if 'from .production_state_machine import validate_transition' not in s:
    s=s.replace('from .polling import ProductionState\n','from .polling import ProductionState\nfrom .production_state_machine import validate_transition\n')
old='''    def transition(self, next_state: ProductionState) -> None:\n        terminal = {ProductionState.FINAL}\n        if self.state in terminal:\n            raise ValueError(f"Cannot transition finalized shot {self.shot_id}")\n        self.state = next_state\n'''
new='''    def transition(self, next_state: ProductionState) -> None:\n        _, nxt = validate_transition(self.state, next_state)\n        self.state = nxt\n'''
if old in s: s=s.replace(old,new)
p.write_text(s,encoding='utf-8')

# Runtime package dependencies and CLI entrypoint.
p=ROOT/'pyproject.toml';s=p.read_text(encoding='utf-8')
s=s.replace('dependencies = ["PyYAML>=6.0"]','dependencies = ["PyYAML>=6.0", "jsonschema>=4.20", "referencing>=0.35"]')
if '[project.scripts]' not in s:
    s=s.replace('\n[tool.pytest.ini_options]','\n[project.scripts]\ngfs = "gfs.cli:main"\n\n[tool.pytest.ini_options]')
p.write_text(s,encoding='utf-8')

# Restore live-test opt-in markers; all normal tests remain offline.
(TESTS/'conftest.py').write_text(dedent('''
from pathlib import Path
import os
import pytest

@pytest.fixture(scope="session")
def repo_root() -> Path:
    return Path(__file__).resolve().parents[1]


def pytest_configure(config):
    config.addinivalue_line("markers", "browser_smoke: authorized browser/CDP read-only smoke test")
    config.addinivalue_line("markers", "live_paid: live Flow mutation that may spend credits")
    config.addinivalue_line("markers", "partial_capability: runtime-partial capability test")


def pytest_collection_modifyitems(config, items):
    for item in items:
        if "browser_smoke" in item.keywords and os.getenv("GFS_BROWSER_SMOKE") != "1":
            item.add_marker(pytest.mark.skip(reason="requires GFS_BROWSER_SMOKE=1"))
        if "live_paid" in item.keywords and not (os.getenv("GFS_LIVE_FLOW") == "1" and os.getenv("GFS_ALLOW_CREDITS") == "1"):
            item.add_marker(pytest.mark.skip(reason="requires GFS_LIVE_FLOW=1 and GFS_ALLOW_CREDITS=1"))
        if "partial_capability" in item.keywords and os.getenv("GFS_ALLOW_PARTIAL") != "1":
            item.add_marker(pytest.mark.skip(reason="requires GFS_ALLOW_PARTIAL=1"))
''').lstrip(),encoding='utf-8')

print('Finalized production runtime surface after generators')
""").lstrip()
(ROOT/'tools'/'finalize_runtime_surface.py').write_text(finalizer,encoding='utf-8')

# Canonical rebuild itself.
rebuild=dedent(r"""
"""Rebuild generated repository state in canonical, non-live order."""
from __future__ import annotations
import os
import subprocess
import sys
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
PY=sys.executable

def run(args, *, env=None):
    print('+',' '.join(map(str,args)),flush=True)
    subprocess.run(args,cwd=ROOT,env=env,check=True)

for script in (
    'bootstrap_system.py','generate_skills.py','expand_skills.py','render_docs.py','add_pipeline.py',
    'apply_pointer_ownership.py','postprocess_skill_graph.py','finalize_phase2_docs.py','finalize_runtime_surface.py',
):
    run([PY,str(ROOT/'tools'/script)])

env=os.environ.copy()
env['PYTHONPATH']=str(ROOT/'src')+(os.pathsep+env['PYTHONPATH'] if env.get('PYTHONPATH') else '')
run([PY,'-m','gfs.registry_build','--root',str(ROOT)],env=env)
run([PY,'-m','pytest','-q'],env=env)
run([PY,'-m','gfs.cli','cases'],env=env)
run([PY,str(ROOT/'tools'/'audit_semantics.py')],env=env)
print('Repository rebuild complete: no live browser or credit-spending operation was executed')
""").lstrip()
(ROOT/'tools'/'rebuild_repository.py').write_text(rebuild,encoding='utf-8')
print('Installed reproducible add_pipeline + runtime finalizer + canonical rebuild')
