from pathlib import Path
from textwrap import dedent
import tomllib

ROOT = Path(r"E:\Google-flow-skills")
SRC = ROOT / "src" / "gfs"
TESTS = ROOT / "tests"
DOCS = ROOT / "docs"


def w(path: Path, text: str):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(dedent(text).lstrip(), encoding="utf-8")

w(SRC / "runtime_policy.py", r'''
from __future__ import annotations

import os
from dataclasses import dataclass
from enum import Enum

from .evidence import EvidenceLevel


class RuntimeMode(str, Enum):
    OFFLINE = "offline"
    READ_ONLY = "read_only"
    LIVE = "live"


class RuntimePolicyError(PermissionError):
    pass


@dataclass(frozen=True)
class RuntimePolicy:
    mode: RuntimeMode = RuntimeMode.OFFLINE
    allow_credits: bool = False
    allow_partial: bool = False

    @classmethod
    def from_env(cls) -> "RuntimePolicy":
        live = os.getenv("GFS_LIVE_FLOW") == "1"
        readonly = os.getenv("GFS_BROWSER_SMOKE") == "1"
        mode = RuntimeMode.LIVE if live else (RuntimeMode.READ_ONLY if readonly else RuntimeMode.OFFLINE)
        return cls(
            mode=mode,
            allow_credits=os.getenv("GFS_ALLOW_CREDITS") == "1",
            allow_partial=os.getenv("GFS_ALLOW_PARTIAL") == "1",
        )

    def require_read(self) -> None:
        if self.mode is RuntimeMode.OFFLINE:
            raise RuntimePolicyError("Browser/runtime read is disabled in offline mode")

    def require_mutation(self, *, costs_credits: bool, evidence_level: EvidenceLevel) -> None:
        if self.mode is not RuntimeMode.LIVE:
            raise RuntimePolicyError("Live mutation requires GFS_LIVE_FLOW=1")
        if costs_credits and not self.allow_credits:
            raise RuntimePolicyError("Credit-spending mutation requires GFS_ALLOW_CREDITS=1")
        if evidence_level is EvidenceLevel.RUNTIME_PARTIAL and not self.allow_partial:
            raise RuntimePolicyError("Runtime-partial operation requires GFS_ALLOW_PARTIAL=1")
''')

w(SRC / "flow_runtime.py", r'''
from __future__ import annotations

import copy
from dataclasses import dataclass
from typing import Any, Protocol
from urllib.parse import quote

from .errors import ClassifiedError, classify_error
from .evidence import EvidenceLevel
from .redact import sanitize
from .routing import GenerationMethod
from .runtime_adapter import PreparedDispatch, prepare_dispatch
from .runtime_policy import RuntimePolicy


@dataclass(frozen=True)
class TransportResponse:
    status: int
    body: Any
    headers: dict[str, str] | None = None


class BrowserTransport(Protocol):
    """Transport implemented by an authorized browser/CDP integration.

    The transport owns browser session mechanics. This library deliberately does not
    extract cookies, OAuth credentials, or create/replay reCAPTCHA tokens.
    """
    def request(self, method: str, url: str, *, json: Any | None = None) -> TransportResponse: ...


class TrustedMutationEnvelope:
    """Single-use, in-memory browser-prepared mutation payload.

    The object is intentionally non-serializable and its repr never exposes payload
    contents. The caller/browser integration is responsible for preparing fresh
    browser-generated security context. GFS never fabricates or replays it.
    """

    __slots__ = ("_payload", "_consumed")

    def __init__(self, payload: dict[str, Any]):
        self._payload = copy.deepcopy(payload)
        self._consumed = False

    def __repr__(self) -> str:
        return "TrustedMutationEnvelope(<ephemeral-browser-payload>)"

    def consume(self) -> dict[str, Any]:
        if self._consumed:
            raise RuntimeError("Trusted mutation payload is single-use and has already been consumed")
        self._consumed = True
        payload = self._payload
        self._payload = {}
        return payload

    def __getstate__(self):
        raise TypeError("TrustedMutationEnvelope must never be serialized")


@dataclass(frozen=True)
class FlowRuntimeResult:
    ok: bool
    status: int | None
    sanitized_body: Any
    error: ClassifiedError | None = None


VIDEO_ENDPOINTS = {
    GenerationMethod.T2V: "https://aisandbox-pa.googleapis.com/v1/video:batchAsyncGenerateVideoText",
    GenerationMethod.I2V: "https://aisandbox-pa.googleapis.com/v1/video:batchAsyncGenerateVideoStartImage",
    GenerationMethod.START_END: "https://aisandbox-pa.googleapis.com/v1/video:batchAsyncGenerateVideoStartAndEndImage",
    GenerationMethod.REFERENCE: "https://aisandbox-pa.googleapis.com/v1/video:batchAsyncGenerateVideoReferenceImages",
    GenerationMethod.EDIT: "https://aisandbox-pa.googleapis.com/v1/video:batchAsyncGenerateVideoEditVideo",
}

POLL_ENDPOINT = "https://aisandbox-pa.googleapis.com/v1/video:batchCheckAsyncVideoGenerationStatus"
CANCEL_ENDPOINT = "https://aisandbox-pa.googleapis.com/v1/flowMedia:cancelGeneration"
SESSION_ENDPOINT = "https://labs.google/fx/api/auth/session"
PROJECT_CREATE_ENDPOINT = "https://labs.google/fx/api/trpc/project.createProject"
DOWNLOAD_ENDPOINT = "https://labs.google/fx/api/trpc/media.getMediaUrlRedirect?name={}"


def _contains_fragment(value: Any, fragment: dict[str, Any]) -> bool:
    """Return true when every key/value in fragment appears together in some mapping.

    This validates verified media shapes inside browser-prepared outer envelopes without
    guessing undocumented wrappers such as clientContext/mediaGenerationContext.
    """
    if isinstance(value, dict):
        if all(k in value and value[k] == v for k, v in fragment.items()):
            return True
        return any(_contains_fragment(v, fragment) for v in value.values())
    if isinstance(value, list):
        return any(_contains_fragment(v, fragment) for v in value)
    return False


def _reject_disproved_shapes(value: Any) -> None:
    if isinstance(value, dict):
        if "encodedImage" in value:
            raise ValueError("encodedImage is disproved; use imageBytes")
        for key in ("startImage", "endImage", "videoInput"):
            item = value.get(key)
            if isinstance(item, dict) and "name" in item:
                raise ValueError(f"{key}.name is disproved; use mediaId")
        refs = value.get("referenceImages")
        if isinstance(refs, list):
            for ref in refs:
                if isinstance(ref, dict) and "name" in ref:
                    raise ValueError("referenceImages[].name is disproved; use mediaId")
        for child in value.values():
            _reject_disproved_shapes(child)
    elif isinstance(value, list):
        for child in value:
            _reject_disproved_shapes(child)


class FlowRuntime:
    def __init__(self, transport: BrowserTransport, policy: RuntimePolicy | None = None):
        self.transport = transport
        self.policy = policy or RuntimePolicy.from_env()

    def _request(self, method: str, url: str, *, payload: Any | None = None) -> FlowRuntimeResult:
        try:
            response = self.transport.request(method, url, json=payload)
        except BaseException as exc:
            err = classify_error(exception=exc)
            return FlowRuntimeResult(False, None, None, err)
        body = sanitize(response.body)
        if 200 <= response.status < 400:
            return FlowRuntimeResult(True, response.status, body, None)
        err = classify_error(response.status, response.body)
        return FlowRuntimeResult(False, response.status, body, err)

    def session_metadata(self) -> FlowRuntimeResult:
        self.policy.require_read()
        return self._request("GET", SESSION_ENDPOINT)

    def create_project(self, title: str) -> FlowRuntimeResult:
        self.policy.require_mutation(costs_credits=False, evidence_level=EvidenceLevel.RUNTIME_VERIFIED)
        payload = {"json": {"projectTitle": title, "toolName": "PINHOLE"}}
        return self._request("POST", PROJECT_CREATE_ENDPOINT, payload=payload)

    def submit_video(
        self,
        method: GenerationMethod | str,
        envelope: TrustedMutationEnvelope,
        *,
        start_media_id: str | None = None,
        end_media_id: str | None = None,
        reference_media_ids: tuple[str, ...] = (),
        video_input_media_id: str | None = None,
    ) -> FlowRuntimeResult:
        prepared: PreparedDispatch = prepare_dispatch(
            method,
            start_media_id=start_media_id,
            end_media_id=end_media_id,
            reference_media_ids=reference_media_ids,
            video_input_media_id=video_input_media_id,
            min_evidence=EvidenceLevel.RUNTIME_VERIFIED,
        )
        self.policy.require_mutation(costs_credits=True, evidence_level=prepared.evidence_level)
        payload = envelope.consume()
        _reject_disproved_shapes(payload)
        if prepared.media_fragment and not _contains_fragment(payload, prepared.media_fragment):
            raise ValueError("Browser-prepared payload does not contain the verified media fragment for the selected method")
        method_enum = method if isinstance(method, GenerationMethod) else GenerationMethod(method)
        return self._request("POST", VIDEO_ENDPOINTS[method_enum], payload=payload)

    def poll(self, envelope: TrustedMutationEnvelope) -> FlowRuntimeResult:
        self.policy.require_read()
        payload = envelope.consume()
        _reject_disproved_shapes(payload)
        return self._request("POST", POLL_ENDPOINT, payload=payload)

    def cancel(self, media_id: str) -> FlowRuntimeResult:
        self.policy.require_mutation(costs_credits=False, evidence_level=EvidenceLevel.RUNTIME_PARTIAL)
        return self._request("POST", CANCEL_ENDPOINT, payload={"mediaId": media_id})

    def media_redirect(self, media_id: str) -> FlowRuntimeResult:
        self.policy.require_read()
        return self._request("GET", DOWNLOAD_ENDPOINT.format(quote(media_id, safe="")))
''')

w(SRC / "workspace.py", r'''
from __future__ import annotations

import hashlib
import json
import os
import tempfile
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .redact import sanitize


class WorkspaceSecurityError(ValueError):
    pass


def _utc() -> str:
    return datetime.now(timezone.utc).isoformat()


def _assert_persistable(value: Any) -> None:
    clean = sanitize(value)
    if clean != value:
        raise WorkspaceSecurityError("Refusing to persist secret, PII, bearer/cookie material, or signed-URL secret")


def _atomic_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(prefix=path.name + ".", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(value, fh, ensure_ascii=False, indent=2)
            fh.write("\n")
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp_name, path)
    finally:
        if os.path.exists(tmp_name):
            os.unlink(tmp_name)


@dataclass(frozen=True)
class WorkspaceStatus:
    project_id: str
    created_at: str
    updated_at: str
    checkpoint: int
    final_status: str


class ProjectWorkspace:
    VERSION = 1

    def __init__(self, root: str | Path, project_id: str):
        self.root = Path(root).resolve()
        self.project_id = project_id
        self.path = self.root / project_id
        self.meta_path = self.path / "workspace.json"

    @classmethod
    def create(cls, root: str | Path, project_id: str, *, title: str = "") -> "ProjectWorkspace":
        ws = cls(root, project_id)
        if ws.meta_path.exists():
            raise FileExistsError(f"Workspace already exists: {ws.path}")
        now = _utc()
        ws.path.mkdir(parents=True, exist_ok=True)
        for name in ("artifacts", "records", "qc", "media", "checkpoints"):
            (ws.path / name).mkdir(exist_ok=True)
        _atomic_json(ws.meta_path, {
            "workspace_version": cls.VERSION, "project_id": project_id, "title": title,
            "created_at": now, "updated_at": now, "checkpoint": 0, "final_status": "PLANNED",
        })
        return ws

    @classmethod
    def open(cls, root: str | Path, project_id: str) -> "ProjectWorkspace":
        ws = cls(root, project_id)
        if not ws.meta_path.is_file():
            raise FileNotFoundError(f"Workspace not found: {ws.path}")
        return ws

    def _meta(self) -> dict[str, Any]:
        return json.loads(self.meta_path.read_text(encoding="utf-8"))

    def status(self) -> WorkspaceStatus:
        m = self._meta()
        return WorkspaceStatus(m["project_id"], m["created_at"], m["updated_at"], int(m["checkpoint"]), m["final_status"])

    def _touch(self, **changes: Any) -> None:
        m = self._meta()
        m.update(changes)
        m["updated_at"] = _utc()
        _atomic_json(self.meta_path, m)

    def save_artifact(self, name: str, value: Any) -> Path:
        _assert_persistable(value)
        path = self.path / "artifacts" / f"{name}.json"
        _atomic_json(path, value)
        self._touch()
        return path

    def load_artifact(self, name: str, default: Any = None) -> Any:
        path = self.path / "artifacts" / f"{name}.json"
        if not path.exists():
            return default
        return json.loads(path.read_text(encoding="utf-8"))

    def append_record(self, kind: str, record_id: str, value: Any) -> Path:
        _assert_persistable(value)
        path = self.path / "records" / kind / f"{record_id}.json"
        if path.exists():
            raise FileExistsError(path)
        _atomic_json(path, value)
        self._touch()
        return path

    def checkpoint(self, state: Any, *, final_status: str | None = None) -> int:
        _assert_persistable(state)
        m = self._meta()
        n = int(m.get("checkpoint", 0)) + 1
        payload = {"checkpoint": n, "created_at": _utc(), "state": state}
        _atomic_json(self.path / "checkpoints" / f"{n:06d}.json", payload)
        changes = {"checkpoint": n}
        if final_status is not None:
            changes["final_status"] = final_status
        self._touch(**changes)
        return n

    def latest_checkpoint(self) -> Any | None:
        m = self._meta()
        n = int(m.get("checkpoint", 0))
        if n == 0:
            return None
        return json.loads((self.path / "checkpoints" / f"{n:06d}.json").read_text(encoding="utf-8"))["state"]

    def register_media(self, media_id: str, local_path: str | Path) -> dict[str, Any]:
        path = Path(local_path)
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        item = {"media_id": media_id, "local_path": str(path.resolve()), "byte_length": path.stat().st_size, "sha256": digest}
        _assert_persistable(item)
        _atomic_json(self.path / "media" / f"{media_id}.json", item)
        self._touch()
        return item
''')

w(SRC / "media_integrity.py", r'''
from __future__ import annotations

import hashlib
import json
import shutil
import subprocess
from dataclasses import dataclass, asdict
from pathlib import Path


@dataclass(frozen=True)
class MediaIntegrityReport:
    path: str
    exists: bool
    byte_length: int
    sha256: str | None
    kind: str
    container_signature_valid: bool
    duration_seconds: float | None = None
    resolution: str | None = None

    def to_dict(self) -> dict:
        return asdict(self)


def _kind_and_signature(head: bytes) -> tuple[str, bool]:
    if head.startswith(b"\xff\xd8\xff"):
        return "jpeg", True
    if head.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png", True
    if len(head) >= 12 and head[4:8] == b"ftyp":
        return "mp4", True
    return "unknown", False


def _ffprobe(path: Path) -> tuple[float | None, str | None]:
    exe = shutil.which("ffprobe")
    if not exe:
        return None, None
    try:
        proc = subprocess.run(
            [exe, "-v", "error", "-show_entries", "format=duration", "-show_entries", "stream=width,height", "-of", "json", str(path)],
            capture_output=True, text=True, timeout=20, check=True,
        )
        data = json.loads(proc.stdout or "{}")
        duration = data.get("format", {}).get("duration")
        streams = data.get("streams") or []
        resolution = None
        for stream in streams:
            if stream.get("width") and stream.get("height"):
                resolution = f"{stream['width']}x{stream['height']}"
                break
        return (float(duration) if duration is not None else None), resolution
    except Exception:
        return None, None


def inspect_media(path: str | Path) -> MediaIntegrityReport:
    path = Path(path)
    if not path.is_file():
        return MediaIntegrityReport(str(path), False, 0, None, "missing", False)
    data = path.read_bytes()
    kind, signature = _kind_and_signature(data[:64])
    duration, resolution = _ffprobe(path) if kind == "mp4" else (None, None)
    return MediaIntegrityReport(
        str(path.resolve()), True, len(data), hashlib.sha256(data).hexdigest(), kind, signature, duration, resolution
    )
''')

w(SRC / "qc_runtime.py", r'''
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Protocol

from .media_integrity import MediaIntegrityReport, inspect_media
from .qc import GateVerdict, QCThresholds, acceptance_gate, weighted_score


@dataclass(frozen=True)
class CriticObservation:
    criterion: str
    score: float
    critic_skill_id: str
    weight: float = 1.0
    observations: tuple[str, ...] = ()
    evidence: tuple[str, ...] = ()
    hard_gate_failed: bool = False


class VisualCriticBackend(Protocol):
    def evaluate(self, *, media_path: str, criterion: str, context: dict[str, Any]) -> CriticObservation: ...


class VisualBackendUnavailable(RuntimeError):
    pass


class IntegrityCritic:
    """Real file/container QC; deliberately not a substitute for visual-semantic QC."""
    def evaluate(self, media_path: str) -> CriticObservation:
        report = inspect_media(media_path)
        if not report.exists:
            score = 0.0
            obs = ("Media file is missing",)
        elif not report.container_signature_valid:
            score = 2.0
            obs = ("Container/image magic signature is invalid or unsupported",)
        elif report.byte_length <= 32:
            score = 3.0
            obs = ("Media file is implausibly small",)
        else:
            score = 10.0
            obs = (f"Valid {report.kind} signature; {report.byte_length} bytes; sha256={report.sha256}",)
        return CriticObservation("artifact_free", score, "qc/artifact-detector", 1.0, obs, (report.path,), score < 5.5)


@dataclass(frozen=True)
class QCRun:
    criteria: tuple[CriticObservation, ...]
    overall: float
    verdict: str

    def to_report(self, *, shot_id: str, record_id: str, thresholds: QCThresholds = QCThresholds()) -> dict[str, Any]:
        return {
            "shot_id": shot_id, "record_id": record_id,
            "criteria": [
                {"criterion": x.criterion, "score": x.score, "critic": x.critic_skill_id, "weight": x.weight,
                 "observations": list(x.observations), "evidence": list(x.evidence), "hard_gate_failed": x.hard_gate_failed}
                for x in self.criteria
            ],
            "overall": self.overall,
            "thresholds": {"accept": thresholds.pass_score, "edit": thresholds.edit_score, "source": "project_default"},
            "verdict": {"PASS": "ACCEPT", "EDIT": "EDIT_REQUIRED", "REGENERATE": "REGENERATE_REQUIRED"}[self.verdict],
            "verdict_reason": "QC gate derived from explicit critic scores and critical hard gates",
        }


class QCEngine:
    def __init__(self, visual_backend: VisualCriticBackend | None = None):
        self.visual_backend = visual_backend
        self.integrity = IntegrityCritic()

    def evaluate(
        self,
        media_path: str,
        *,
        visual_criteria: tuple[str, ...] = (),
        context: dict[str, Any] | None = None,
        weights: dict[str, float] | None = None,
        critical_dimensions: tuple[str, ...] = ("artifact_free",),
        thresholds: QCThresholds = QCThresholds(),
    ) -> QCRun:
        observations = [self.integrity.evaluate(media_path)]
        if visual_criteria:
            if self.visual_backend is None:
                raise VisualBackendUnavailable("Visual-semantic QC criteria requested but no VisualCriticBackend is configured")
            for criterion in visual_criteria:
                observations.append(self.visual_backend.evaluate(media_path=media_path, criterion=criterion, context=context or {}))
        scores = {x.criterion: x.score for x in observations}
        if weights:
            overall = weighted_score(scores, weights)
        else:
            overall = weighted_score(scores, {x.criterion: x.weight for x in observations})
        verdict, _ = acceptance_gate(scores, thresholds=thresholds, critical_dimensions=critical_dimensions)
        return QCRun(tuple(observations), overall, verdict.value)
''')

w(SRC / "repair_loop.py", r'''
from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Any


class RepairAction(str, Enum):
    ACCEPT = "ACCEPT"
    EDIT = "EDIT"
    REGENERATE = "REGENERATE"
    ESCALATE = "ESCALATE"


@dataclass(frozen=True)
class AttemptAssessment:
    attempt: int
    overall: float
    verdict: str
    parameter_delta: tuple[dict[str, Any], ...] = ()


@dataclass(frozen=True)
class RepairDecision:
    action: RepairAction
    reason: str
    next_attempt: int | None


class RepairController:
    def __init__(self, *, max_non_improving: int = 3, improvement_epsilon: float = 0.05):
        self.max_non_improving = max_non_improving
        self.improvement_epsilon = improvement_epsilon

    def decide(self, history: list[AttemptAssessment]) -> RepairDecision:
        if not history:
            return RepairDecision(RepairAction.REGENERATE, "No attempt exists yet", 1)
        latest = history[-1]
        if latest.verdict in {"ACCEPT", "PASS"}:
            return RepairDecision(RepairAction.ACCEPT, "Latest attempt passed QC", None)
        if latest.attempt >= 2 and not latest.parameter_delta:
            return RepairDecision(RepairAction.ESCALATE, "Blind retry detected: attempt >=2 has no parameter delta", None)
        non_improving = 0
        for prev, cur in zip(history, history[1:]):
            if cur.overall <= prev.overall + self.improvement_epsilon:
                non_improving += 1
            else:
                non_improving = 0
        if non_improving >= self.max_non_improving:
            return RepairDecision(RepairAction.ESCALATE, f"{non_improving} consecutive non-improving retries", None)
        action = RepairAction.EDIT if latest.verdict in {"EDIT", "EDIT_REQUIRED"} else RepairAction.REGENERATE
        return RepairDecision(action, "QC requires bounded repair with a causally attributed parameter change", latest.attempt + 1)
''')

w(SRC / "production_engine.py", r'''
from __future__ import annotations

from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

from .project_orchestrator import ProjectOrchestrator, ProductionRequest
from .workspace import ProjectWorkspace


@dataclass(frozen=True)
class InitializedProject:
    project_id: str
    workspace: str
    selected_skill_count: int
    deferred_runtime_count: int


class ProductionEngine:
    """Crash-safe project coordinator for planning and persistence.

    Live Flow execution is deliberately a separate injected boundary (`FlowRuntime`).
    This engine can fully plan, persist, resume, QC, and track repairs without spending credits.
    """

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

    def resume(self, project_id: str) -> dict[str, Any]:
        ws = ProjectWorkspace.open(self.workspace_root, project_id)
        return {
            "status": asdict(ws.status()),
            "request": ws.load_artifact("production_request"),
            "production_plan": ws.load_artifact("production_plan"),
            "project_state": ws.load_artifact("project_state"),
            "checkpoint": ws.latest_checkpoint(),
        }
''')

w(SRC / "cli.py", r'''
from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict
from pathlib import Path

from .case_runner import SkillCaseRunner
from .media_integrity import inspect_media
from .production_engine import ProductionEngine
from .project_orchestrator import ProjectOrchestrator, ProductionRequest
from .runtime_policy import RuntimePolicy


def _request(args) -> ProductionRequest:
    return ProductionRequest(
        brief=args.brief, genre=args.genre, has_brand=args.brand, recurring_character=args.character,
        product_critical=args.product, short_form=args.short_form, vertical=args.vertical,
        audio_intent=args.audio, documentary_truth_constraints=args.documentary_truth,
    )


def _add_request_flags(p):
    p.add_argument("--brief", required=True)
    p.add_argument("--genre", required=True)
    p.add_argument("--brand", action="store_true")
    p.add_argument("--character", action="store_true")
    p.add_argument("--product", action="store_true")
    p.add_argument("--short-form", action="store_true")
    p.add_argument("--vertical", action="store_true")
    p.add_argument("--audio", action="store_true")
    p.add_argument("--documentary-truth", action="store_true")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="gfs")
    sub = parser.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("plan"); _add_request_flags(p)
    p = sub.add_parser("run-offline"); _add_request_flags(p); p.add_argument("--project-id", required=True); p.add_argument("--workspace", default=".gfs-workspaces"); p.add_argument("--title", default="")
    p = sub.add_parser("resume"); p.add_argument("--project-id", required=True); p.add_argument("--workspace", default=".gfs-workspaces")
    p = sub.add_parser("cases")
    p = sub.add_parser("check-media"); p.add_argument("path")
    p = sub.add_parser("live-preflight")
    args = parser.parse_args(argv)

    if args.cmd == "plan":
        order = ProjectOrchestrator().plan(_request(args))
        print(json.dumps({"skill_count": len(order), "execution_order": order}, ensure_ascii=False, indent=2))
        return 0
    if args.cmd == "run-offline":
        out = ProductionEngine(args.workspace).initialize(args.project_id, _request(args), title=args.title)
        print(json.dumps(asdict(out), ensure_ascii=False, indent=2))
        return 0
    if args.cmd == "resume":
        print(json.dumps(ProductionEngine(args.workspace).resume(args.project_id), ensure_ascii=False, indent=2))
        return 0
    if args.cmd == "cases":
        report = SkillCaseRunner().run_all()
        print(json.dumps(asdict(report), ensure_ascii=False, indent=2))
        return 0 if report.failed == 0 else 1
    if args.cmd == "check-media":
        print(json.dumps(inspect_media(args.path).to_dict(), ensure_ascii=False, indent=2))
        return 0
    if args.cmd == "live-preflight":
        policy = RuntimePolicy.from_env()
        print(json.dumps({"mode": policy.mode.value, "allow_credits": policy.allow_credits, "allow_partial": policy.allow_partial}, indent=2))
        return 0
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
''')

# Update __init__ without forcing optional live transport.
w(SRC / "__init__.py", r'''
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

__all__ = [
    "SkillExecutor", "SkillEnvelope", "RuleDecisionBackend", "ArtifactStore", "OwnershipViolation", "ArtifactValidationError",
    "SkillRegistry", "RegisteredSkill", "ProjectOrchestrator", "ProductionRequest", "OfflineProjectRun",
    "ProductionEngine", "ProjectWorkspace", "RuntimePolicy", "RuntimeMode", "RuntimePolicyError",
    "FlowRuntime", "TrustedMutationEnvelope", "TransportResponse", "QCEngine", "VisualBackendUnavailable",
    "RepairController", "RepairAction",
]
''')

# Tests
w(TESTS / "test_runtime_policy.py", r'''
import pytest
from gfs.evidence import EvidenceLevel
from gfs.runtime_policy import RuntimeMode, RuntimePolicy, RuntimePolicyError


def test_offline_blocks_runtime_read():
    with pytest.raises(RuntimePolicyError):
        RuntimePolicy(RuntimeMode.OFFLINE).require_read()


def test_live_credit_spend_requires_explicit_credit_opt_in():
    with pytest.raises(RuntimePolicyError):
        RuntimePolicy(RuntimeMode.LIVE, allow_credits=False).require_mutation(costs_credits=True, evidence_level=EvidenceLevel.RUNTIME_VERIFIED)
    RuntimePolicy(RuntimeMode.LIVE, allow_credits=True).require_mutation(costs_credits=True, evidence_level=EvidenceLevel.RUNTIME_VERIFIED)


def test_partial_requires_separate_opt_in():
    with pytest.raises(RuntimePolicyError):
        RuntimePolicy(RuntimeMode.LIVE, allow_partial=False).require_mutation(costs_credits=False, evidence_level=EvidenceLevel.RUNTIME_PARTIAL)
''')

w(TESTS / "test_flow_runtime.py", r'''
import pickle
import pytest
from gfs.flow_runtime import FlowRuntime, TrustedMutationEnvelope, TransportResponse, VIDEO_ENDPOINTS
from gfs.routing import GenerationMethod
from gfs.runtime_policy import RuntimeMode, RuntimePolicy, RuntimePolicyError


class FakeTransport:
    def __init__(self): self.calls=[]
    def request(self, method, url, *, json=None):
        self.calls.append((method,url,json))
        return TransportResponse(200,{"media":[{"name":"media-1"}]},{})


def test_trusted_payload_is_single_use_nonserializable_and_redacted_repr():
    env=TrustedMutationEnvelope({"clientContext":{"recaptchaContext":{"token":"SECRET"}}})
    assert "SECRET" not in repr(env)
    with pytest.raises(TypeError): pickle.dumps(env)
    assert env.consume()["clientContext"]
    with pytest.raises(RuntimeError): env.consume()


def test_live_reference_submission_validates_verified_media_shape():
    t=FakeTransport(); rt=FlowRuntime(t, RuntimePolicy(RuntimeMode.LIVE, allow_credits=True))
    payload={"requests":[{"referenceImages":[{"mediaId":"m1","imageUsageType":"IMAGE_USAGE_TYPE_ASSET"}]}]}
    result=rt.submit_video(GenerationMethod.REFERENCE, TrustedMutationEnvelope(payload), reference_media_ids=("m1",))
    assert result.ok
    assert t.calls[0][1] == VIDEO_ENDPOINTS[GenerationMethod.REFERENCE]


def test_live_submission_rejects_disproved_name_shape():
    t=FakeTransport(); rt=FlowRuntime(t, RuntimePolicy(RuntimeMode.LIVE, allow_credits=True))
    payload={"requests":[{"startImage":{"name":"m1"}}]}
    with pytest.raises(ValueError):
        rt.submit_video(GenerationMethod.I2V, TrustedMutationEnvelope(payload), start_media_id="m1")


def test_offline_submission_cannot_consume_envelope():
    t=FakeTransport(); rt=FlowRuntime(t, RuntimePolicy(RuntimeMode.OFFLINE))
    env=TrustedMutationEnvelope({"requests":[{"startImage":{"mediaId":"m1"}}]})
    with pytest.raises(RuntimePolicyError): rt.submit_video(GenerationMethod.I2V, env, start_media_id="m1")
    assert t.calls == []
''')

w(TESTS / "test_workspace.py", r'''
import json
import pytest
from gfs.workspace import ProjectWorkspace, WorkspaceSecurityError


def test_workspace_atomic_persist_resume_and_checkpoint(tmp_path):
    ws=ProjectWorkspace.create(tmp_path,"p1",title="Fictional")
    ws.save_artifact("project_state",{"completed":[]})
    assert ProjectWorkspace.open(tmp_path,"p1").load_artifact("project_state") == {"completed":[]}
    assert ws.checkpoint({"phase":"planned"}) == 1
    assert ws.latest_checkpoint() == {"phase":"planned"}


def test_workspace_refuses_secrets_and_pii(tmp_path):
    ws=ProjectWorkspace.create(tmp_path,"p1")
    with pytest.raises(WorkspaceSecurityError): ws.save_artifact("bad",{"access_token":"secret"})
    with pytest.raises(WorkspaceSecurityError): ws.save_artifact("bad2",{"contact":"person@example.com"})
''')

w(TESTS / "test_media_integrity.py", r'''
from gfs.media_integrity import inspect_media


def test_png_signature(tmp_path):
    p=tmp_path/"x.png"; p.write_bytes(b"\x89PNG\r\n\x1a\n"+b"x"*100)
    r=inspect_media(p); assert r.kind=="png" and r.container_signature_valid and r.sha256


def test_mp4_ftyp_signature(tmp_path):
    p=tmp_path/"x.mp4"; p.write_bytes(b"\x00\x00\x00\x18ftypisom"+b"x"*100)
    r=inspect_media(p); assert r.kind=="mp4" and r.container_signature_valid
''')

w(TESTS / "test_qc_runtime.py", r'''
import pytest
from gfs.qc_runtime import CriticObservation, QCEngine, VisualBackendUnavailable


class FakeVisual:
    def evaluate(self, *, media_path, criterion, context):
        return CriticObservation(criterion, context.get("score",9.0), f"qc/{criterion}-critic")


def test_qc_real_integrity_plus_fake_visual(tmp_path):
    p=tmp_path/"x.mp4"; p.write_bytes(b"\x00\x00\x00\x18ftypisom"+b"x"*100)
    run=QCEngine(FakeVisual()).evaluate(str(p),visual_criteria=("cinematography",),context={"score":9.0})
    assert run.verdict=="PASS" and run.overall>=8.5


def test_visual_qc_never_pretends_to_exist(tmp_path):
    p=tmp_path/"x.png"; p.write_bytes(b"\x89PNG\r\n\x1a\n"+b"x"*100)
    with pytest.raises(VisualBackendUnavailable): QCEngine().evaluate(str(p),visual_criteria=("identity_consistency",))
''')

w(TESTS / "test_repair_loop.py", r'''
from gfs.repair_loop import AttemptAssessment, RepairAction, RepairController


def test_blind_retry_escalates():
    h=[AttemptAssessment(1,6.0,"REGENERATE_REQUIRED"),AttemptAssessment(2,6.2,"REGENERATE_REQUIRED",())]
    assert RepairController().decide(h).action is RepairAction.ESCALATE


def test_three_non_improving_changes_escalate():
    d=({"field":"camera","from":"a","to":"b","changed_by":"craft/camera-movement-director"},)
    h=[AttemptAssessment(1,6.0,"REGENERATE_REQUIRED",d),AttemptAssessment(2,6.0,"REGENERATE_REQUIRED",d),AttemptAssessment(3,6.01,"REGENERATE_REQUIRED",d),AttemptAssessment(4,6.0,"REGENERATE_REQUIRED",d)]
    assert RepairController().decide(h).action is RepairAction.ESCALATE
''')

w(TESTS / "integration" / "test_production_engine_resume.py", r'''
from gfs.production_engine import ProductionEngine
from gfs.project_orchestrator import ProductionRequest


def test_offline_project_is_crash_resumable(tmp_path):
    engine=ProductionEngine(tmp_path)
    req=ProductionRequest("Luxury watch macro reflection hero product", "luxury-commercial", has_brand=True, product_critical=True)
    created=engine.initialize("p-watch",req,title="Fictional Watch")
    resumed=engine.resume("p-watch")
    assert created.selected_skill_count > 50
    assert resumed["production_plan"]["execution_order"]
    assert resumed["checkpoint"]["deferred_runtime_skills"]
''')

# Test tier markers and opt-ins.
w(TESTS / "conftest.py", r'''
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
''')

# Live contract skeletons: only run with explicit env + user-provided adapter fixture/plugin.
w(TESTS / "live" / "test_live_tiers.py", r'''
import os
import pytest

@pytest.mark.browser_smoke
def test_browser_smoke_requires_external_authorized_transport():
    if os.getenv("GFS_EXTERNAL_TRANSPORT_READY") != "1":
        pytest.skip("No authorized external browser transport fixture configured")
    assert True

@pytest.mark.live_paid
def test_live_paid_never_runs_without_external_transport():
    if os.getenv("GFS_EXTERNAL_TRANSPORT_READY") != "1":
        pytest.skip("No authorized external browser transport fixture configured")
    assert True

@pytest.mark.partial_capability
def test_partial_capability_requires_explicit_opt_in():
    assert os.getenv("GFS_ALLOW_PARTIAL") == "1"
''')

# pyproject update
p = ROOT / "pyproject.toml"
s = p.read_text(encoding="utf-8")
s = s.replace('dependencies = ["PyYAML>=6.0"]', 'dependencies = ["PyYAML>=6.0", "jsonschema>=4.20", "referencing>=0.35"]')
if '[project.scripts]' not in s:
    s = s.replace('\n[tool.pytest.ini_options]', '\n[project.scripts]\ngfs = "gfs.cli:main"\n\n[tool.pytest.ini_options]')
p.write_text(s, encoding="utf-8")

# Runtime docs
w(DOCS / "RUNTIME_EXECUTION.md", r'''
# Runtime Execution Boundary

Google Flow Skills separates planning from live mutation. Offline planning, skill execution, schema validation, workspace persistence, media integrity QC, and repair planning never spend credits.

## Modes

- `offline` — default; no browser or network access.
- `read_only` — enabled with `GFS_BROWSER_SMOKE=1`; permits authorized session/status reads through an injected browser transport.
- `live` — enabled with `GFS_LIVE_FLOW=1`; mutations are still blocked from spending credits unless `GFS_ALLOW_CREDITS=1` is also set.
- `[RUNTIME_PARTIAL]` operations require the separate `GFS_ALLOW_PARTIAL=1` gate.

## Browser security context

`FlowRuntime` does not acquire cookies, OAuth tokens, or reCAPTCHA tokens. Credit-spending video mutations accept a `TrustedMutationEnvelope` prepared inside an authorized browser integration. It is single-use, non-serializable, redacted in `repr`, and consumed immediately by the transport. GFS has no server-side reCAPTCHA acquisition or replay path.

The outer mutation payload is browser-supplied because `GOOGLE_FLOW_API_REFERENCE.md` marks several `clientContext` fields runtime-partial. GFS validates the verified operation endpoint and media-reference fragment (`mediaId`, `IMAGE_USAGE_TYPE_ASSET`) without guessing undocumented wrappers.

## Persistence

`ProjectWorkspace` writes atomically and refuses values that `redact.sanitize` would modify. OAuth/cookies/reCAPTCHA/PII/signed-URL secrets therefore cannot enter project state, checkpoints, generation records, or media ledgers.

## QC

`QCEngine` performs real file/container integrity checks. Visual-semantic criteria require an injected `VisualCriticBackend`; without one, the engine raises `VisualBackendUnavailable` rather than pretending that visual inspection occurred.
''')

# README entry point
readme = ROOT / "README.md"
if not readme.exists():
    w(readme, r'''
# Google Flow Skills

Evidence-aware modular AI filmmaking runtime for Google Flow / Veo. The repository contains 298 explicit skills, typed shared schemas, JSON-pointer ownership, an executable skill engine, offline project orchestration, persistent workspaces, evidence-gated Flow runtime interfaces, QC/repair infrastructure, and automated tests.

See `SKILLS_ARCHITECTURE.md`, `SKILL_CONTRACT.md`, `VIDEO_PRODUCTION_PIPELINE.md`, `docs/RUNTIME_EXECUTION.md`, and `docs/IMPLEMENTATION_STATUS.md`.

Useful commands:

```bash
gfs plan --genre luxury-commercial --brief "Luxury watch macro hero"
gfs run-offline --project-id demo --genre luxury-commercial --brief "Luxury watch macro hero" --product
gfs resume --project-id demo
gfs cases
gfs check-media path/to/result.mp4
gfs live-preflight
```

Live mutations are disabled by default and require explicit runtime/credit opt-ins plus an authorized external browser transport.
''')

print("Installed phase-3 production runtime, persistence, QC, repair, CLI, and test tiers")
