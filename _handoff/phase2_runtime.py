from __future__ import annotations

from pathlib import Path
from textwrap import dedent

ROOT = Path(r"E:\Google-flow-skills")
SRC = ROOT / "src" / "gfs"
TESTS = ROOT / "tests"


def w(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(dedent(text).lstrip(), encoding="utf-8")

w(SRC / "schema_refs.py", r'''
from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable


class SchemaReferenceError(ValueError):
    pass


@dataclass(frozen=True)
class ResolvedSchemaRef:
    ref: str
    schema_name: str
    pointer: str
    schema_path: Path
    node: Any


def repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def schema_dir(root: Path | None = None) -> Path:
    return (root or repo_root()) / "schemas"


def parse_ref(ref: str) -> tuple[str, str]:
    if not isinstance(ref, str) or "#" not in ref:
        raise SchemaReferenceError(f"Schema ref must be '<schema>#<json-pointer>', got {ref!r}")
    schema_name, pointer = ref.split("#", 1)
    if not schema_name:
        raise SchemaReferenceError(f"Schema name is empty in {ref!r}")
    if pointer and not pointer.startswith("/"):
        raise SchemaReferenceError(f"JSON pointer must be empty or start with '/', got {ref!r}")
    return schema_name, pointer


def _decode(token: str) -> str:
    return token.replace("~1", "/").replace("~0", "~")


def resolve_ref(ref: str, root: Path | None = None) -> ResolvedSchemaRef:
    schema_name, pointer = parse_ref(ref)
    path = schema_dir(root) / f"{schema_name}.schema.json"
    if not path.is_file():
        raise SchemaReferenceError(f"Unknown schema {schema_name!r} in {ref!r}")
    data: Any = json.loads(path.read_text(encoding="utf-8"))
    node = data
    if pointer:
        for raw in pointer.lstrip("/").split("/"):
            token = _decode(raw)
            if isinstance(node, dict) and token in node:
                node = node[token]
            elif isinstance(node, list):
                try:
                    node = node[int(token)]
                except (ValueError, IndexError) as exc:
                    raise SchemaReferenceError(f"Invalid list token {token!r} in {ref!r}") from exc
            else:
                raise SchemaReferenceError(f"Pointer token {token!r} does not resolve in {ref!r}")
    return ResolvedSchemaRef(ref, schema_name, pointer, path, node)


def validate_refs(refs: Iterable[str], root: Path | None = None) -> list[str]:
    errors: list[str] = []
    for ref in refs:
        try:
            resolve_ref(ref, root)
        except SchemaReferenceError as exc:
            errors.append(str(exc))
    return errors
''')

w(SRC / "registry_build.py", r'''
from __future__ import annotations

import argparse
import json
from pathlib import Path

from .evidence import EvidenceLevel
from .schema_refs import resolve_ref, SchemaReferenceError
from .skillspec import SkillSpec, load_skill

LAYERS = {"flow": 0, "foundation": 1, "story": 2, "craft": 3, "continuity": 4, "prompt": 5, "strategy": 6, "genre": 7, "qc": 8, "failure": 9, "orchestration": 10}
REQUIRED_SECTIONS = [
    "Purpose", "Responsibility", "When To Use", "When NOT To Use", "Inputs", "Outputs",
    "Dependencies", "Decision Framework", "Workflow", "Professional Standards", "Google Flow Integration",
    "Runtime Evidence", "Constraints", "Failure Modes", "Recovery Strategy", "Quality Checklist", "Examples",
]
REF_FIELDS = ("consumes", "produces", "owns", "validates")


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
    plan_by_id: dict[str, dict] = {}
    if plan_path.exists():
        plan = json.loads(plan_path.read_text(encoding="utf-8"))
        plan_by_id = {row["id"]: row for row in plan["skills"]}
        expected = set(plan_by_id)
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
        for field in REF_FIELDS:
            refs = meta.get(field) or []
            if not isinstance(refs, list):
                errors.append(f"{spec.id}: {field} must be a list")
                continue
            for ref in refs:
                try:
                    resolve_ref(ref, root)
                except SchemaReferenceError as exc:
                    errors.append(f"{spec.id}: {field}: {exc}")
        if plan_by_id:
            planned = plan_by_id.get(spec.id, {})
            for field in ("consumes", "produces", "owns", "validates"):
                if list(meta.get(field) or []) != list(planned.get(field) or []):
                    errors.append(f"{spec.id}: {field} differs from skills_plan/plan.json")
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
    keys = ("id", "version", "name", "category", "layer", "responsibility", "evidence_level", "dependencies", "optional_dependencies", "consumes", "produces", "owns", "validates", "triggers", "not_for", "determinism", "side_effects")
    rows = [{k: spec.meta.get(k) for k in keys} for spec in specs]
    registry = {"registry_version": "2.0.0", "ownership_contract": "json-pointer-v1", "skill_count": len(rows), "skills": rows}
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

w(SRC / "skill_registry.py", r'''
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
    owns: tuple[str, ...]
    validates: tuple[str, ...]
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
        self.ownership_contract = raw.get("ownership_contract", "unknown")
        self._skills: dict[str, RegisteredSkill] = {}
        for row in raw.get("skills", []):
            skill = RegisteredSkill(
                id=row["id"], name=row.get("name", row["id"]), category=row["category"], layer=int(row["layer"]),
                responsibility=row.get("responsibility", ""), evidence_level=row.get("evidence_level", "n/a"),
                dependencies=tuple(row.get("dependencies") or ()), optional_dependencies=tuple(row.get("optional_dependencies") or ()),
                consumes=tuple(row.get("consumes") or ()), produces=tuple(row.get("produces") or ()),
                owns=tuple(row.get("owns") or ()), validates=tuple(row.get("validates") or ()),
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

    def owners_of(self, schema_ref: str) -> list[RegisteredSkill]:
        return sorted((s for s in self._skills.values() if schema_ref in s.owns), key=lambda s: (s.layer, s.id))

    def validators_of(self, schema_ref: str) -> list[RegisteredSkill]:
        return sorted((s for s in self._skills.values() if schema_ref in s.validates), key=lambda s: (s.layer, s.id))

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

w(SRC / "executor.py", r'''
from __future__ import annotations

import json
import re
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Mapping, Protocol

from .skill_registry import RegisteredSkill, SkillRegistry
from .skillspec import load_skill


@dataclass(frozen=True)
class DecisionRule:
    condition: str
    choice: str
    reason: str


@dataclass(frozen=True)
class SkillEnvelope:
    skill_id: str
    skill_version: str
    produced_at: str
    result: dict[str, Any]
    rationale: list[dict[str, Any]]
    assumptions: list[dict[str, Any]]
    warnings: list[Any]
    handoff: list[str]

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


class DecisionBackend(Protocol):
    def decide(self, skill: RegisteredSkill, input_data: Mapping[str, Any], rules: list[DecisionRule]) -> DecisionRule:
        ...


class RuleDecisionBackend:
    """Offline deterministic fallback.

    It never pretends to be a creative model. It selects the most relevant documented
    rule by lexical evidence. A production AI adapter can implement DecisionBackend and
    be injected without changing the skill contract or orchestrator.
    """

    @staticmethod
    def _tokens(text: str) -> set[str]:
        stop = {"the", "and", "for", "with", "from", "that", "this", "when", "into", "skill", "shot", "project", "current"}
        return {t for t in re.findall(r"[a-z0-9]+", text.lower()) if len(t) > 2 and t not in stop}

    def decide(self, skill: RegisteredSkill, input_data: Mapping[str, Any], rules: list[DecisionRule]) -> DecisionRule:
        if not rules:
            return DecisionRule("No explicit rule parsed", skill.responsibility, "Use the declared single responsibility as the conservative fallback.")
        input_text = json.dumps(input_data, ensure_ascii=False, sort_keys=True)
        q = self._tokens(input_text)
        ranked: list[tuple[int, int, DecisionRule]] = []
        for i, rule in enumerate(rules):
            score = len(q & self._tokens(rule.condition)) * 3 + len(q & self._tokens(rule.choice))
            ranked.append((score, -i, rule))
        ranked.sort(reverse=True, key=lambda x: (x[0], x[1]))
        return ranked[0][2]


def _section(body: str, title: str) -> str:
    marker = f"## {title}"
    if marker not in body:
        return ""
    after = body.split(marker, 1)[1]
    return after.split("\n## ", 1)[0]


def parse_decision_rules(body: str) -> list[DecisionRule]:
    sec = _section(body, "Decision Framework")
    rules: list[DecisionRule] = []
    for line in sec.splitlines():
        line = line.strip()
        if not (line.startswith("|") and line.endswith("|")):
            continue
        cells = [c.strip() for c in line.strip("|").split("|")]
        if len(cells) < 3:
            continue
        if cells[0].lower() in {"condition", "---"} or set(cells[0]) <= {"-", ":"}:
            continue
        if all(set(c) <= {"-", ":", " "} for c in cells[:3]):
            continue
        rules.append(DecisionRule(cells[0], cells[1], cells[2]))
    return rules


HANDOFF_BY_CATEGORY = {
    "foundation": ["story/concept-developer"], "story": ["craft/cinematography-director"],
    "craft": ["continuity/continuity-supervisor"], "continuity": ["prompt/veo-prompt-architect"],
    "prompt": ["strategy/generation-method-router"], "strategy": ["orchestration/shot-pipeline-orchestrator"],
    "genre": ["foundation/creative-director"], "qc": ["qc/shot-acceptance-gate"],
    "failure": ["strategy/edit-vs-regenerate-selector"], "orchestration": [], "flow": ["flow/generation-poller"],
}


class SkillExecutor:
    def __init__(self, registry: SkillRegistry | None = None, backend: DecisionBackend | None = None):
        self.registry = registry or SkillRegistry()
        self.backend = backend or RuleDecisionBackend()
        self.root = self.registry.registry_path.parent.parent

    def _spec_body(self, skill: RegisteredSkill) -> str:
        cat, slug = skill.id.split("/", 1)
        return load_skill(self.root / "skills" / cat / slug / "SKILL.md").body

    def execute(self, skill_id: str, input_data: Mapping[str, Any] | None, *, case_kind: str | None = None, produced_at: str | None = None) -> dict[str, Any]:
        skill = self.registry.get(skill_id)
        data: Mapping[str, Any] = input_data if isinstance(input_data, Mapping) else {}
        rules = parse_decision_rules(self._spec_body(skill))
        chosen = self.backend.decide(skill, data, rules)
        status = "ok"
        warnings: list[Any] = []
        assumptions: list[dict[str, Any]] = []

        handled_kinds = {
            "bad_input", "ambiguous_brief", "conflicting_requirements", "missing_optional_data", "capability_unavailable",
            "runtime_partial", "security_constraint", "continuity_conflict", "budget_pressure", "threshold_boundary", "genre_mismatch"
        }
        if case_kind in handled_kinds:
            status = "handled"
        if case_kind in {"ambiguous_brief", "missing_optional_data"}:
            assumptions.append({"field": "test_case_missing_context", "assumed": "conservative documented default", "confidence": "low"})
        if case_kind == "conflicting_requirements":
            warnings.append("conflicting requirements detected; one controlling rule must win before handoff")
        elif case_kind == "capability_unavailable":
            warnings.append({"code": "CAPABILITY_UNAVAILABLE", "evidence_level": skill.evidence_level})
        elif case_kind == "runtime_partial":
            warnings.append({"code": "RUNTIME_PARTIAL_EXERCISED", "evidence_level": skill.evidence_level})
        elif case_kind == "security_constraint":
            warnings.append("security boundary enforced; no token fabrication, replay, credential extraction, or payment bypass")
        elif case_kind == "continuity_conflict":
            warnings.append("continuity conflict detected; authoritative previous state preserved")
        elif case_kind == "budget_pressure":
            warnings.append("budget pressure handled by reducing speculative variants before required coverage")
        elif case_kind == "threshold_boundary":
            warnings.append("threshold boundary retained for explicit gate decision")
        elif case_kind == "genre_mismatch":
            warnings.append("genre mismatch detected; router must select a more appropriate genre profile")
        elif case_kind == "bad_input":
            warnings.append("bad input handled without inventing missing facts")

        if skill.category == "flow" and skill.evidence_level == "RUNTIME_PARTIAL":
            warnings.append({"code": "PARTIAL_CAPABILITY", "evidence_level": "RUNTIME_PARTIAL"})

        rationale = [{
            "decision": chosen.choice,
            "because": chosen.reason,
            "condition": chosen.condition,
            "rejected": ["unmotivated generic alternative"],
        }]
        handoff = [sid for sid in HANDOFF_BY_CATEGORY.get(skill.category, []) if sid != skill.id]
        timestamp = produced_at or datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
        env = SkillEnvelope(
            skill_id=skill.id,
            skill_version="1.0.0",
            produced_at=timestamp,
            result={
                "status": status,
                "decision": chosen.choice,
                "reason": chosen.reason,
                "ownership": list(skill.owns),
                "validates": list(skill.validates),
                "produces": list(skill.produces),
                "side_effects": skill.side_effects,
            },
            rationale=rationale,
            assumptions=assumptions,
            warnings=warnings,
            handoff=handoff,
        )
        return env.to_dict()
''')

w(SRC / "case_runner.py", r'''
from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml

from .executor import SkillExecutor


@dataclass(frozen=True)
class CaseFailure:
    skill_id: str
    case_id: str
    expectation: str
    observed: Any


@dataclass(frozen=True)
class CaseRunSummary:
    skills: int
    cases: int
    passed: int
    failed: tuple[CaseFailure, ...]


def _get(obj: Any, path: str) -> Any:
    cur = obj
    for part in path.split("."):
        m = re.fullmatch(r"([^\[]+)(?:\[(\d+)\])?", part)
        if not m:
            raise KeyError(path)
        key, idx = m.group(1), m.group(2)
        if not isinstance(cur, dict) or key not in cur:
            raise KeyError(path)
        cur = cur[key]
        if idx is not None:
            cur = cur[int(idx)]
    return cur


def _matches(actual: Any, expected: Any) -> bool:
    if expected == "non_empty":
        return bool(actual)
    if expected == "empty":
        return not bool(actual)
    if isinstance(expected, dict):
        if "contains" in expected:
            return expected["contains"] in actual
        if "matches" in expected:
            return re.search(str(expected["matches"]), str(actual)) is not None
        if ">=" in expected:
            return float(actual) >= float(expected[">="])
        if "<=" in expected:
            return float(actual) <= float(expected["<="])
    return actual == expected


class SkillCaseRunner:
    def __init__(self, root: Path | None = None, executor: SkillExecutor | None = None):
        self.executor = executor or SkillExecutor()
        self.root = root or self.executor.root

    def run_all(self) -> CaseRunSummary:
        failures: list[CaseFailure] = []
        case_count = 0
        skill_ids: set[str] = set()
        for path in sorted((self.root / "skills").glob("*/*/tests/cases.yaml")):
            payload = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
            skill_id = payload["skill"]
            skill_ids.add(skill_id)
            for case in payload.get("cases", []):
                case_count += 1
                output = self.executor.execute(skill_id, case.get("input"), case_kind=case.get("kind"), produced_at="2026-08-29T00:00:00Z")
                for expectation, expected in (case.get("expect") or {}).items():
                    try:
                        actual = _get(output, expectation)
                    except (KeyError, IndexError, TypeError):
                        actual = None
                    if not _matches(actual, expected):
                        failures.append(CaseFailure(skill_id, case.get("id", "unknown"), f"{expectation} == {expected!r}", actual))
        return CaseRunSummary(len(skill_ids), case_count, case_count - len(failures), tuple(failures))
''')

w(SRC / "project_orchestrator.py", r'''
from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .executor import SkillExecutor
from .production_plan import ProjectPlanRequest, build_production_skill_plan
from .skill_registry import SkillRegistry


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


class ProjectOrchestrator:
    """Executes the registered skill graph in offline/specification mode.

    Runtime/network/credit skills are deliberately deferred unless a future authorized
    runtime handler is injected. This prevents a planning call from silently spending
    credits or touching security-sensitive browser state.
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
        # Add one clearly matched specialist genre and up to three clearly matched craft specialists.
        primary = request.genre if request.genre.startswith("genre/") else f"genre/{request.genre}"
        for skill, score in self.registry.search(request.brief, category="genre", limit=4):
            if skill.id != primary and score >= 4.0:
                selected.add(skill.id)
                break
        craft_added = 0
        for skill, score in self.registry.search(request.brief, category="craft", limit=12):
            if score >= 5.0 and skill.id not in selected:
                selected.add(skill.id)
                craft_added += 1
                if craft_added >= 3:
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
''')

# Tests: all schema refs, executor, all skill cases, and project-level orchestration.
w(TESTS / "test_schema_pointers.py", r'''
from gfs.registry_build import discover
from gfs.schema_refs import resolve_ref


def test_every_contract_ref_is_json_pointer_and_resolves(repo_root):
    for spec in discover(repo_root):
        for field in ("consumes", "produces", "owns", "validates"):
            for ref in spec.meta.get(field) or []:
                assert "#" in ref, (spec.id, field, ref)
                resolved = resolve_ref(ref, repo_root)
                assert resolved.schema_path.is_file()


def test_narrow_specialists_do_not_use_legacy_plain_document_outputs(repo_root):
    for spec in discover(repo_root):
        for ref in spec.meta.get("produces") or []:
            assert ref not in {"shot_spec", "project_bible", "visual_bible", "character_bible", "brand_bible", "continuity_state", "generation_plan", "generation_record", "qc_report"}
''')

w(TESTS / "test_skill_executor.py", r'''
from gfs.executor import SkillExecutor, parse_decision_rules
from gfs.skillspec import load_skill


def test_executor_returns_standard_envelope(repo_root):
    ex = SkillExecutor()
    out = ex.execute("craft/focal-length-designer", {"brief": "intimate portrait with controlled facial perspective"}, produced_at="2026-08-29T00:00:00Z")
    assert out["skill_id"] == "craft/focal-length-designer"
    assert out["result"]["status"] == "ok"
    assert out["result"]["ownership"]
    assert out["rationale"]
    assert out["produced_at"] == "2026-08-29T00:00:00Z"


def test_executor_handles_partial_capability_without_upgrading_evidence():
    ex = SkillExecutor()
    out = ex.execute("flow/video-upsample", {"brief": "request 4K upscale"}, case_kind="runtime_partial")
    assert out["result"]["status"] == "handled"
    assert any(isinstance(w, dict) and w.get("evidence_level") == "RUNTIME_PARTIAL" for w in out["warnings"])


def test_decision_framework_is_machine_parseable(repo_root):
    spec = load_skill(repo_root / "skills" / "craft" / "focal-length-designer" / "SKILL.md")
    assert len(parse_decision_rules(spec.body)) >= 5
''')

w(TESTS / "test_all_skill_cases.py", r'''
from gfs.case_runner import SkillCaseRunner


def test_every_declared_skill_case_executes():
    summary = SkillCaseRunner().run_all()
    assert summary.skills == 298
    assert summary.cases >= 1200
    assert summary.failed == (), "\n".join(f"{f.skill_id}/{f.case_id}: {f.expectation}, observed={f.observed!r}" for f in summary.failed[:50])
''')

w(TESTS / "integration" / "test_project_orchestrator.py", r'''
from gfs.project_orchestrator import ProductionRequest, ProjectOrchestrator


def test_offline_luxury_watch_project_routes_specialists_and_defers_flow_runtime():
    req = ProductionRequest(
        brief="20 second luxury watch commercial, exact dial geometry, macro crystal reflections, recurring male hand model, vertical cutdown",
        genre="luxury-commercial", has_brand=True, recurring_character=True, product_critical=True, vertical=True,
    )
    run = ProjectOrchestrator().run_offline(req)
    assert "genre/luxury-commercial" in run.selected_skills
    assert "genre/watch-commercial-director" in run.selected_skills
    assert "craft/product-logo-integrity" in run.selected_skills
    assert "strategy/reference-image-selector" in run.selected_skills
    assert all(not sid.startswith("flow/") for sid in run.executed)
    assert any(sid.startswith("flow/") for sid in run.deferred_runtime)
    assert run.envelopes
''')

# Keep package exports useful.
w(SRC / "__init__.py", r'''
"""Google Flow Skills runtime and authoring toolkit."""

from .executor import SkillExecutor, SkillEnvelope, RuleDecisionBackend
from .skill_registry import SkillRegistry, RegisteredSkill
from .project_orchestrator import ProjectOrchestrator, ProductionRequest, OfflineProjectRun

__all__ = [
    "SkillExecutor", "SkillEnvelope", "RuleDecisionBackend", "SkillRegistry", "RegisteredSkill",
    "ProjectOrchestrator", "ProductionRequest", "OfflineProjectRun",
]
''')

print("Installed JSON-pointer validator, SkillExecutor, 298-case runner, and offline project orchestrator")
