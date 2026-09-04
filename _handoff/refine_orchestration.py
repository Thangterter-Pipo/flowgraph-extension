from pathlib import Path
import json, yaml, re

ROOT=Path(r'E:\Google-flow-skills')
plan_path=ROOT/'skills_plan'/'plan.json'
plan=json.loads(plan_path.read_text(encoding='utf-8'))
by={s['id']:s for s in plan['skills']}

# Conditional QC dimensions must not be hard dependencies of every project.
sc=by['qc/generation-result-scorer']
base=[
 'qc/prompt-quality-critic','qc/cinematography-critic','qc/lighting-critic','qc/composition-critic',
 'qc/motion-critic','qc/physics-critic','qc/artifact-detector'
]
conditional=[
 'qc/anatomy-critic','qc/character-consistency-critic','qc/product-consistency-critic','qc/brand-consistency-critic','qc/continuity-critic'
]
sc['dependencies']=base
sc['optional_dependencies']=conditional
plan_path.write_text(json.dumps(plan,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')

# Apply plan dependency change and normalize all frontmatter without YAML anchors.
class NoAliasDumper(yaml.SafeDumper):
    def ignore_aliases(self, data):
        return True

order=['id','version','name','category','layer','responsibility','evidence_level','dependencies','optional_dependencies','consumes','produces','owns','validates','triggers','not_for','determinism','side_effects']
for skill in plan['skills']:
    cat,slug=skill['id'].split('/',1)
    path=ROOT/'skills'/cat/slug/'SKILL.md'
    text=path.read_text(encoding='utf-8')
    _,raw,body=text.split('---',2)
    meta=yaml.safe_load(raw) or {}
    # Plan is authoritative for machine fields.
    for field in ('dependencies','optional_dependencies','consumes','produces','owns','validates'):
        meta[field]=list(skill.get(field) or [])
    ordered={k:meta.get(k) for k in order if k in meta}
    for k,v in meta.items():
        if k not in ordered: ordered[k]=v
    fm=yaml.dump(ordered,Dumper=NoAliasDumper,sort_keys=False,allow_unicode=True,width=120).strip()
    path.write_text('---\n'+fm+'\n---\n'+body.lstrip(),encoding='utf-8')

# Replace project orchestrator with distinctive-token routing.
p=ROOT/'src'/'gfs'/'project_orchestrator.py'
p.write_text('''from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

from .executor import SkillExecutor
from .production_plan import ProjectPlanRequest, build_production_skill_plan
from .skill_registry import RegisteredSkill, SkillRegistry


@dataclass(frozen=True)
class ProductionRequest:
    brief: str
    genre: str
    has_brand: bool = False
    recurring_character: bool = False
    product_critical: bool = False
    short_form: bool = False
    vertical: bool = False
    audio_intent: bool = False
    documentary_truth_constraints: bool = False


@dataclass(frozen=True)
class OfflineProjectRun:
    selected_skills: tuple[str, ...]
    execution_order: tuple[str, ...]
    executed: tuple[str, ...]
    deferred_runtime: tuple[str, ...]
    envelopes: tuple[dict[str, Any], ...]


GENERIC_ID_TOKENS = {
    "genre", "film", "commercial", "director", "designer", "supervisor", "planner", "writer", "selector",
    "skill", "video", "ad", "brand", "social", "shot", "product", "character", "camera", "motion", "lighting",
    "color", "continuity", "quality", "critic", "analyzer", "flow", "real",
}


def _tokens(text: str) -> set[str]:
    return {t for t in re.findall(r"[a-z0-9]+", text.lower()) if len(t) > 2}


def _distinctive_tokens(skill: RegisteredSkill) -> set[str]:
    slug = skill.id.split("/", 1)[1]
    return {t for t in _tokens(slug.replace("-", " ")) if t not in GENERIC_ID_TOKENS}


def _has_distinctive_signal(skill: RegisteredSkill, brief: str) -> bool:
    distinctive = _distinctive_tokens(skill)
    if not distinctive:
        return False
    q = _tokens(brief)
    # Multiword identities such as real-estate need the non-generic anchor (estate);
    # watch/perfume/period/macro/reflection each carry their own specific anchor.
    return bool(distinctive & q)


class ProjectOrchestrator:
    """Executes the registered skill graph in offline/specification mode.

    Runtime/network/credit skills are deliberately deferred unless a future authorized
    runtime handler is injected. Planning therefore cannot silently spend credits or
    touch security-sensitive browser state.
    """

    def __init__(self, registry: SkillRegistry | None = None, executor: SkillExecutor | None = None):
        self.registry = registry or SkillRegistry()
        self.executor = executor or SkillExecutor(self.registry)

    def plan(self, request: ProductionRequest) -> tuple[str, ...]:
        base = build_production_skill_plan(ProjectPlanRequest(
            genre=request.genre, has_brand=request.has_brand, recurring_character=request.recurring_character,
            product_critical=request.product_critical, short_form=request.short_form, vertical=request.vertical,
            audio_intent=request.audio_intent, documentary_truth_constraints=request.documentary_truth_constraints,
        ), self.registry)
        selected = set(base.requested)
        primary = request.genre if request.genre.startswith("genre/") else f"genre/{request.genre}"

        # One secondary/specialist genre only when the brief contains a distinctive slug signal.
        for skill, score in self.registry.search(request.brief, category="genre", limit=12):
            if skill.id != primary and score >= 4.0 and _has_distinctive_signal(skill, request.brief):
                selected.add(skill.id)
                break

        # Add a small number of explicit craft specialists signaled by terms such as macro,
        # reflection, focal, drone, symmetry, particle, rack-focus, etc. Broad words alone
        # (camera/product/lighting) are not enough.
        craft_added = 0
        for skill, score in self.registry.search(request.brief, category="craft", limit=30):
            if score >= 4.0 and skill.id not in selected and _has_distinctive_signal(skill, request.brief):
                selected.add(skill.id)
                craft_added += 1
                if craft_added >= 4:
                    break
        return tuple(self.registry.topological_order(selected))

    def run_offline(self, request: ProductionRequest) -> OfflineProjectRun:
        order = self.plan(request)
        executed: list[str] = []
        deferred: list[str] = []
        envelopes: list[dict[str, Any]] = []
        context = {
            "brief": request.brief, "genre": request.genre, "has_brand": request.has_brand,
            "recurring_character": request.recurring_character, "product_critical": request.product_critical,
            "short_form": request.short_form, "vertical": request.vertical, "audio_intent": request.audio_intent,
            "documentary_truth_constraints": request.documentary_truth_constraints,
        }
        for sid in order:
            skill = self.registry.get(sid)
            if skill.category == "flow" or skill.side_effects in {"network", "credits"}:
                deferred.append(sid)
                continue
            envelopes.append(self.executor.execute(sid, context))
            executed.append(sid)
        return OfflineProjectRun(tuple(order), tuple(order), tuple(executed), tuple(deferred), tuple(envelopes))
''',encoding='utf-8')

# Routing regression tests.
t=ROOT/'tests'/'integration'/'test_project_routing.py'
t.write_text('''from gfs.project_orchestrator import ProductionRequest, ProjectOrchestrator


def test_perfume_does_not_route_period_without_period_signal():
    p = ProjectOrchestrator().plan(ProductionRequest(
        brief="30 second perfume film, recurring woman, Paris at night, low-key anamorphic",
        genre="perfume-ad-director", recurring_character=True, has_brand=True,
    ))
    assert "genre/perfume-ad-director" in p
    assert "genre/period-film" not in p


def test_documentary_does_not_route_real_estate_from_word_real():
    p = ProjectOrchestrator().plan(ProductionRequest(
        brief="observational documentary portrait at a real location with available light",
        genre="documentary", documentary_truth_constraints=True,
    ))
    assert "genre/documentary" in p
    assert "genre/real-estate-commercial-director" not in p


def test_watch_and_macro_reflection_signals_route_specific_specialists():
    p = ProjectOrchestrator().plan(ProductionRequest(
        brief="luxury watch commercial with macro dial detail and controlled reflection on crystal",
        genre="luxury-commercial", product_critical=True, has_brand=True,
    ))
    assert "genre/watch-commercial-director" in p
    assert "craft/product-macro-shot" in p
    assert "craft/product-reflection-control" in p
''',encoding='utf-8')

print('Refined conditional QC dependencies, distinctive routing, and normalized YAML frontmatter')
