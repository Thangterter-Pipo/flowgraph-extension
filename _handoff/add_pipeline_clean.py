from __future__ import annotations

from pathlib import Path
from textwrap import dedent

ROOT = Path(r"E:\Google-flow-skills")

def w(rel: str, text: str) -> None:
    p = ROOT / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(dedent(text).lstrip(), encoding="utf-8")

w('src/gfs/skill_registry.py', r'''
from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable


@dataclass(frozen=True)
class RegisteredSkill:
    id: str
    name: str
    category: str
    layer: int
    responsibility: str
    evidence_level: str
    dependencies: tuple[str, ...]
    optional_dependencies: tuple[str, ...]
    consumes: tuple[str, ...]
    produces: tuple[str, ...]
    triggers: tuple[str, ...]
    not_for: tuple[str, ...]
    determinism: str
    side_effects: str


class SkillRegistry:
    def __init__(self, registry_path: str | Path | None = None):
        if registry_path is None:
            registry_path = Path(__file__).resolve().parents[2] / "skills" / "registry.json"
        self.registry_path = Path(registry_path)
        raw = json.loads(self.registry_path.read_text(encoding="utf-8"))
        self.version = raw.get("registry_version", "unknown")
        self._skills: dict[str, RegisteredSkill] = {}
        for row in raw.get("skills", []):
            skill = RegisteredSkill(
                id=row["id"], name=row.get("name", row["id"]), category=row["category"], layer=int(row["layer"]),
                responsibility=row.get("responsibility", ""), evidence_level=row.get("evidence_level", "n/a"),
                dependencies=tuple(row.get("dependencies") or ()), optional_dependencies=tuple(row.get("optional_dependencies") or ()),
                consumes=tuple(row.get("consumes") or ()), produces=tuple(row.get("produces") or ()),
                triggers=tuple(row.get("triggers") or ()), not_for=tuple(row.get("not_for") or ()),
                determinism=row.get("determinism", "heuristic"), side_effects=row.get("side_effects", "none"),
            )
            self._skills[skill.id] = skill

    def __len__(self) -> int:
        return len(self._skills)

    def get(self, skill_id: str) -> RegisteredSkill:
        try:
            return self._skills[skill_id]
        except KeyError as exc:
            raise KeyError(f"Unknown skill id {skill_id!r}") from exc

    def by_category(self, category: str) -> list[RegisteredSkill]:
        return sorted((s for s in self._skills.values() if s.category == category), key=lambda s: s.id)

    @staticmethod
    def _tokens(text: str) -> set[str]:
        return {t for t in re.findall(r"[a-z0-9]+", text.lower()) if len(t) > 2}

    def search(self, text: str, *, category: str | None = None, limit: int = 12) -> list[tuple[RegisteredSkill, float]]:
        query = self._tokens(text)
        if not query:
            return []
        scored: list[tuple[RegisteredSkill, float]] = []
        for skill in self._skills.values():
            if category and skill.category != category:
                continue
            id_tokens = self._tokens(skill.id.replace("/", " ").replace("-", " "))
            body_tokens = self._tokens(" ".join((skill.name, skill.responsibility, *skill.triggers)))
            overlap_id = len(query & id_tokens)
            overlap_body = len(query & body_tokens)
            if overlap_id or overlap_body:
                score = overlap_id * 3.0 + overlap_body * 1.0
                scored.append((skill, score))
        scored.sort(key=lambda item: (-item[1], item[0].layer, item[0].id))
        return scored[:limit]

    def dependency_closure(self, skill_ids: Iterable[str], *, include_optional: bool = False) -> set[str]:
        wanted = set(skill_ids)
        stack = list(wanted)
        while stack:
            current = stack.pop()
            skill = self.get(current)
            deps = list(skill.dependencies)
            if include_optional:
                deps.extend(skill.optional_dependencies)
            for dep in deps:
                if dep not in wanted:
                    wanted.add(dep)
                    stack.append(dep)
        return wanted

    def topological_order(self, skill_ids: Iterable[str]) -> list[str]:
        selected = self.dependency_closure(skill_ids)
        indegree = {sid: 0 for sid in selected}
        children: dict[str, list[str]] = {sid: [] for sid in selected}
        for sid in selected:
            for dep in self.get(sid).dependencies:
                if dep in selected:
                    indegree[sid] += 1
                    children[dep].append(sid)
        ready = sorted((sid for sid, degree in indegree.items() if degree == 0), key=lambda x: (self.get(x).layer, x))
        result: list[str] = []
        while ready:
            node = ready.pop(0)
            result.append(node)
            for child in children[node]:
                indegree[child] -= 1
                if indegree[child] == 0:
                    ready.append(child)
                    ready.sort(key=lambda x: (self.get(x).layer, x))
        if len(result) != len(selected):
            raise ValueError("Selected dependency graph contains a cycle")
        return result
''')

w('src/gfs/continuity.py', r'''
from __future__ import annotations

import copy
from dataclasses import dataclass
from typing import Any, Iterable


@dataclass(frozen=True)
class ContinuityConflict:
    path: str
    previous: Any
    proposed: Any
    severity: str = "hard"


def _get(obj: dict[str, Any], dotted: str) -> tuple[bool, Any]:
    cur: Any = obj
    for part in dotted.split("."):
        if not isinstance(cur, dict) or part not in cur:
            return False, None
        cur = cur[part]
    return True, cur


def _deep_merge(base: dict[str, Any], overlay: dict[str, Any]) -> dict[str, Any]:
    out = copy.deepcopy(base)
    for key, value in overlay.items():
        if isinstance(value, dict) and isinstance(out.get(key), dict):
            out[key] = _deep_merge(out[key], value)
        else:
            out[key] = copy.deepcopy(value)
    return out


def validate_locked_transition(previous: dict[str, Any], proposed: dict[str, Any], locked_paths: Iterable[str], *, allowed_changes: Iterable[str] = ()) -> list[ContinuityConflict]:
    allowed = set(allowed_changes)
    conflicts: list[ContinuityConflict] = []
    for path in locked_paths:
        if path in allowed:
            continue
        prev_exists, prev = _get(previous, path)
        new_exists, new = _get(proposed, path)
        if prev_exists and new_exists and prev != new:
            conflicts.append(ContinuityConflict(path, prev, new))
    return conflicts


def carry_forward(previous: dict[str, Any], proposed_changes: dict[str, Any]) -> dict[str, Any]:
    """Return next continuity state by preserving all unspecified prior fields."""
    return _deep_merge(previous, proposed_changes)
''')

w('src/gfs/prompting.py', r'''
from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .routing import GenerationMethod


@dataclass(frozen=True)
class PromptDraft:
    method: GenerationMethod
    text: str
    warnings: tuple[str, ...]


def _render(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, (int, float, bool)):
        return str(value)
    if isinstance(value, list):
        return ", ".join(filter(None, (_render(v) for v in value)))
    if isinstance(value, dict):
        bits = []
        for key, val in value.items():
            rendered = _render(val)
            if rendered:
                bits.append(f"{key.replace('_', ' ')} {rendered}")
        return "; ".join(bits)
    return str(value)


ORDER = (
    "subject", "action", "environment", "cinematography", "camera", "composition",
    "lighting", "color", "texture", "performance", "motion", "temporal_behavior",
    "continuity_anchors", "avoidance_constraints",
)


def compose_veo_prompt(shot_spec: dict[str, Any], method: GenerationMethod | str) -> PromptDraft:
    method = method if isinstance(method, GenerationMethod) else GenerationMethod(method)
    warnings: list[str] = []
    parts: list[str] = []

    prefixes = {
        GenerationMethod.T2V: "Create a single coherent video shot.",
        GenerationMethod.I2V: "Starting from the approved start image, preserve its identity, product geometry, and composition unless the shot specification explicitly changes them.",
        GenerationMethod.START_END: "Move plausibly from the approved start frame to the approved end frame; preserve endpoint identity and make the transition physically and narratively motivated.",
        GenerationMethod.REFERENCE: "Use the approved reference images as identity and object anchors; preserve their defining geometry while following the shot action.",
        GenerationMethod.EDIT: "Preserve successful regions of the source video and change only the specifically requested defect or extension.",
    }
    parts.append(prefixes[method])

    for key in ORDER:
        if key not in shot_spec:
            continue
        rendered = _render(shot_spec[key])
        if rendered:
            parts.append(rendered.rstrip(".") + ".")

    text = " ".join(parts)
    lower = text.lower()
    conflicts = [
        (("locked off" in lower or "locked-off" in lower) and "handheld" in lower, "locked camera conflicts with handheld movement"),
        ("high key" in lower and "low key" in lower, "high-key and low-key instructions coexist"),
        ("completely still" in lower and any(x in lower for x in ("running", "sprinting", "walking")), "subject stillness conflicts with locomotion"),
        ("ultra wide" in lower and "85mm macro" in lower, "ultra-wide perspective conflicts with 85mm macro language"),
    ]
    warnings.extend(reason for bad, reason in conflicts if bad)
    if any(term in lower for term in ("epic masterpiece", "ultra beautiful", "very professional", "8k hyper realistic masterpiece")):
        warnings.append("generic adjective stack detected; replace it with observable image behavior")
    return PromptDraft(method=method, text=text, warnings=tuple(warnings))
''')

w('src/gfs/budget.py', r'''
from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable

from .models import ModelResolver, ModelResolutionError


@dataclass(frozen=True)
class ShotBudgetRequest:
    shot_id: str
    operation: str
    priority: int = 3          # 1..5
    uncertainty: float = 0.5  # 0..1
    min_variants: int = 1
    max_variants: int = 2
    target_resolution: str | None = None


@dataclass(frozen=True)
class ShotAllocation:
    shot_id: str
    model_key: str
    observed_cost_per_variant: int | None
    variants: int
    reserved_credits: int | None
    warning: str | None = None


@dataclass(frozen=True)
class BudgetPlan:
    allocations: tuple[ShotAllocation, ...]
    observed_total: int
    unpriced_shots: tuple[str, ...]
    remaining_credits: int


def allocate_generation_budget(available_credits: int, requests: Iterable[ShotBudgetRequest], resolver: ModelResolver | None = None) -> BudgetPlan:
    if available_credits < 0:
        raise ValueError("available_credits cannot be negative")
    resolver = resolver or ModelResolver()
    reqs = list(requests)
    resolved = []
    for req in reqs:
        if not 1 <= req.priority <= 5:
            raise ValueError("priority must be 1..5")
        if not 0 <= req.uncertainty <= 1:
            raise ValueError("uncertainty must be 0..1")
        if not 1 <= req.min_variants <= req.max_variants:
            raise ValueError("variant bounds are invalid")
        choice = resolver.resolve(req.operation, target_resolution=req.target_resolution)
        resolved.append([req, choice, req.min_variants])

    known_min = sum((choice.observed_credit_cost or 0) * variants for req, choice, variants in resolved)
    if known_min > available_credits:
        raise ValueError(f"minimum observed allocation requires {known_min} credits but only {available_credits} are available")
    remaining = available_credits - known_min

    # Spend optional variants where priority * uncertainty is highest. Unknown price
    # is never assumed to be zero for optimization; it remains unpriced.
    candidates = sorted(resolved, key=lambda row: (-(row[0].priority * (0.5 + row[0].uncertainty)), row[0].shot_id))
    changed = True
    while changed:
        changed = False
        for row in candidates:
            req, choice, variants = row
            cost = choice.observed_credit_cost
            if variants >= req.max_variants or cost is None:
                continue
            if remaining >= cost:
                row[2] += 1
                remaining -= cost
                changed = True

    allocations = []
    unpriced = []
    observed_total = 0
    for req, choice, variants in resolved:
        cost = choice.observed_credit_cost
        reserved = None if cost is None else cost * variants
        warning = None
        if cost is None:
            unpriced.append(req.shot_id)
            warning = "No isolated observed credit price; do not guess a cost."
        else:
            observed_total += reserved
        allocations.append(ShotAllocation(req.shot_id, choice.model_key, cost, variants, reserved, warning))
    return BudgetPlan(tuple(allocations), observed_total, tuple(unpriced), remaining)
''')

w('src/gfs/runtime_adapter.py', r'''
from __future__ import annotations

from dataclasses import dataclass

from .evidence import EvidenceLevel, require_capability
from .payloads import (
    video_edit_fields, video_reference_fields, video_start_end_fields,
    video_start_image_fields,
)
from .routing import GenerationMethod


@dataclass(frozen=True)
class PreparedDispatch:
    method: GenerationMethod
    capability: str
    evidence_level: EvidenceLevel
    media_fragment: dict
    warning: str | None = None


METHOD_CAPABILITY = {
    GenerationMethod.T2V: "video.t2v",
    GenerationMethod.I2V: "video.i2v",
    GenerationMethod.START_END: "video.interpolation",
    GenerationMethod.REFERENCE: "video.reference",
    GenerationMethod.EDIT: "video.edit",
}


def prepare_dispatch(
    method: GenerationMethod | str,
    *,
    start_media_id: str | None = None,
    end_media_id: str | None = None,
    reference_media_ids: tuple[str, ...] = (),
    video_input_media_id: str | None = None,
    min_evidence: EvidenceLevel = EvidenceLevel.RUNTIME_VERIFIED,
) -> PreparedDispatch:
    method = method if isinstance(method, GenerationMethod) else GenerationMethod(method)
    capability_name = METHOD_CAPABILITY[method]
    cap = require_capability(capability_name, min_evidence)
    fragment: dict = {}
    if method is GenerationMethod.I2V:
        if not start_media_id:
            raise ValueError("i2v requires start_media_id")
        fragment = video_start_image_fields(start_media_id)
    elif method is GenerationMethod.START_END:
        if not start_media_id or not end_media_id:
            raise ValueError("start_end requires start_media_id and end_media_id")
        fragment = video_start_end_fields(start_media_id, end_media_id)
    elif method is GenerationMethod.REFERENCE:
        fragment = video_reference_fields(reference_media_ids)
    elif method is GenerationMethod.EDIT:
        if not video_input_media_id:
            raise ValueError("edit requires video_input_media_id")
        fragment = video_edit_fields(video_input_media_id)
    warning = None
    if cap.level is EvidenceLevel.RUNTIME_PARTIAL:
        warning = f"{capability_name} is runtime-partial ({cap.reference}); delivery is not guaranteed"
    return PreparedDispatch(method, capability_name, cap.level, fragment, warning)
''')

w('src/gfs/production_plan.py', r'''
from __future__ import annotations

from dataclasses import dataclass

from .skill_registry import SkillRegistry


@dataclass(frozen=True)
class ProjectPlanRequest:
    genre: str
    has_brand: bool = False
    recurring_character: bool = False
    product_critical: bool = False
    short_form: bool = False
    vertical: bool = False
    audio_intent: bool = False
    documentary_truth_constraints: bool = False


@dataclass(frozen=True)
class ProductionSkillPlan:
    requested: tuple[str, ...]
    ordered_with_dependencies: tuple[str, ...]


CORE = {
    "foundation/project-intake", "foundation/creative-director", "foundation/visual-bible-builder",
    "story/creative-brief-analyzer", "story/concept-developer", "story/story-architect", "story/story-beat-designer",
    "story/scene-designer", "story/shot-list-designer", "story/shot-spec-builder",
    "craft/cinematography-director", "craft/shot-size-designer", "craft/lens-director", "craft/focal-length-designer",
    "craft/camera-movement-director", "craft/composition-director", "craft/framing-designer",
    "craft/lighting-director", "craft/key-light-designer", "craft/fill-light-designer",
    "craft/color-director", "craft/palette-designer", "craft/production-designer", "craft/material-designer",
    "craft/performance-director", "craft/motion-director", "craft/temporal-designer", "craft/shot-duration-designer",
    "continuity/continuity-supervisor", "continuity/continuity-state-manager",
    "prompt/veo-prompt-architect", "prompt/veo-shot-prompt-writer", "prompt/prompt-conflict-detector", "prompt/veo-prompt-validator",
    "strategy/generation-method-router", "strategy/reference-asset-director", "strategy/generation-strategy-planner",
    "strategy/shot-generation-router", "qc/prompt-quality-critic", "qc/video-quality-critic", "qc/generation-result-scorer",
    "qc/shot-acceptance-gate", "failure/generation-failure-analyzer", "strategy/edit-vs-regenerate-selector", "strategy/retry-strategy",
    "orchestration/shot-pipeline-orchestrator", "orchestration/project-qc-manager", "orchestration/project-manifest-builder",
    "orchestration/video-production-orchestrator",
}


def build_production_skill_plan(req: ProjectPlanRequest, registry: SkillRegistry | None = None) -> ProductionSkillPlan:
    registry = registry or SkillRegistry()
    selected = set(CORE)
    genre_id = req.genre if req.genre.startswith("genre/") else f"genre/{req.genre}"
    registry.get(genre_id)  # fail explicitly rather than silently using the wrong genre
    selected.add(genre_id)

    if req.has_brand:
        selected.update({"foundation/brand-bible-builder", "qc/brand-consistency-critic"})
    if req.recurring_character:
        selected.update({
            "foundation/character-bible-builder", "craft/character-designer", "craft/character-reference-director",
            "craft/face-consistency-supervisor", "craft/character-continuity-supervisor",
            "continuity/character-continuity", "qc/character-consistency-critic", "failure/identity-drift-analyzer",
            "strategy/reference-image-selector",
        })
    if req.product_critical:
        selected.update({
            "craft/product-hero-shot", "craft/product-material-rendering", "craft/product-logo-integrity",
            "craft/product-reference-consistency", "qc/product-consistency-critic", "strategy/reference-image-selector",
        })
    if req.short_form:
        selected.update({"story/hook-designer", "story/first-three-seconds-director", "story/retention-director", "story/short-form-shot-planner", "craft/social-pacing-director"})
    if req.vertical:
        selected.update({"craft/vertical-video-director", "craft/platform-safe-composition", "craft/caption-safe-area-planner"})
    if req.audio_intent:
        selected.update({"craft/sound-design-director", "craft/audio-intent-designer", "craft/music-direction", "craft/dialogue-intent-designer"})
    if req.documentary_truth_constraints:
        selected.update({"foundation/documentary-director", "genre/documentary"})

    ordered = registry.topological_order(selected)
    return ProductionSkillPlan(tuple(sorted(selected)), tuple(ordered))
''')

w('src/gfs/orchestrator.py', r'''
from __future__ import annotations

from dataclasses import dataclass

from .prompting import PromptDraft, compose_veo_prompt
from .routing import RoutingDecision, route_generation_method
from .runtime_adapter import PreparedDispatch, prepare_dispatch


@dataclass(frozen=True)
class ShotPreparation:
    route: RoutingDecision
    prompt: PromptDraft
    dispatch: PreparedDispatch


def prepare_shot(
    shot_spec: dict,
    *,
    has_existing_video: bool = False,
    defect_localized: bool = False,
    start_media_id: str | None = None,
    end_media_id: str | None = None,
    reference_media_ids: tuple[str, ...] = (),
    video_input_media_id: str | None = None,
    strict_identity: bool = False,
    product_geometry_critical: bool = False,
    exact_start_composition: bool = False,
) -> ShotPreparation:
    route = route_generation_method(
        has_existing_video=has_existing_video,
        defect_localized=defect_localized,
        has_start_image=bool(start_media_id),
        has_end_image=bool(end_media_id),
        reference_count=len(reference_media_ids),
        strict_identity=strict_identity,
        product_geometry_critical=product_geometry_critical,
        exact_start_composition=exact_start_composition,
    )
    prompt = compose_veo_prompt(shot_spec, route.method)
    if prompt.warnings:
        raise ValueError("Prompt preflight conflict: " + "; ".join(prompt.warnings))
    dispatch = prepare_dispatch(
        route.method,
        start_media_id=start_media_id,
        end_media_id=end_media_id,
        reference_media_ids=reference_media_ids,
        video_input_media_id=video_input_media_id,
    )
    return ShotPreparation(route, prompt, dispatch)
''')

# Extend exports.
w('src/gfs/__init__.py', r'''
"""Executable infrastructure for Google-Flow-Skills.

Creative expertise lives in the skill packages. This package provides the
machine-readable registry, evidence gates, verified payload fragments, planning,
prompt composition, continuity checks, budget allocation and orchestration helpers.
"""

from .evidence import EvidenceLevel, require_capability
from .models import ModelResolver
from .routing import GenerationMethod, route_generation_method
from .skill_registry import SkillRegistry
from .production_plan import ProjectPlanRequest, build_production_skill_plan
from .orchestrator import prepare_shot

__all__ = [
    "EvidenceLevel", "require_capability", "ModelResolver", "GenerationMethod",
    "route_generation_method", "SkillRegistry", "ProjectPlanRequest",
    "build_production_skill_plan", "prepare_shot",
]
''')

w('tests/test_skill_registry.py', r'''
from gfs.skill_registry import SkillRegistry


def test_registry_loads_full_explicit_specialist_inventory():
    registry = SkillRegistry()
    assert len(registry) >= 298
    assert registry.get("craft/focal-length-designer").category == "craft"
    assert registry.get("genre/perfume-ad-director").category == "genre"
    assert registry.get("continuity/prop-continuity").category == "continuity"


def test_search_finds_specific_genre_and_craft():
    registry = SkillRegistry()
    genre = registry.search("perfume luxury bottle commercial", category="genre")
    ids = [s.id for s, _ in genre]
    assert "genre/perfume-ad-director" in ids
    craft = registry.search("focal length perspective portrait", category="craft")
    ids = [s.id for s, _ in craft]
    assert any(i in ids for i in ("craft/focal-length-designer", "craft/lens-director", "craft/perspective-designer"))


def test_dependency_closure_is_topologically_ordered():
    registry = SkillRegistry()
    order = registry.topological_order({"orchestration/video-production-orchestrator"})
    pos = {sid: i for i, sid in enumerate(order)}
    for sid in order:
        for dep in registry.get(sid).dependencies:
            if dep in pos:
                assert pos[dep] < pos[sid]
''')

w('tests/test_continuity.py', r'''
from gfs.continuity import carry_forward, validate_locked_transition


def test_locked_state_detects_unapproved_wardrobe_drift():
    prev = {"character": {"wardrobe": "black silk dress", "hair": "low tied"}, "props": {"glass": "right_hand"}}
    proposed = {"character": {"wardrobe": "red dress", "hair": "low tied"}, "props": {"glass": "right_hand"}}
    conflicts = validate_locked_transition(prev, proposed, ["character.wardrobe", "character.hair", "props.glass"])
    assert [c.path for c in conflicts] == ["character.wardrobe"]


def test_allowed_story_change_is_not_flagged():
    prev = {"props": {"glass": "right_hand"}}
    proposed = {"props": {"glass": "table"}}
    assert validate_locked_transition(prev, proposed, ["props.glass"], allowed_changes=["props.glass"]) == []


def test_carry_forward_preserves_unspecified_state():
    assert carry_forward({"a": 1, "nested": {"x": 2, "y": 3}}, {"nested": {"x": 9}}) == {"a": 1, "nested": {"x": 9, "y": 3}}
''')

w('tests/test_prompting.py', r'''
import pytest
from gfs.prompting import compose_veo_prompt
from gfs.routing import GenerationMethod


def test_i2v_prompt_preserves_start_image_contract():
    draft = compose_veo_prompt({
        "subject": "a fictional black perfume bottle with silver cap",
        "action": "mist drifts behind the bottle while the bottle remains geometrically unchanged",
        "camera": "slow 15 degree orbit",
        "lighting": "narrow soft strip camera-left with controlled rim",
    }, GenerationMethod.I2V)
    assert "Starting from the approved start image" in draft.text
    assert draft.warnings == ()


def test_prompt_conflict_detects_locked_plus_handheld():
    draft = compose_veo_prompt({"camera": "locked-off camera and rapid handheld camera"}, "t2v")
    assert draft.warnings
''')

w('tests/test_budget.py', r'''
from gfs.budget import ShotBudgetRequest, allocate_generation_budget


def test_budget_uses_registry_observed_costs_and_allocates_priority():
    plan = allocate_generation_budget(60, [
        ShotBudgetRequest("S1", "t2v", priority=5, uncertainty=1.0, min_variants=1, max_variants=3),
        ShotBudgetRequest("S2", "i2v", priority=2, uncertainty=0.2, min_variants=1, max_variants=2),
    ])
    by_id = {a.shot_id: a for a in plan.allocations}
    assert by_id["S1"].observed_cost_per_variant == 12
    assert by_id["S2"].observed_cost_per_variant == 15
    assert by_id["S1"].variants >= by_id["S2"].variants
    assert plan.observed_total <= 60
''')

w('tests/test_production_plan.py', r'''
from gfs.production_plan import ProjectPlanRequest, build_production_skill_plan


def test_perfume_plan_routes_explicit_genre_product_character_specialists():
    plan = build_production_skill_plan(ProjectPlanRequest(
        genre="perfume-ad-director", has_brand=True, recurring_character=True,
        product_critical=True, short_form=False, vertical=False,
    ))
    wanted = set(plan.ordered_with_dependencies)
    assert "genre/perfume-ad-director" in wanted
    assert "craft/product-logo-integrity" in wanted
    assert "craft/character-reference-director" in wanted
    assert "strategy/reference-image-selector" in wanted


def test_vertical_social_plan_adds_safe_area_and_retention_skills():
    plan = build_production_skill_plan(ProjectPlanRequest(
        genre="social-ad", has_brand=True, product_critical=True, short_form=True, vertical=True,
    ))
    wanted = set(plan.ordered_with_dependencies)
    assert {"craft/vertical-video-director", "craft/platform-safe-composition", "craft/caption-safe-area-planner", "story/retention-director"} <= wanted
''')

w('tests/integration/test_shot_preparation.py', r'''
from gfs.orchestrator import prepare_shot
from gfs.routing import GenerationMethod


def test_reference_controlled_luxury_product_shot_prepares_verified_media_fragment():
    shot = {
        "subject": "fictional premium watch, exact approved geometry",
        "action": "second hand advances while a controlled highlight travels across the crystal",
        "cinematography": "85mm macro perspective, product-level camera",
        "camera": "slow 12 degree orbit with eased stop",
        "lighting": "two narrow strip reflections and dark controlled environment",
        "continuity_anchors": "dial layout, case proportions, crown position and bracelet remain unchanged",
    }
    prep = prepare_shot(shot, reference_media_ids=("ref-watch-front", "ref-watch-side"), product_geometry_critical=True)
    assert prep.route.method is GenerationMethod.REFERENCE
    assert prep.dispatch.media_fragment["referenceImages"][0]["imageUsageType"] == "IMAGE_USAGE_TYPE_ASSET"
    assert "name" not in prep.dispatch.media_fragment["referenceImages"][0]


def test_start_end_product_reveal_prefers_interpolation():
    shot = {"subject":"fictional bottle", "action":"controlled reveal through mist", "camera":"slow forward drift"}
    prep = prepare_shot(shot, start_media_id="start-id", end_media_id="end-id")
    assert prep.route.method is GenerationMethod.START_END
    assert prep.dispatch.media_fragment == {"startImage":{"mediaId":"start-id"},"endImage":{"mediaId":"end-id"}}
''')

w('docs/IMPLEMENTATION_STATUS.md', r'''
# Implementation Status

## Implemented now

- Explicit specialist skill inventory generated from `skills_plan/plan.json`.
- Machine registry with dependency graph and evidence metadata.
- Evidence gate for verified / partial / bundle / unknown capabilities.
- Verified media-reference and image-upload payload fragment builders.
- Model resolver backed by the local evidence-labelled model registry; no guessed keys.
- Secret/PII/signed-URL redaction.
- Runtime error classifier separating security, schema, precondition, generation, transport, and CDP failures.
- Generation-method routing for T2V, I2V, start/end interpolation, reference images, and edit.
- Prompt composition with method-specific preservation language and basic conflict preflight.
- Continuity locked-field validation and immutable-style carry-forward helper.
- Credit-budget allocation from observed registry prices without treating observations as guaranteed future pricing.
- Skill registry search, dependency closure, and topological ordering.
- Project skill-plan builder for genre/brand/character/product/short-form/vertical/audio constraints.
- Shot preparation that produces prompt + evidence-gated dispatch media fragments.
- Structural, unit, and integration tests.

## Intentionally not implemented as a fake capability

- No standalone server-side reCAPTCHA acquisition.
- No CAPTCHA/security/payment/access-control bypass.
- No fabricated audio-generation endpoint.
- No fabricated seed-control API.
- No claim of successful video upsample when the source remains runtime-partial.
- No claim of successful cancel semantics when the source remains runtime-partial.
- No invented full 82-model registry: the local registry remains an evidence-labelled partial cache until the documented normalized registry is supplied.

## Runtime integration boundary

Generation mutations still require an authorized real browser/session and valid browser-generated security context. The repository prepares verified request fragments and capability decisions, but deliberately does not implement credential extraction or token replay. A production browser executor must inject the legitimate session context and preserve the security constraints in `SECURITY_POLICY.md`.
''')

# rebuild_repository.py is owned by the canonical build harness.

print("Added executable registry/planning/prompt/continuity/budget/orchestration layer")
