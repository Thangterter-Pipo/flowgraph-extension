from pathlib import Path
from textwrap import dedent
ROOT=Path(r'E:\Google-flow-skills')
SRC=ROOT/'src'/'gfs'; TESTS=ROOT/'tests'

def w(p,text):
 p.parent.mkdir(parents=True,exist_ok=True);p.write_text(dedent(text).lstrip(),encoding='utf-8')

w(SRC/'artifact_store.py',r'''
from __future__ import annotations

import copy
import json
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator, RefResolver

from .schema_refs import parse_ref, resolve_ref, repo_root
from .skill_registry import RegisteredSkill, SkillRegistry


class OwnershipViolation(PermissionError):
    pass


class ArtifactValidationError(ValueError):
    pass


def _segments(pointer: str) -> list[str]:
    if not pointer:
        return []
    return [x.replace("~1", "/").replace("~0", "~") for x in pointer.lstrip("/").split("/")]


def schema_pointer_to_instance_path(pointer: str) -> list[str]:
    """Translate a schema pointer such as /properties/color/properties/texture
    into the instance path [color, texture]. This contract intentionally uses
    property-only ownership pointers; arrays remain owned at their containing field.
    """
    segs = _segments(pointer)
    out: list[str] = []
    i = 0
    while i < len(segs):
        token = segs[i]
        if token == "properties":
            if i + 1 >= len(segs):
                raise ValueError(f"Dangling properties token in {pointer!r}")
            out.append(segs[i + 1])
            i += 2
            continue
        if token in {"items", "$defs"}:
            raise ValueError(f"Ownership pointer {pointer!r} targets schema structure not a direct object property")
        i += 1
    return out


def _contains(owner_ref: str, target_ref: str) -> bool:
    owner_schema, owner_ptr = parse_ref(owner_ref)
    target_schema, target_ptr = parse_ref(target_ref)
    if owner_schema != target_schema:
        return False
    owner = _segments(owner_ptr)
    target = _segments(target_ptr)
    return target[:len(owner)] == owner


class ArtifactStore:
    def __init__(self, registry: SkillRegistry | None = None, root: Path | None = None):
        self.registry = registry or SkillRegistry()
        self.root = root or repo_root()
        self._docs: dict[tuple[str, str], Any] = {}

    def _key(self, schema_name: str, artifact_key: str) -> tuple[str, str]:
        return schema_name, artifact_key

    def seed(self, schema_name: str, value: Any, *, artifact_key: str = "default", validate: bool = True) -> None:
        ref = f"{schema_name}#"
        if validate:
            self._validate_value(ref, value)
        self._docs[self._key(schema_name, artifact_key)] = copy.deepcopy(value)

    def read(self, ref: str, *, artifact_key: str = "default") -> Any:
        schema_name, pointer = parse_ref(ref)
        doc = self._docs.get(self._key(schema_name, artifact_key))
        if doc is None:
            return None
        cur = doc
        for token in schema_pointer_to_instance_path(pointer):
            if not isinstance(cur, dict) or token not in cur:
                return None
            cur = cur[token]
        return copy.deepcopy(cur)

    def write(self, skill: RegisteredSkill | str, ref: str, value: Any, *, artifact_key: str = "default", validate: bool = True) -> None:
        if isinstance(skill, str):
            skill = self.registry.get(skill)
        if not any(_contains(owner, ref) for owner in skill.owns):
            raise OwnershipViolation(f"{skill.id} cannot write {ref}; owns={list(skill.owns)}")
        if validate:
            self._validate_value(ref, value)
        schema_name, pointer = parse_ref(ref)
        key = self._key(schema_name, artifact_key)
        if not pointer:
            self._docs[key] = copy.deepcopy(value)
            return
        doc = self._docs.setdefault(key, {})
        if not isinstance(doc, dict):
            raise ArtifactValidationError(f"Artifact {schema_name}/{artifact_key} is not an object")
        path = schema_pointer_to_instance_path(pointer)
        cur = doc
        for token in path[:-1]:
            nxt = cur.get(token)
            if nxt is None:
                nxt = {}
                cur[token] = nxt
            if not isinstance(nxt, dict):
                raise ArtifactValidationError(f"Cannot descend through non-object {token!r} for {ref}")
            cur = nxt
        cur[path[-1]] = copy.deepcopy(value)

    def _validate_value(self, ref: str, value: Any) -> None:
        resolved = resolve_ref(ref, self.root)
        full_schema = json.loads(resolved.schema_path.read_text(encoding="utf-8"))
        # RefResolver is deprecated upstream but remains the compatibility path in jsonschema
        # 4.x for relative file refs; keeping it local avoids network resolution.
        resolver = RefResolver(base_uri=resolved.schema_path.resolve().as_uri(), referrer=full_schema)
        validator = Draft202012Validator(resolved.node, resolver=resolver)
        errors = sorted(validator.iter_errors(value), key=lambda e: list(e.path))
        if errors:
            first = errors[0]
            where = ".".join(str(x) for x in first.path)
            raise ArtifactValidationError(f"{ref} invalid at {where or '<root>'}: {first.message}")

    def snapshot(self) -> dict[str, Any]:
        out: dict[str, Any] = {}
        for (schema, key), value in sorted(self._docs.items()):
            name = schema if key == "default" else f"{schema}:{key}"
            out[name] = copy.deepcopy(value)
        return out
''')

# Patch executor to support ownership-enforced proposed writes.
p=SRC/'executor.py';s=p.read_text(encoding='utf-8')
s=s.replace('from .skill_registry import RegisteredSkill, SkillRegistry\n', 'from .skill_registry import RegisteredSkill, SkillRegistry\nfrom .artifact_store import ArtifactStore\n')
s=s.replace('def execute(self, skill_id: str, input_data: Mapping[str, Any] | None, *, case_kind: str | None = None, produced_at: str | None = None) -> dict[str, Any]:', 'def execute(self, skill_id: str, input_data: Mapping[str, Any] | None, *, case_kind: str | None = None, produced_at: str | None = None, store: ArtifactStore | None = None, proposed_writes: Mapping[str, Any] | None = None, artifact_key: str = "default") -> dict[str, Any]:')
needle='''        timestamp = produced_at or datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")\n        env = SkillEnvelope('''
repl='''        writes_applied: list[str] = []\n        if proposed_writes:\n            if store is None:\n                raise ValueError("proposed_writes requires an ArtifactStore")\n            for ref, value in proposed_writes.items():\n                store.write(skill, ref, value, artifact_key=artifact_key)\n                writes_applied.append(ref)\n\n        timestamp = produced_at or datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")\n        env = SkillEnvelope('''
if needle not in s: raise RuntimeError('executor insertion marker missing')
s=s.replace(needle,repl)
s=s.replace('''                "side_effects": skill.side_effects,\n            },''','''                "side_effects": skill.side_effects,\n                "writes_applied": writes_applied,\n            },''')
p.write_text(s,encoding='utf-8')

# Replace project orchestrator with typed offline artifacts.
p=SRC/'project_orchestrator.py';s=p.read_text(encoding='utf-8')
s=s.replace('from .executor import SkillExecutor\n', 'from .executor import SkillExecutor\nfrom .artifact_store import ArtifactStore\n')
s=s.replace('''class OfflineProjectRun:\n    selected_skills: tuple[str, ...]\n    execution_order: tuple[str, ...]\n    executed: tuple[str, ...]\n    deferred_runtime: tuple[str, ...]\n    envelopes: tuple[dict[str, Any], ...]\n''','''class OfflineProjectRun:\n    selected_skills: tuple[str, ...]\n    execution_order: tuple[str, ...]\n    executed: tuple[str, ...]\n    deferred_runtime: tuple[str, ...]\n    envelopes: tuple[dict[str, Any], ...]\n    artifacts: dict[str, Any]\n''')
old='''        for sid in order:\n            skill = self.registry.get(sid)\n            if skill.category == "flow" or skill.side_effects in {"network", "credits"}:\n                deferred.append(sid)\n                continue\n            envelopes.append(self.executor.execute(sid, context))\n            executed.append(sid)\n        return OfflineProjectRun(tuple(order), tuple(order), tuple(executed), tuple(deferred), tuple(envelopes))\n'''
new='''        for sid in order:\n            skill = self.registry.get(sid)\n            if skill.category == "flow" or skill.side_effects in {"network", "credits"}:\n                deferred.append(sid)\n                continue\n            envelopes.append(self.executor.execute(sid, context))\n            executed.append(sid)\n\n        store = ArtifactStore(self.registry)\n        production_plan = {\n            "project_id": "offline-project",\n            "selected_skills": list(order),\n            "execution_order": list(order),\n            "warnings": ["Offline mode: Flow/network/credit skills are deferred and no generation spend occurs."],\n        }\n        project_state = {\n            "completed_skills": list(executed),\n            "deferred_runtime_skills": list(deferred),\n            "generation": {}, "qc": {}, "retry_counts": {},\n        }\n        store.seed("production_plan", production_plan)\n        store.seed("project_state", project_state)\n        return OfflineProjectRun(tuple(order), tuple(order), tuple(executed), tuple(deferred), tuple(envelopes), store.snapshot())\n'''
if old not in s: raise RuntimeError('orchestrator replacement marker missing')
s=s.replace(old,new);p.write_text(s,encoding='utf-8')

# Update package exports.
p=SRC/'__init__.py';s=p.read_text(encoding='utf-8')
if 'ArtifactStore' not in s:
 s=s.replace('from .executor import SkillExecutor, SkillEnvelope, RuleDecisionBackend\n','from .executor import SkillExecutor, SkillEnvelope, RuleDecisionBackend\nfrom .artifact_store import ArtifactStore, OwnershipViolation, ArtifactValidationError\n')
 s=s.replace('"SkillExecutor", "SkillEnvelope", "RuleDecisionBackend",','"SkillExecutor", "SkillEnvelope", "RuleDecisionBackend", "ArtifactStore", "OwnershipViolation", "ArtifactValidationError",')
p.write_text(s,encoding='utf-8')

w(TESTS/'test_artifact_store.py',r'''
import pytest

from gfs.artifact_store import ArtifactStore, ArtifactValidationError, OwnershipViolation
from gfs.executor import SkillExecutor


FOCAL_REF = "shot_spec#/properties/cinematography/properties/lens/properties/focal_length_mm"
LIGHT_REF = "shot_spec#/properties/lighting/properties/key"


def test_owned_write_is_applied_and_readable():
    store = ArtifactStore()
    SkillExecutor().execute(
        "craft/focal-length-designer", {"brief": "85mm portrait"}, store=store,
        proposed_writes={FOCAL_REF: 85}, produced_at="2026-08-29T00:00:00Z",
    )
    assert store.read(FOCAL_REF) == 85


def test_skill_cannot_write_neighbor_domain():
    store = ArtifactStore()
    with pytest.raises(OwnershipViolation):
        store.write("craft/focal-length-designer", LIGHT_REF, {"source": "softbox"})


def test_subschema_validation_rejects_wrong_value_type():
    store = ArtifactStore()
    with pytest.raises(ArtifactValidationError):
        store.write("craft/focal-length-designer", FOCAL_REF, "eighty-five")


def test_root_owner_can_seed_valid_project_bible():
    store = ArtifactStore()
    value = {
        "project_id": "p-test", "title": "Fictional Test", "genre": "genre/luxury-commercial",
        "delivery": {"aspect_ratio": "16:9", "total_duration_seconds": 20},
        "brief_interpretation": {"stated_request": "fictional brief", "controlling_objective": "Show product clearly"},
    }
    store.write("foundation/project-intake", "project_bible#", value)
    assert store.read("project_bible#")["title"] == "Fictional Test"
''')

# Patch project orchestrator integration test to require typed artifacts.
p=TESTS/'integration'/'test_project_orchestrator.py';s=p.read_text(encoding='utf-8')
if 'production_plan' not in s.split('assert run.envelopes',1)[-1]:
 s=s.replace('    assert run.envelopes\n','    assert run.envelopes\n    assert run.artifacts["production_plan"]["execution_order"]\n    assert run.artifacts["project_state"]["deferred_runtime_skills"] == list(run.deferred_runtime)\n')
p.write_text(s,encoding='utf-8')

# Validate every shared schema itself under Draft 2020-12.
w(TESTS/'test_schema_library.py',r'''
import json
from jsonschema import Draft202012Validator


def test_every_shared_schema_is_valid_draft_2020_12(repo_root):
    for path in (repo_root / "schemas").glob("*.schema.json"):
        schema = json.loads(path.read_text(encoding="utf-8"))
        Draft202012Validator.check_schema(schema)
''')

print('Added ownership-enforcing ArtifactStore and typed offline orchestration artifacts')
