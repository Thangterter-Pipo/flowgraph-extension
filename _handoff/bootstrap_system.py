from __future__ import annotations

import json
from pathlib import Path
from textwrap import dedent

from tools.skill_catalog import IDS, LAYERS, S

ROOT = Path(__file__).resolve().parents[1] if Path(__file__).parent.name == 'tools' else Path.cwd()
if ROOT.name == '_handoff':
    ROOT = Path(r'E:\Google-flow-skills')


def w(rel: str, text: str) -> None:
    p = ROOT / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(dedent(text).lstrip(), encoding='utf-8')


# Plans -----------------------------------------------------------------------
(ROOT / 'skills_plan').mkdir(parents=True, exist_ok=True)
plan = {
    'plan_version': '1.0.0',
    'source': 'SKILLS_TAXONOMY.md + GOOGLE_FLOW_API_REFERENCE.md v2.0.0',
    'skill_count': len(S),
    'skills': [s.as_plan() for s in S],
}
(ROOT / 'skills_plan' / 'plan.json').write_text(json.dumps(plan, ensure_ascii=False, indent=2), encoding='utf-8')
(ROOT / 'skills_plan' / 'ids.json').write_text(json.dumps(IDS, ensure_ascii=False, indent=2), encoding='utf-8')

w('pyproject.toml', r'''
[project]
name = "google-flow-skills"
version = "0.1.0"
description = "Evidence-aware modular filmmaking skills for Google Flow / Veo"
requires-python = ">=3.11"
dependencies = ["PyYAML>=6.0"]

[tool.pytest.ini_options]
pythonpath = ["src", "."]
testpaths = ["tests"]
addopts = "-q"
''')

w('src/gfs/__init__.py', r'''
"""Executable infrastructure for Google-Flow-Skills.

Creative knowledge lives in skills/*/SKILL.md.  This package contains only typed
runtime/tooling primitives: evidence gates, verified payload builders, state,
routing helpers, registry parsing, redaction and QC aggregation.
"""

from .evidence import EvidenceLevel, require_capability
from .models import ModelResolver
from .routing import GenerationMethod, route_generation_method

__all__ = ["EvidenceLevel", "require_capability", "ModelResolver", "GenerationMethod", "route_generation_method"]
''')

w('src/gfs/evidence.py', r'''
from __future__ import annotations

from dataclasses import dataclass
from enum import IntEnum


class EvidenceLevel(IntEnum):
    UNKNOWN = 0
    BUNDLE_VERIFIED = 1
    RUNTIME_PARTIAL = 2
    RUNTIME_VERIFIED = 3


class CapabilityUnavailable(RuntimeError):
    pass


@dataclass(frozen=True)
class Capability:
    name: str
    level: EvidenceLevel
    reference: str
    note: str = ""


CAPABILITIES = {
    "browser.session": Capability("browser.session", EvidenceLevel.RUNTIME_VERIFIED, "§18.1"),
    "overlay.handler": Capability("overlay.handler", EvidenceLevel.RUNTIME_VERIFIED, "§18.1"),
    "auth.session": Capability("auth.session", EvidenceLevel.RUNTIME_VERIFIED, "§3.1"),
    "project.create": Capability("project.create", EvidenceLevel.RUNTIME_VERIFIED, "§4.1"),
    "model.resolve": Capability("model.resolve", EvidenceLevel.RUNTIME_VERIFIED, "§11", "Local evidence-labelled registry resolver."),
    "credits.read": Capability("credits.read", EvidenceLevel.RUNTIME_VERIFIED, "§18.2"),
    "upload.image": Capability("upload.image", EvidenceLevel.RUNTIME_VERIFIED, "§6.1"),
    "image.t2i": Capability("image.t2i", EvidenceLevel.RUNTIME_VERIFIED, "§7.1"),
    "image.transform": Capability("image.transform", EvidenceLevel.RUNTIME_PARTIAL, "§7.2"),
    "image.upsample": Capability("image.upsample", EvidenceLevel.RUNTIME_PARTIAL, "§7.3"),
    "video.t2v": Capability("video.t2v", EvidenceLevel.RUNTIME_VERIFIED, "§8.1"),
    "video.i2v": Capability("video.i2v", EvidenceLevel.RUNTIME_VERIFIED, "§8.2"),
    "video.interpolation": Capability("video.interpolation", EvidenceLevel.RUNTIME_VERIFIED, "§8.3"),
    "video.reference": Capability("video.reference", EvidenceLevel.RUNTIME_VERIFIED, "§8.4"),
    "video.edit": Capability("video.edit", EvidenceLevel.RUNTIME_VERIFIED, "§8.5"),
    "video.upsample": Capability("video.upsample", EvidenceLevel.RUNTIME_PARTIAL, "§8.6"),
    "polling.batch_check": Capability("polling.batch_check", EvidenceLevel.RUNTIME_VERIFIED, "§13"),
    "download.media": Capability("download.media", EvidenceLevel.RUNTIME_VERIFIED, "§15"),
    "cancel.generation": Capability("cancel.generation", EvidenceLevel.RUNTIME_PARTIAL, "§14"),
    "character.slot_assignment": Capability("character.slot_assignment", EvidenceLevel.RUNTIME_VERIFIED, "§10.1–§10.4"),
    "error.classifier": Capability("error.classifier", EvidenceLevel.RUNTIME_VERIFIED, "§16 and §18.2"),
    "upload.video": Capability("upload.video", EvidenceLevel.BUNDLE_VERIFIED, "§6.2"),
    "audio.generation": Capability("audio.generation", EvidenceLevel.UNKNOWN, "§19 / Known Unknowns"),
    "likeness.create": Capability("likeness.create", EvidenceLevel.RUNTIME_PARTIAL, "§10.4"),
}


def parse_level(value: str | EvidenceLevel) -> EvidenceLevel:
    if isinstance(value, EvidenceLevel):
        return value
    return EvidenceLevel[value]


def require_capability(name: str, min_level: str | EvidenceLevel = EvidenceLevel.RUNTIME_VERIFIED) -> Capability:
    if name not in CAPABILITIES:
        raise CapabilityUnavailable(f"Unknown capability {name!r}; guessing is forbidden")
    cap = CAPABILITIES[name]
    required = parse_level(min_level)
    if cap.level < required:
        raise CapabilityUnavailable(
            f"{name} is {cap.level.name}, below required {required.name}; source {cap.reference}"
        )
    return cap
''')

w('src/gfs/redact.py', r'''
from __future__ import annotations

import copy
import re
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

REDACTED = "<REDACTED>"
SENSITIVE_KEYS = {
    "authorization", "access_token", "accessToken", "cookie", "cookies",
    "recaptcha", "recaptchaToken", "token", "id_token", "refresh_token",
    "email", "signed_url", "signedUrl",
}
SIGNED_QUERY_KEYS = {"expires", "signature", "key-pair-id", "x-goog-signature", "x-goog-credential"}
BEARER_RE = re.compile(r"(?i)Bearer\s+[A-Za-z0-9._~+/=-]+")
COOKIE_RE = re.compile(r"(?i)(cookie\s*[:=]\s*)[^\s]+")
EMAIL_RE = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")


def sanitize_url(value: str) -> str:
    try:
        parts = urlsplit(value)
    except Exception:
        return value
    if not parts.scheme or not parts.netloc:
        return value
    query = []
    for key, val in parse_qsl(parts.query, keep_blank_values=True):
        query.append((key, REDACTED if key.lower() in SIGNED_QUERY_KEYS else val))
    return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(query), ""))


def sanitize_text(value: str) -> str:
    value = BEARER_RE.sub("Bearer <REDACTED>", value)
    value = COOKIE_RE.sub(r"\1<REDACTED>", value)
    value = EMAIL_RE.sub("<REDACTED_PII>", value)
    if value.startswith(("http://", "https://")):
        value = sanitize_url(value)
    return value


def sanitize(value: Any, parent_key: str = "") -> Any:
    if isinstance(value, dict):
        out = {}
        for key, val in value.items():
            if key in SENSITIVE_KEYS or key.lower() in {k.lower() for k in SENSITIVE_KEYS}:
                out[key] = REDACTED
            else:
                out[key] = sanitize(val, key)
        return out
    if isinstance(value, list):
        return [sanitize(v, parent_key) for v in value]
    if isinstance(value, tuple):
        return tuple(sanitize(v, parent_key) for v in value)
    if isinstance(value, str):
        return sanitize_text(value)
    return copy.deepcopy(value)
''')

w('src/gfs/errors.py', r'''
from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Any


class ErrorClass(str, Enum):
    SECURITY_REJECTION = "security_rejection"
    AUTHENTICATION = "authentication"
    PERMISSION = "permission"
    SCHEMA = "schema_error"
    PRECONDITION = "precondition_error"
    RATE_LIMIT = "rate_limit"
    CAPABILITY_UNAVAILABLE = "capability_unavailable"
    GENERATION = "generation_failure"
    TRANSPORT = "transport_error"
    CDP_TRANSPORT = "cdp_transport_error"
    UNKNOWN = "unknown"


@dataclass(frozen=True)
class ClassifiedError:
    error_class: ErrorClass
    retryable: bool
    reason: str
    owning_fix: str


def _text(body: Any) -> str:
    if body is None:
        return ""
    return str(body).lower()


def classify_error(status: int | None = None, body: Any = None, exception: BaseException | None = None) -> ClassifiedError:
    text = _text(body)
    exc = _text(exception)
    if exception is not None and any(x in exc for x in ("websocket", "cdp", "devtools")):
        return ClassifiedError(ErrorClass.CDP_TRANSPORT, True, "Browser transport failed independently of media generation.", "flow/browser-session")
    if exception is not None:
        return ClassifiedError(ErrorClass.TRANSPORT, True, "Network or process transport failed before a reliable media verdict.", "flow/browser-session")
    if status == 403 and ("recaptcha" in text or "unusual_activity" in text):
        return ClassifiedError(ErrorClass.SECURITY_REJECTION, False, "A valid browser-generated security token was not accepted; bypass/replay is forbidden.", "flow/browser-session")
    if status == 401:
        return ClassifiedError(ErrorClass.AUTHENTICATION, True, "Session authentication is missing or expired.", "flow/auth-session")
    if status == 403:
        return ClassifiedError(ErrorClass.PERMISSION, False, "Backend permission denied outside the special reCAPTCHA rejection signature.", "flow/error-classifier")
    if status == 429:
        return ClassifiedError(ErrorClass.RATE_LIMIT, True, "Service throttling or quota pressure.", "strategy/retry-strategy")
    if status == 400 and ("unknown field" in text or "unknown name" in text or "invalid value" in text):
        return ClassifiedError(ErrorClass.SCHEMA, False, "Payload or enum violates the verified schema.", "flow/error-classifier")
    if status == 400 and ("failed_precondition" in text or "precondition" in text):
        return ClassifiedError(ErrorClass.PRECONDITION, False, "Backend state does not permit the requested operation.", "strategy/edit-vs-regenerate-selector")
    if "media_generation_status_failed" in text or "generation failed" in text:
        return ClassifiedError(ErrorClass.GENERATION, True, "The media generation itself failed after submission.", "failure/generation-failure-analyzer")
    return ClassifiedError(ErrorClass.UNKNOWN, False, "No verified classifier rule matched this response.", "flow/error-classifier")
''')

w('src/gfs/models.py', r'''
from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

from .evidence import EvidenceLevel


@dataclass(frozen=True)
class ModelChoice:
    model_key: str
    operation: str
    evidence_level: EvidenceLevel
    observed_credit_cost: int | None
    duration_seconds: int | None
    target_resolution: str | None


class ModelResolutionError(LookupError):
    pass


class ModelResolver:
    def __init__(self, registry_path: str | Path | None = None):
        if registry_path is None:
            registry_path = Path(__file__).resolve().parents[2] / "model_registry" / "registry.json"
        self.registry_path = Path(registry_path)
        self.data = json.loads(self.registry_path.read_text(encoding="utf-8"))

    def candidates(self, operation: str) -> list[dict]:
        return [m for m in self.data.get("models", []) if m.get("operation") == operation]

    def resolve(
        self,
        operation: str,
        *,
        target_resolution: str | None = None,
        min_evidence: EvidenceLevel = EvidenceLevel.RUNTIME_PARTIAL,
    ) -> ModelChoice:
        rows = self.candidates(operation)
        if target_resolution is not None:
            rows = [m for m in rows if str(m.get("target_resolution", "")).lower() == target_resolution.lower()]
        rows = [m for m in rows if EvidenceLevel[m["evidence_level"]] >= min_evidence]
        if not rows:
            raise ModelResolutionError(
                f"No evidence-labelled model for operation={operation!r}, target_resolution={target_resolution!r}; guessing is forbidden"
            )
        rows.sort(key=lambda m: (EvidenceLevel[m["evidence_level"]], m.get("quality_tier") == "standard"), reverse=True)
        m = rows[0]
        return ModelChoice(
            model_key=m["model_key"],
            operation=m["operation"],
            evidence_level=EvidenceLevel[m["evidence_level"]],
            observed_credit_cost=m.get("observed_credit_cost"),
            duration_seconds=m.get("duration_seconds"),
            target_resolution=m.get("target_resolution"),
        )
''')

w('src/gfs/payloads.py', r'''
from __future__ import annotations

import base64
from typing import Iterable

IMAGE_UPSAMPLE_RESOLUTIONS = {
    "2K": "UPSAMPLE_IMAGE_RESOLUTION_2K",
    "4K": "UPSAMPLE_IMAGE_RESOLUTION_4K",
    "UPSAMPLE_IMAGE_RESOLUTION_2K": "UPSAMPLE_IMAGE_RESOLUTION_2K",
    "UPSAMPLE_IMAGE_RESOLUTION_4K": "UPSAMPLE_IMAGE_RESOLUTION_4K",
}


def _id(media_id: str) -> str:
    if not isinstance(media_id, str) or not media_id.strip():
        raise ValueError("media_id must be a non-empty string")
    return media_id.strip()


def media_ref(media_id: str) -> dict:
    return {"mediaId": _id(media_id)}


def upload_image_payload(image_bytes: bytes | str) -> dict:
    if isinstance(image_bytes, bytes):
        encoded = base64.b64encode(image_bytes).decode("ascii")
    elif isinstance(image_bytes, str) and image_bytes:
        if image_bytes.startswith("data:image/"):
            raise ValueError("imageBytes must be raw Base64 without a data: prefix")
        encoded = image_bytes
    else:
        raise ValueError("image_bytes must be bytes or a non-empty raw Base64 string")
    return {"imageBytes": encoded}


def image_transform_payload(media_id: str) -> dict:
    return {"mediaId": _id(media_id)}


def image_upsample_payload(media_id: str, target_resolution: str) -> dict:
    try:
        enum = IMAGE_UPSAMPLE_RESOLUTIONS[target_resolution]
    except KeyError as exc:
        raise ValueError("target_resolution must be 2K or 4K using verified enums") from exc
    return {"mediaId": _id(media_id), "targetResolution": enum}


def video_start_image_fields(media_id: str) -> dict:
    return {"startImage": media_ref(media_id)}


def video_start_end_fields(start_media_id: str, end_media_id: str) -> dict:
    return {"startImage": media_ref(start_media_id), "endImage": media_ref(end_media_id)}


def video_reference_fields(media_ids: Iterable[str]) -> dict:
    refs = [{"mediaId": _id(mid), "imageUsageType": "IMAGE_USAGE_TYPE_ASSET"} for mid in media_ids]
    if not refs:
        raise ValueError("referenceImages requires at least one mediaId")
    return {"referenceImages": refs}


def video_edit_fields(media_id: str) -> dict:
    return {"videoInput": media_ref(media_id)}


def video_upsample_fields(media_id: str) -> dict:
    return {"videoInput": media_ref(media_id)}


def cancel_generation_payload(media_id: str) -> dict:
    return {"mediaId": _id(media_id)}


def character_slot_payload(media_id: str, destination_project_id: str, entity_id: str, image_reference_index: int = 1) -> dict:
    if image_reference_index < 0:
        raise ValueError("image_reference_index must be non-negative")
    return {
        "mediaId": _id(media_id),
        "destinationProjectId": destination_project_id,
        "destinationMediaContext": {
            "entityContext": {
                "entityId": entity_id,
                "characterSlot": {"imageReferenceIndex": image_reference_index},
            }
        },
    }
''')

w('src/gfs/polling.py', r'''
from __future__ import annotations

from dataclasses import dataclass
from enum import Enum


class RuntimeMediaState(str, Enum):
    ACTIVE = "MEDIA_GENERATION_STATUS_ACTIVE"
    SUCCESSFUL = "MEDIA_GENERATION_STATUS_SUCCESSFUL"
    FAILED = "MEDIA_GENERATION_STATUS_FAILED"
    UNKNOWN = "UNKNOWN"


class ProductionState(str, Enum):
    PLANNED = "PLANNED"
    PROMPT_READY = "PROMPT_READY"
    QUEUED = "QUEUED"
    ACTIVE = "ACTIVE"
    SUCCESSFUL = "SUCCESSFUL"
    FAILED = "FAILED"
    QC_PENDING = "QC_PENDING"
    QC_PASSED = "QC_PASSED"
    QC_FAILED = "QC_FAILED"
    EDIT_REQUIRED = "EDIT_REQUIRED"
    REGENERATE_REQUIRED = "REGENERATE_REQUIRED"
    FINAL = "FINAL"


RUNTIME_TO_PRODUCTION = {
    RuntimeMediaState.ACTIVE: ProductionState.ACTIVE,
    RuntimeMediaState.SUCCESSFUL: ProductionState.SUCCESSFUL,
    RuntimeMediaState.FAILED: ProductionState.FAILED,
}


def parse_runtime_status(value: str | None) -> RuntimeMediaState:
    for item in RuntimeMediaState:
        if value == item.value:
            return item
    return RuntimeMediaState.UNKNOWN


def map_runtime_to_production(value: str | RuntimeMediaState) -> ProductionState | None:
    state = value if isinstance(value, RuntimeMediaState) else parse_runtime_status(value)
    return RUNTIME_TO_PRODUCTION.get(state)
''')

w('src/gfs/state.py', r'''
from __future__ import annotations

import copy
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from .polling import ProductionState


@dataclass(frozen=True)
class ContinuitySnapshot:
    shot_id: str
    version: int
    state: dict[str, Any]
    created_at: str


class ContinuityStateStore:
    def __init__(self) -> None:
        self._shots: dict[str, list[ContinuitySnapshot]] = {}

    def put(self, shot_id: str, state: dict[str, Any]) -> ContinuitySnapshot:
        versions = self._shots.setdefault(shot_id, [])
        snap = ContinuitySnapshot(
            shot_id=shot_id,
            version=len(versions) + 1,
            state=copy.deepcopy(state),
            created_at=datetime.now(timezone.utc).isoformat(),
        )
        versions.append(snap)
        return snap

    def latest(self, shot_id: str) -> ContinuitySnapshot | None:
        rows = self._shots.get(shot_id, [])
        return rows[-1] if rows else None


@dataclass
class ShotGenerationState:
    shot_id: str
    state: ProductionState = ProductionState.PLANNED
    retry_count: int = 0
    media_id: str | None = None
    errors: list[dict[str, Any]] = field(default_factory=list)

    def transition(self, next_state: ProductionState) -> None:
        terminal = {ProductionState.FINAL}
        if self.state in terminal:
            raise ValueError(f"Cannot transition finalized shot {self.shot_id}")
        self.state = next_state
''')

w('src/gfs/routing.py', r'''
from __future__ import annotations

from dataclasses import dataclass
from enum import Enum


class GenerationMethod(str, Enum):
    T2V = "t2v"
    I2V = "i2v"
    START_END = "start_end"
    REFERENCE = "reference"
    EDIT = "edit"


@dataclass(frozen=True)
class RoutingDecision:
    method: GenerationMethod
    because: str
    required_assets: tuple[str, ...]


def route_generation_method(
    *,
    has_existing_video: bool = False,
    defect_localized: bool = False,
    has_start_image: bool = False,
    has_end_image: bool = False,
    reference_count: int = 0,
    strict_identity: bool = False,
    product_geometry_critical: bool = False,
    exact_start_composition: bool = False,
) -> RoutingDecision:
    if has_existing_video and defect_localized:
        return RoutingDecision(GenerationMethod.EDIT, "The source shot is usable and the defect is localized, so edit preserves sunk quality and credits.", ("video_input",))
    if has_start_image and has_end_image:
        return RoutingDecision(GenerationMethod.START_END, "Both temporal endpoints are controlled; interpolation provides stronger destination control than unconstrained generation.", ("start_image", "end_image"))
    if reference_count >= 2 or (reference_count >= 1 and strict_identity):
        return RoutingDecision(GenerationMethod.REFERENCE, "Multiple or identity-critical references are load-bearing and should travel as reference assets.", ("reference_images",))
    if has_start_image and (strict_identity or product_geometry_critical or exact_start_composition):
        return RoutingDecision(GenerationMethod.I2V, "The opening frame carries identity, product geometry, or composition that text alone should not be asked to rediscover.", ("start_image",))
    if has_start_image:
        return RoutingDecision(GenerationMethod.I2V, "A validated start frame exists and provides useful composition control.", ("start_image",))
    return RoutingDecision(GenerationMethod.T2V, "No reference anchor is load-bearing; text-to-video avoids unnecessary reference coupling.", ())
''')

w('src/gfs/qc.py', r'''
from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Mapping


class GateVerdict(str, Enum):
    PASS = "PASS"
    EDIT = "EDIT"
    REGENERATE = "REGENERATE"


@dataclass(frozen=True)
class QCThresholds:
    pass_score: float = 8.5
    edit_score: float = 7.0
    hard_fail_dimension: float = 5.5


def weighted_score(scores: Mapping[str, float], weights: Mapping[str, float] | None = None) -> float:
    if not scores:
        raise ValueError("scores cannot be empty")
    for name, value in scores.items():
        if not 0 <= value <= 10:
            raise ValueError(f"{name} score must be between 0 and 10")
    if weights is None:
        weights = {k: 1.0 for k in scores}
    total_weight = sum(float(weights.get(k, 1.0)) for k in scores)
    if total_weight <= 0:
        raise ValueError("total weight must be positive")
    return round(sum(scores[k] * float(weights.get(k, 1.0)) for k in scores) / total_weight, 3)


def acceptance_gate(scores: Mapping[str, float], *, thresholds: QCThresholds = QCThresholds(), critical_dimensions: tuple[str, ...] = ()) -> tuple[GateVerdict, float]:
    overall = weighted_score(scores)
    if any(scores.get(k, 10.0) < thresholds.hard_fail_dimension for k in critical_dimensions):
        return GateVerdict.REGENERATE, overall
    if overall >= thresholds.pass_score:
        return GateVerdict.PASS, overall
    if overall >= thresholds.edit_score:
        return GateVerdict.EDIT, overall
    return GateVerdict.REGENERATE, overall
''')

w('src/gfs/browser.py', r'''
from __future__ import annotations

from dataclasses import dataclass

SAFE_OVERLAY_LABELS = {
    "Bắt đầu", "Đóng", "Got it", "Continue", "Skip", "Close", "Dismiss",
}
DENIED_SURFACE_TERMS = {
    "recaptcha", "security", "verification", "verify identity", "payment",
    "billing", "account security", "captcha",
}


@dataclass(frozen=True)
class OverlayDecision:
    allowed: bool
    reason: str


def may_dismiss_overlay(label: str, surrounding_text: str = "") -> OverlayDecision:
    haystack = f"{label} {surrounding_text}".lower()
    if any(term in haystack for term in DENIED_SURFACE_TERMS):
        return OverlayDecision(False, "Security, identity, verification, or payment UI is denylisted.")
    if label in SAFE_OVERLAY_LABELS:
        return OverlayDecision(True, "Label is in the explicit ordinary-product-overlay allowlist.")
    return OverlayDecision(False, "Unknown overlay control is not allowlisted.")
''')

w('src/gfs/session.py', r'''
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any, Protocol

from .redact import sanitize


class JSONTransport(Protocol):
    def get_json(self, url: str, **kwargs: Any) -> dict: ...


@dataclass(frozen=True)
class SessionMetadata:
    expires: str | None
    has_access_token: bool
    user_present: bool


def parse_session_payload(payload: dict) -> SessionMetadata:
    return SessionMetadata(
        expires=payload.get("expires"),
        has_access_token=bool(payload.get("access_token")),
        user_present=isinstance(payload.get("user"), dict),
    )


def sanitized_session_fixture(payload: dict) -> dict:
    return sanitize(payload)
''')

w('src/gfs/skillspec.py', r'''
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml


@dataclass(frozen=True)
class SkillSpec:
    path: Path
    meta: dict[str, Any]
    body: str

    @property
    def id(self) -> str:
        return self.meta["id"]


def load_skill(path: str | Path) -> SkillSpec:
    path = Path(path)
    text = path.read_text(encoding="utf-8")
    if not text.startswith("---\n"):
        raise ValueError(f"{path} has no YAML frontmatter")
    try:
        _, raw, body = text.split("---", 2)
    except ValueError as exc:
        raise ValueError(f"{path} frontmatter is not closed") from exc
    meta = yaml.safe_load(raw) or {}
    if not isinstance(meta, dict):
        raise ValueError(f"{path} frontmatter must be a mapping")
    return SkillSpec(path=path, meta=meta, body=body.lstrip())
''')

w('src/gfs/registry_build.py', r'''
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Iterable

from .evidence import EvidenceLevel
from .skillspec import SkillSpec, load_skill

LAYERS = {"flow": 0, "foundation": 1, "story": 2, "craft": 3, "continuity": 4, "prompt": 5, "strategy": 6, "genre": 7, "qc": 8, "failure": 9, "orchestration": 10}
REQUIRED_SECTIONS = [
    "Purpose", "Responsibility", "When To Use", "When NOT To Use", "Inputs", "Outputs",
    "Dependencies", "Decision Framework", "Workflow", "Professional Standards", "Google Flow Integration",
    "Runtime Evidence", "Constraints", "Failure Modes", "Recovery Strategy", "Quality Checklist", "Examples",
]


def discover(root: Path) -> list[SkillSpec]:
    return [load_skill(p) for p in sorted((root / "skills").glob("*/*/SKILL.md"))]


def _acyclic(graph: dict[str, list[str]]) -> None:
    visiting: set[str] = set()
    visited: set[str] = set()
    def walk(node: str) -> None:
        if node in visiting:
            raise ValueError(f"Dependency cycle includes {node}")
        if node in visited:
            return
        visiting.add(node)
        for dep in graph.get(node, []):
            walk(dep)
        visiting.remove(node)
        visited.add(node)
    for node in graph:
        walk(node)


def validate(root: Path, specs: list[SkillSpec]) -> list[str]:
    errors: list[str] = []
    by_id = {s.id: s for s in specs}
    if len(by_id) != len(specs):
        errors.append("duplicate skill id")
    plan_path = root / "skills_plan" / "plan.json"
    if plan_path.exists():
        plan = json.loads(plan_path.read_text(encoding="utf-8"))
        expected = {row["id"] for row in plan["skills"]}
        actual = set(by_id)
        if expected != actual:
            errors.append(f"plan/tree mismatch missing={sorted(expected-actual)} extra={sorted(actual-expected)}")
    for spec in specs:
        meta = spec.meta
        rel = spec.path.relative_to(root / "skills")
        expected_id = f"{rel.parts[0]}/{rel.parts[1]}"
        if spec.id != expected_id:
            errors.append(f"{spec.id}: path expects {expected_id}")
        category = meta.get("category")
        if category not in LAYERS or meta.get("layer") != LAYERS.get(category):
            errors.append(f"{spec.id}: layer/category mismatch")
        for dep in list(meta.get("dependencies") or []) + list(meta.get("optional_dependencies") or []):
            if dep not in by_id:
                errors.append(f"{spec.id}: unknown dependency {dep}")
            elif by_id[dep].meta.get("layer", 999) > meta.get("layer", -1):
                errors.append(f"{spec.id}: dependency points upward to {dep}")
        if category == "flow":
            level = meta.get("evidence_level")
            if level not in EvidenceLevel.__members__:
                errors.append(f"{spec.id}: invalid evidence level {level}")
        elif meta.get("evidence_level") != "n/a":
            errors.append(f"{spec.id}: creative skill evidence_level must be n/a")
        if len(meta.get("triggers") or []) < 2:
            errors.append(f"{spec.id}: fewer than two triggers")
        if len(meta.get("not_for") or []) < 1:
            errors.append(f"{spec.id}: missing not_for")
        for section in REQUIRED_SECTIONS:
            if f"## {section}" not in spec.body:
                errors.append(f"{spec.id}: missing section {section}")
        if "## Failure Modes" in spec.body and "| signature | cause | owning fix |" not in spec.body.lower():
            errors.append(f"{spec.id}: failure table header missing")
        if spec.body.count("- [ ] ") < 5:
            errors.append(f"{spec.id}: quality checklist too short")
    try:
        _acyclic({sid: list(s.meta.get("dependencies") or []) for sid, s in by_id.items()})
    except ValueError as exc:
        errors.append(str(exc))
    return errors


def build(root: Path) -> dict:
    specs = discover(root)
    errors = validate(root, specs)
    if errors:
        raise SystemExit("\n".join(errors))
    rows = []
    for spec in specs:
        rows.append({k: spec.meta.get(k) for k in ("id", "version", "name", "category", "layer", "responsibility", "evidence_level", "dependencies", "optional_dependencies", "consumes", "produces", "triggers", "not_for", "determinism", "side_effects")})
    registry = {"registry_version": "1.0.0", "skill_count": len(rows), "skills": rows}
    (root / "skills" / "registry.json").write_text(json.dumps(registry, ensure_ascii=False, indent=2), encoding="utf-8")
    return registry


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path.cwd())
    args = parser.parse_args()
    registry = build(args.root.resolve())
    print(f"Built registry with {registry['skill_count']} skills")


if __name__ == "__main__":
    main()
''')

# Tests -----------------------------------------------------------------------
w('tests/conftest.py', r'''
from pathlib import Path
import pytest

@pytest.fixture(scope="session")
def repo_root() -> Path:
    return Path(__file__).resolve().parents[1]
''')

w('tests/test_payloads.py', r'''
import pytest
from gfs.payloads import (
    cancel_generation_payload, image_upsample_payload, media_ref, upload_image_payload,
    video_edit_fields, video_reference_fields, video_start_end_fields, video_start_image_fields,
)


def test_media_ref_uses_media_id_not_name():
    assert media_ref("abc") == {"mediaId": "abc"}
    assert "name" not in media_ref("abc")


def test_reference_images_use_verified_usage_type():
    payload = video_reference_fields(["a", "b"])
    assert payload == {"referenceImages": [
        {"mediaId": "a", "imageUsageType": "IMAGE_USAGE_TYPE_ASSET"},
        {"mediaId": "b", "imageUsageType": "IMAGE_USAGE_TYPE_ASSET"},
    ]}


def test_upload_uses_image_bytes_without_data_prefix():
    assert "imageBytes" in upload_image_payload(b"abc")
    assert "encodedImage" not in upload_image_payload(b"abc")
    with pytest.raises(ValueError):
        upload_image_payload("data:image/png;base64,AAAA")


def test_upsample_only_accepts_verified_enums():
    assert image_upsample_payload("m", "2K")["targetResolution"] == "UPSAMPLE_IMAGE_RESOLUTION_2K"
    assert image_upsample_payload("m", "4K")["targetResolution"] == "UPSAMPLE_IMAGE_RESOLUTION_4K"
    with pytest.raises(ValueError):
        image_upsample_payload("m", "IMAGE_UPSAMPLE_RESOLUTION_2K")


def test_all_video_media_fields_use_media_id():
    assert video_start_image_fields("s") == {"startImage": {"mediaId": "s"}}
    assert video_start_end_fields("s", "e") == {"startImage": {"mediaId": "s"}, "endImage": {"mediaId": "e"}}
    assert video_edit_fields("v") == {"videoInput": {"mediaId": "v"}}
    assert cancel_generation_payload("v") == {"mediaId": "v"}
''')

w('tests/test_redaction.py', r'''
from gfs.redact import sanitize


def test_recursive_redaction_preserves_media_name():
    data = {
        "access_token": "secret",
        "email": "person@example.com",
        "Authorization": "Bearer abc.def",
        "media": {"name": "media-uuid"},
        "url": "https://flow-content.google/video/x?Expires=1&Signature=abc&safe=yes",
    }
    out = sanitize(data)
    assert out["access_token"] == "<REDACTED>"
    assert out["email"] == "<REDACTED>"
    assert out["Authorization"] == "<REDACTED>"
    assert out["media"]["name"] == "media-uuid"
    assert "Signature=abc" not in out["url"]
''')

w('tests/test_routing.py', r'''
from gfs.routing import GenerationMethod, route_generation_method


def test_edit_preserves_good_existing_shot():
    assert route_generation_method(has_existing_video=True, defect_localized=True).method is GenerationMethod.EDIT


def test_start_end_beats_other_anchor_methods():
    assert route_generation_method(has_start_image=True, has_end_image=True, strict_identity=True, reference_count=2).method is GenerationMethod.START_END


def test_reference_for_strict_multi_reference_identity():
    assert route_generation_method(reference_count=2, strict_identity=True).method is GenerationMethod.REFERENCE


def test_i2v_for_product_geometry():
    assert route_generation_method(has_start_image=True, product_geometry_critical=True).method is GenerationMethod.I2V


def test_t2v_for_unanchored_establishing_shot():
    assert route_generation_method().method is GenerationMethod.T2V
''')

w('tests/test_qc.py', r'''
from gfs.qc import GateVerdict, QCThresholds, acceptance_gate


def test_default_thresholds_match_project_contract():
    verdict, score = acceptance_gate({"composition": 9, "lighting": 8.5, "motion": 8.5})
    assert verdict is GateVerdict.PASS
    assert score >= 8.5


def test_middle_band_routes_to_edit():
    verdict, _ = acceptance_gate({"composition": 7.4, "lighting": 7.8})
    assert verdict is GateVerdict.EDIT


def test_critical_dimension_can_force_regeneration():
    verdict, _ = acceptance_gate({"identity": 5.0, "composition": 9.8}, critical_dimensions=("identity",))
    assert verdict is GateVerdict.REGENERATE
''')

w('tests/test_errors.py', r'''
from gfs.errors import ErrorClass, classify_error


def test_recaptcha_rejection_is_security_not_generic_permission():
    result = classify_error(403, "PERMISSION_DENIED reCAPTCHA evaluation failed PUBLIC_ERROR_UNUSUAL_ACTIVITY")
    assert result.error_class is ErrorClass.SECURITY_REJECTION
    assert result.retryable is False


def test_cdp_timeout_not_generation_failure():
    result = classify_error(exception=RuntimeError("WebSocketTimeoutException in CDP transport"))
    assert result.error_class is ErrorClass.CDP_TRANSPORT


def test_unknown_field_is_schema_failure():
    assert classify_error(400, "Unknown field name").error_class is ErrorClass.SCHEMA
''')

w('tests/test_evidence.py', r'''
import pytest
from gfs.evidence import CapabilityUnavailable, EvidenceLevel, require_capability


def test_verified_capability_passes_verified_gate():
    assert require_capability("video.i2v").level is EvidenceLevel.RUNTIME_VERIFIED


def test_partial_does_not_pass_verified_gate():
    with pytest.raises(CapabilityUnavailable):
        require_capability("video.upsample")


def test_partial_can_be_explicitly_allowed():
    assert require_capability("video.upsample", EvidenceLevel.RUNTIME_PARTIAL).level is EvidenceLevel.RUNTIME_PARTIAL


def test_unknown_is_never_guessed():
    with pytest.raises(CapabilityUnavailable):
        require_capability("audio.generation", EvidenceLevel.RUNTIME_PARTIAL)
''')

w('tests/test_contract.py', r'''
import json
from gfs.registry_build import REQUIRED_SECTIONS, discover, validate


def test_all_107_skills_exist_and_validate(repo_root):
    specs = discover(repo_root)
    assert len(specs) == 107
    errors = validate(repo_root, specs)
    assert errors == [], "\n".join(errors)


def test_each_skill_has_example_and_cases(repo_root):
    for spec in discover(repo_root):
        skill_dir = spec.path.parent
        assert (skill_dir / "examples" / "example.md").is_file(), spec.id
        cases = skill_dir / "tests" / "cases.yaml"
        assert cases.is_file(), spec.id
        payload = json.loads(cases.read_text(encoding="utf-8"))
        assert payload["skill"] == spec.id
        kinds = {row["kind"] for row in payload["cases"]}
        assert {"happy_path", "bad_input"} <= kinds
''')

w('tests/test_graph.py', r'''
from gfs.registry_build import discover


def test_dependency_layers_never_point_up(repo_root):
    specs = discover(repo_root)
    by_id = {s.id: s for s in specs}
    for spec in specs:
        for dep in spec.meta.get("dependencies", []):
            assert by_id[dep].meta["layer"] <= spec.meta["layer"], (spec.id, dep)
''')

w('tests/test_plan.py', r'''
import json


def test_plan_declares_107_unique_ids(repo_root):
    data = json.loads((repo_root / "skills_plan" / "plan.json").read_text(encoding="utf-8"))
    ids = [row["id"] for row in data["skills"]]
    assert data["skill_count"] == 107
    assert len(ids) == len(set(ids)) == 107
''')

w('tests/integration/test_professional_scenarios.py', r'''
from gfs.routing import GenerationMethod, route_generation_method
from gfs.qc import GateVerdict, acceptance_gate


def test_luxury_perfume_hero_prefers_reference_control_and_hard_product_qc():
    route = route_generation_method(reference_count=2, product_geometry_critical=True)
    assert route.method is GenerationMethod.REFERENCE
    verdict, _ = acceptance_gate(
        {"product": 9.4, "lighting": 8.8, "motion": 8.6, "composition": 9.0},
        critical_dimensions=("product",),
    )
    assert verdict is GateVerdict.PASS


def test_social_vertical_talking_product_start_frame_routes_i2v():
    route = route_generation_method(has_start_image=True, exact_start_composition=True)
    assert route.method is GenerationMethod.I2V


def test_localized_artifact_on_good_car_shot_routes_edit_not_blind_regeneration():
    route = route_generation_method(has_existing_video=True, defect_localized=True)
    assert route.method is GenerationMethod.EDIT
''')

print(f"Bootstrapped executable system and plan for {len(S)} skills at {ROOT}")
