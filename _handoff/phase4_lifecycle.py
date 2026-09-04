from pathlib import Path
from textwrap import dedent

ROOT = Path(r"E:\Google-flow-skills")
SRC = ROOT / "src" / "gfs"
TESTS = ROOT / "tests"
DOCS = ROOT / "docs"


def w(path: Path, text: str):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(dedent(text).lstrip(), encoding="utf-8")

w(SRC / "production_state_machine.py", r'''
from __future__ import annotations

from .polling import ProductionState


ALLOWED_TRANSITIONS: dict[ProductionState, set[ProductionState]] = {
    ProductionState.PLANNED: {ProductionState.PROMPT_READY},
    ProductionState.PROMPT_READY: {ProductionState.QUEUED},
    ProductionState.QUEUED: {ProductionState.ACTIVE, ProductionState.FAILED},
    ProductionState.ACTIVE: {ProductionState.SUCCESSFUL, ProductionState.FAILED},
    ProductionState.SUCCESSFUL: {ProductionState.QC_PENDING},
    ProductionState.FAILED: {ProductionState.REGENERATE_REQUIRED},
    ProductionState.QC_PENDING: {ProductionState.QC_PASSED, ProductionState.QC_FAILED},
    ProductionState.QC_PASSED: {ProductionState.FINAL},
    ProductionState.QC_FAILED: {ProductionState.EDIT_REQUIRED, ProductionState.REGENERATE_REQUIRED},
    ProductionState.EDIT_REQUIRED: {ProductionState.QUEUED, ProductionState.FINAL},
    ProductionState.REGENERATE_REQUIRED: {ProductionState.QUEUED, ProductionState.FINAL},
    ProductionState.FINAL: set(),
}


def validate_transition(current: ProductionState | str, next_state: ProductionState | str) -> tuple[ProductionState, ProductionState]:
    cur = current if isinstance(current, ProductionState) else ProductionState(current)
    nxt = next_state if isinstance(next_state, ProductionState) else ProductionState(next_state)
    if nxt not in ALLOWED_TRANSITIONS[cur]:
        raise ValueError(f"Invalid production-state transition {cur.value} -> {nxt.value}")
    return cur, nxt
''')

w(SRC / "page_bridge.py", r'''
from __future__ import annotations

import json
from typing import Any, Protocol

from .flow_runtime import BrowserTransport, TransportResponse


class PageEvaluator(Protocol):
    def evaluate(self, expression: str) -> Any: ...


class ReadOnlyPageFetchTransport(BrowserTransport):
    """Same-browser read-only fetch transport.

    It never reads document.cookie/localStorage and refuses all non-GET requests.
    Browser credentials are handled by the browser itself via `credentials: include`.
    """
    def __init__(self, evaluator: PageEvaluator):
        self.evaluator = evaluator

    def request(self, method: str, url: str, *, json: Any | None = None) -> TransportResponse:
        if method.upper() != "GET" or json is not None:
            raise PermissionError("ReadOnlyPageFetchTransport accepts GET only")
        expression = f"""(async()=>{{
          const r=await fetch({json_dumps(url)},{{method:"GET",credentials:"include",redirect:"manual"}});
          let body; const ct=r.headers.get("content-type")||"";
          try {{ body=ct.includes("json")?await r.json():await r.text(); }} catch(e) {{ body=null; }}
          return {{status:r.status,body,headers:Object.fromEntries(r.headers.entries())}};
        }})()"""
        out = self.evaluator.evaluate(expression)
        return TransportResponse(int(out["status"]), out.get("body"), dict(out.get("headers") or {}))


class PageFunctionTransport(BrowserTransport):
    """Calls a host-installed page function without extracting authorization material.

    The host application/CDP adapter may expose e.g. `globalThis.__gfsAuthorizedBridge.request`.
    The bridge itself remains outside this library and owns authorized browser mechanics.
    """
    def __init__(self, evaluator: PageEvaluator, bridge_name: str = "__gfsAuthorizedBridge"):
        if not bridge_name.replace("_", "").isalnum():
            raise ValueError("bridge_name must be a simple global identifier")
        self.evaluator = evaluator
        self.bridge_name = bridge_name

    def request(self, method: str, url: str, *, json: Any | None = None) -> TransportResponse:
        request = {"method": method.upper(), "url": url, "json": json}
        expression = f"""(async()=>{{
          const b=globalThis[{json_dumps(self.bridge_name)}];
          if(!b || typeof b.request!=="function") throw new Error("GFS authorized page bridge is not installed");
          const r=await b.request({json_dumps(request)});
          return {{status:r.status,body:r.body??null,headers:r.headers??{{}}}};
        }})()"""
        out = self.evaluator.evaluate(expression)
        return TransportResponse(int(out["status"]), out.get("body"), dict(out.get("headers") or {}))


def json_dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))
''')

# Replace ShotGenerationState.transition with real validation.
p = SRC / "state.py"
s = p.read_text(encoding="utf-8")
if "from .production_state_machine import validate_transition" not in s:
    s = s.replace("from .polling import ProductionState\n", "from .polling import ProductionState\nfrom .production_state_machine import validate_transition\n")
s = s.replace('''    def transition(self, next_state: ProductionState) -> None:\n        terminal = {ProductionState.FINAL}\n        if self.state in terminal:\n            raise ValueError(f"Cannot transition finalized shot {self.shot_id}")\n        self.state = next_state\n''', '''    def transition(self, next_state: ProductionState) -> None:\n        _, nxt = validate_transition(self.state, next_state)\n        self.state = nxt\n''')
p.write_text(s, encoding="utf-8")

# Extend workspace with safe listing.
p = SRC / "workspace.py"
s = p.read_text(encoding="utf-8")
insert = r'''
    def list_records(self, kind: str) -> list[dict[str, Any]]:
        folder = self.path / "records" / kind
        if not folder.exists():
            return []
        return [json.loads(p.read_text(encoding="utf-8")) for p in sorted(folder.glob("*.json"))]

    def save_qc_report(self, record_id: str, value: Any) -> Path:
        _assert_persistable(value)
        path = self.path / "qc" / f"{record_id}.json"
        _atomic_json(path, value)
        self._touch()
        return path

    def load_qc_report(self, record_id: str) -> Any | None:
        path = self.path / "qc" / f"{record_id}.json"
        return json.loads(path.read_text(encoding="utf-8")) if path.exists() else None
'''
if "def list_records(self, kind" not in s:
    s = s.rstrip() + "\n\n" + insert
p.write_text(s, encoding="utf-8")

w(SRC / "manifest.py", r'''
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from .artifact_store import ArtifactStore


def build_project_manifest(
    *,
    project_id: str,
    title: str,
    genre: str,
    duration_seconds: float,
    aspect_ratio: str,
    shots: list[dict[str, Any]],
    final_status: str,
    final_status_reason: str,
    warnings: list[dict[str, Any]] | None = None,
    capabilities_used: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    now = datetime.now(timezone.utc).isoformat()
    manifest = {
        "project": {"id": project_id, "title": title, "genre": genre, "duration_seconds": duration_seconds, "aspect_ratio": aspect_ratio, "completed_at": now},
        "creative": {},
        "shots": shots,
        "runtime": {"flow_reference_version": "2.0.0", "capabilities_used": capabilities_used or [], "capabilities_unavailable": [], "errors_encountered": []},
        "warnings": warnings or [],
        "final_status": final_status,
        "final_status_reason": final_status_reason,
    }
    store = ArtifactStore()
    store.write("orchestration/project-manifest-builder", "project_manifest#", manifest)
    return manifest
''')

# Rewrite production engine with lifecycle methods while preserving initialization.
w(SRC / "production_engine.py", r'''
from __future__ import annotations

from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

from .polling import ProductionState, map_runtime_to_production
from .production_state_machine import validate_transition
from .project_orchestrator import ProjectOrchestrator, ProductionRequest
from .qc_runtime import QCRun
from .repair_loop import AttemptAssessment, RepairController, RepairDecision
from .workspace import ProjectWorkspace


@dataclass(frozen=True)
class InitializedProject:
    project_id: str
    workspace: str
    selected_skill_count: int
    deferred_runtime_count: int


class ProductionEngine:
    """Crash-safe coordinator for plan -> runtime record -> QC -> repair -> final state."""

    def __init__(self, workspace_root: str | Path, orchestrator: ProjectOrchestrator | None = None):
        self.workspace_root = Path(workspace_root)
        self.orchestrator = orchestrator or ProjectOrchestrator()

    def initialize(self, project_id: str, request: ProductionRequest, *, title: str = "") -> InitializedProject:
        ws = ProjectWorkspace.create(self.workspace_root, project_id, title=title)
        run = self.orchestrator.run_offline(request)
        ws.save_artifact("production_request", asdict(request))
        ws.save_artifact("production_plan", run.artifacts["production_plan"])
        ws.save_artifact("project_state", run.artifacts["project_state"])
        ws.checkpoint(run.artifacts["project_state"], final_status="PLANNED")
        return InitializedProject(project_id, str(ws.path), len(run.selected_skills), len(run.deferred_runtime))

    def _ws(self, project_id: str) -> ProjectWorkspace:
        return ProjectWorkspace.open(self.workspace_root, project_id)

    def resume(self, project_id: str) -> dict[str, Any]:
        ws = self._ws(project_id)
        return {
            "status": asdict(ws.status()), "request": ws.load_artifact("production_request"),
            "production_plan": ws.load_artifact("production_plan"), "project_state": ws.load_artifact("project_state"),
            "checkpoint": ws.latest_checkpoint(),
        }

    def transition_shot(self, project_id: str, shot_id: str, next_state: ProductionState | str) -> str:
        ws = self._ws(project_id)
        state = ws.load_artifact("project_state", {})
        generation = state.setdefault("generation", {})
        current = ProductionState(generation.get(shot_id, ProductionState.PLANNED.value))
        _, nxt = validate_transition(current, next_state)
        generation[shot_id] = nxt.value
        ws.save_artifact("project_state", state)
        ws.checkpoint(state)
        return nxt.value

    def apply_runtime_status(self, project_id: str, shot_id: str, runtime_status: str) -> str | None:
        mapped = map_runtime_to_production(runtime_status)
        if mapped is None:
            return None
        ws = self._ws(project_id)
        state = ws.load_artifact("project_state", {})
        current = ProductionState(state.setdefault("generation", {}).get(shot_id, ProductionState.QUEUED.value))
        if mapped is ProductionState.ACTIVE and current is ProductionState.QUEUED:
            return self.transition_shot(project_id, shot_id, mapped)
        if mapped in {ProductionState.SUCCESSFUL, ProductionState.FAILED} and current is ProductionState.ACTIVE:
            return self.transition_shot(project_id, shot_id, mapped)
        if mapped is current:
            return mapped.value
        raise ValueError(f"Runtime status {runtime_status} cannot map over production state {current.value}")

    def record_generation(self, project_id: str, record: dict[str, Any]) -> Path:
        ws = self._ws(project_id)
        record_id = str(record["record_id"])
        path = ws.append_record("generation", record_id, record)
        state = ws.load_artifact("project_state", {})
        retries = state.setdefault("retry_counts", {})
        shot_id = str(record["shot_id"])
        retries[shot_id] = max(int(retries.get(shot_id, 0)), int(record.get("attempt", 1)) - 1)
        ws.save_artifact("project_state", state)
        return path

    def record_qc(self, project_id: str, shot_id: str, record_id: str, run: QCRun) -> dict[str, Any]:
        ws = self._ws(project_id)
        current = ws.load_artifact("project_state", {}).get("generation", {}).get(shot_id)
        if current == ProductionState.SUCCESSFUL.value:
            self.transition_shot(project_id, shot_id, ProductionState.QC_PENDING)
        report = run.to_report(shot_id=shot_id, record_id=record_id)
        ws.save_qc_report(record_id, report)
        state = ws.load_artifact("project_state", {})
        state.setdefault("qc", {})[shot_id] = report["verdict"]
        ws.save_artifact("project_state", state)
        target = ProductionState.QC_PASSED if report["verdict"] == "ACCEPT" else ProductionState.QC_FAILED
        self.transition_shot(project_id, shot_id, target)
        if target is ProductionState.QC_FAILED:
            next_state = ProductionState.EDIT_REQUIRED if report["verdict"] == "EDIT_REQUIRED" else ProductionState.REGENERATE_REQUIRED
            self.transition_shot(project_id, shot_id, next_state)
        return report

    def repair_decision(self, project_id: str, shot_id: str, controller: RepairController | None = None) -> RepairDecision:
        ws = self._ws(project_id)
        rows = [r for r in ws.list_records("generation") if r.get("shot_id") == shot_id]
        history: list[AttemptAssessment] = []
        for row in sorted(rows, key=lambda r: int(r.get("attempt", 1))):
            report = ws.load_qc_report(str(row["record_id"])) or {}
            history.append(AttemptAssessment(
                int(row.get("attempt", 1)), float(report.get("overall", 0.0)), str(report.get("verdict", "REGENERATE_REQUIRED")),
                tuple(row.get("parameter_delta_from_previous_attempt") or ()),
            ))
        return (controller or RepairController()).decide(history)

    def finalize_shot(self, project_id: str, shot_id: str) -> str:
        ws = self._ws(project_id)
        state = ws.load_artifact("project_state", {})
        current = ProductionState(state.setdefault("generation", {}).get(shot_id, ProductionState.PLANNED.value))
        if current is not ProductionState.QC_PASSED:
            raise ValueError("Only QC_PASSED shots can be finalized normally")
        return self.transition_shot(project_id, shot_id, ProductionState.FINAL)
''')

# update __init__
p = SRC / "__init__.py"
s = p.read_text(encoding="utf-8")
if "from .production_state_machine" not in s:
    s = s.replace("from .repair_loop import RepairController, RepairAction\n", "from .repair_loop import RepairController, RepairAction\nfrom .production_state_machine import validate_transition, ALLOWED_TRANSITIONS\nfrom .page_bridge import PageFunctionTransport, ReadOnlyPageFetchTransport\n")
    s = s.replace('"RepairController", "RepairAction",\n', '"RepairController", "RepairAction", "validate_transition", "ALLOWED_TRANSITIONS", "PageFunctionTransport", "ReadOnlyPageFetchTransport",\n')
p.write_text(s, encoding="utf-8")

# Tests
w(TESTS / "test_production_state_machine.py", r'''
import pytest
from gfs.polling import ProductionState
from gfs.production_state_machine import validate_transition
from gfs.state import ShotGenerationState


def test_valid_lifecycle_chain():
    chain=["PROMPT_READY","QUEUED","ACTIVE","SUCCESSFUL","QC_PENDING","QC_PASSED","FINAL"]
    s=ShotGenerationState("S01")
    for value in chain: s.transition(ProductionState(value))
    assert s.state is ProductionState.FINAL


def test_invalid_jump_is_rejected():
    with pytest.raises(ValueError): validate_transition("PLANNED","SUCCESSFUL")
''')

w(TESTS / "test_page_bridge.py", r'''
import pytest
from gfs.page_bridge import PageFunctionTransport, ReadOnlyPageFetchTransport


class Eval:
    def __init__(self): self.expressions=[]
    def evaluate(self, expression):
        self.expressions.append(expression); return {"status":200,"body":{"ok":True},"headers":{}}


def test_readonly_transport_refuses_mutation_and_never_reads_cookie_api():
    e=Eval(); t=ReadOnlyPageFetchTransport(e)
    assert t.request("GET","https://labs.google/fx/api/auth/session").status==200
    assert "document.cookie" not in e.expressions[0] and "localStorage" not in e.expressions[0]
    with pytest.raises(PermissionError): t.request("POST","https://example.test",json={})


def test_page_function_bridge_calls_named_host_function():
    e=Eval(); t=PageFunctionTransport(e)
    assert t.request("POST","https://example.test",json={"x":1}).status==200
    assert "__gfsAuthorizedBridge" in e.expressions[0]
''')

w(TESTS / "integration" / "test_persistent_lifecycle.py", r'''
from gfs.production_engine import ProductionEngine
from gfs.project_orchestrator import ProductionRequest
from gfs.qc_runtime import QCEngine


def test_generation_to_qc_to_final_is_persisted(tmp_path):
    engine=ProductionEngine(tmp_path)
    engine.initialize("p1",ProductionRequest("fictional luxury watch","luxury-commercial",product_critical=True))
    assert engine.transition_shot("p1","S01","PROMPT_READY")=="PROMPT_READY"
    assert engine.transition_shot("p1","S01","QUEUED")=="QUEUED"
    assert engine.apply_runtime_status("p1","S01","MEDIA_GENERATION_STATUS_ACTIVE")=="ACTIVE"
    assert engine.apply_runtime_status("p1","S01","MEDIA_GENERATION_STATUS_SUCCESSFUL")=="SUCCESSFUL"
    media=tmp_path/"ok.mp4"; media.write_bytes(b"\x00\x00\x00\x18ftypisom"+b"x"*200)
    record={"record_id":"r1","shot_id":"S01","attempt":1,"method":"reference","model_key":"abra_r2v_4s","production_state":"SUCCESSFUL","parameter_delta_from_previous_attempt":[]}
    engine.record_generation("p1",record)
    report=engine.record_qc("p1","S01","r1",QCEngine().evaluate(str(media)))
    assert report["verdict"]=="ACCEPT"
    assert engine.finalize_shot("p1","S01")=="FINAL"
    assert engine.resume("p1")["project_state"]["generation"]["S01"]=="FINAL"
''')

# Canonical rebuild: regeneration -> executable layers -> pointer contract -> docs -> registry -> tests -> cases -> semantic audit.
w(ROOT / "tools" / "rebuild_repository.py", r'''
"""Rebuild generated repository state in canonical, non-live order."""
from __future__ import annotations
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PY = sys.executable


def run(args, *, env=None):
    print("+", " ".join(map(str,args)))
    subprocess.run(args, cwd=ROOT, env=env, check=True)


for script in (
    "bootstrap_system.py", "generate_skills.py", "expand_skills.py", "render_docs.py",
    "add_pipeline.py", "apply_pointer_ownership.py", "postprocess_skill_graph.py", "finalize_phase2_docs.py",
):
    run([PY, str(ROOT / "tools" / script)])

env = os.environ.copy()
env["PYTHONPATH"] = str(ROOT / "src") + (os.pathsep + env["PYTHONPATH"] if env.get("PYTHONPATH") else "")
run([PY, "-m", "gfs.registry_build", "--root", str(ROOT)], env=env)
run([PY, "-m", "pytest", "-q"], env=env)
run([PY, "-m", "gfs.cli", "cases"], env=env)
run([PY, str(ROOT / "tools" / "audit_semantics.py")], env=env)
print("Repository rebuild complete: no live browser or credit-spending operation was executed")
''')

# CI workflow
w(ROOT / ".github" / "workflows" / "ci.yml", r'''
name: offline-ci
on:
  push:
  pull_request:
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: '3.12'
      - run: python -m pip install -e .
      - run: python -m gfs.registry_build --root .
      - run: pytest -q
      - run: gfs cases
      - run: python tools/audit_semantics.py
''')

# docs
p = DOCS / "RUNTIME_EXECUTION.md"
s = p.read_text(encoding="utf-8")
add = r'''

## Host browser bridges

`ReadOnlyPageFetchTransport` supports same-browser GET smoke checks without reading cookies or localStorage. `PageFunctionTransport` calls a host-installed `globalThis.__gfsAuthorizedBridge.request(...)` function; authorization material stays inside the host/browser implementation and is never returned to GFS. This is the supported integration seam for live Flow mutation.

## Persistent lifecycle

`ProductionEngine` enforces the production state machine: `PLANNED -> PROMPT_READY -> QUEUED -> ACTIVE -> SUCCESSFUL -> QC_PENDING -> QC_PASSED -> FINAL`, with explicit failed/edit/regenerate branches. Invalid jumps are rejected. Generation records, QC reports, retry counts, and checkpoints are written atomically so a project can resume after process failure.
'''
if "## Host browser bridges" not in s:
    s += dedent(add)
p.write_text(s, encoding="utf-8")

print("Installed strict lifecycle, host browser bridge, persistent QC integration, canonical rebuild, and CI")
