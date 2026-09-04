from pathlib import Path
from textwrap import dedent

ROOT=Path(__file__).resolve().parents[1]
SRC=ROOT/'src'/'gfs'
TESTS=ROOT/'tests'

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

p=SRC/'state.py';s=p.read_text(encoding='utf-8')
if 'from .production_state_machine import validate_transition' not in s:
    s=s.replace('from .polling import ProductionState\n','from .polling import ProductionState\nfrom .production_state_machine import validate_transition\n')
old='''    def transition(self, next_state: ProductionState) -> None:\n        terminal = {ProductionState.FINAL}\n        if self.state in terminal:\n            raise ValueError(f"Cannot transition finalized shot {self.shot_id}")\n        self.state = next_state\n'''
new='''    def transition(self, next_state: ProductionState) -> None:\n        _, nxt = validate_transition(self.state, next_state)\n        self.state = nxt\n'''
if old in s: s=s.replace(old,new)
p.write_text(s,encoding='utf-8')

p=ROOT/'pyproject.toml';s=p.read_text(encoding='utf-8')
s=s.replace('dependencies = ["PyYAML>=6.0"]','dependencies = ["PyYAML>=6.0", "jsonschema>=4.20", "referencing>=0.35"]')
if '[project.scripts]' not in s:
    s=s.replace('\n[tool.pytest.ini_options]','\n[project.scripts]\ngfs = "gfs.cli:main"\n\n[tool.pytest.ini_options]')
p.write_text(s,encoding='utf-8')

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
