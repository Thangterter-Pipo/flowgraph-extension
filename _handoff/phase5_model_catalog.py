from __future__ import annotations
import json, hashlib, re
from pathlib import Path
from textwrap import dedent

ROOT=Path(r'E:\Google-flow-skills')
SRC=ROOT/'src'/'gfs'
TESTS=ROOT/'tests'
TOOLS=ROOT/'tools'
MR=ROOT/'model_registry'

(SRC/'model_catalog.py').write_text(dedent(r'''
from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class NormalizedModel:
    usage_key: str
    family: str | None
    family_name: str | None
    kind: str | None
    duration_seconds: int | None
    requirements: tuple[tuple[str, ...], ...]
    max_image_refs: int | None
    max_audio_refs: int | None
    max_characters: int | None
    max_video_duration: int | None
    generation_time_seconds: int | None
    outputs_audio: bool | None
    deprecated: bool
    status: str | None
    credit_mapping: dict[str, Any]


@dataclass(frozen=True)
class EvidenceModelCrossCheck:
    model_key: str
    operation: str
    evidence_level: str
    in_normalized_snapshot: bool
    snapshot_status: str | None
    snapshot_kind: str | None
    note: str


class ModelCatalogError(ValueError):
    pass


class ModelCatalog:
    """Read-only view of the full active model snapshot plus runtime evidence cache.

    The normalized snapshot describes active usageKeys observed on 2026-08-27. The
    evidence registry is a smaller, newer runtime cache. Absence from the older
    normalized snapshot does not invalidate a later RUNTIME_VERIFIED capture.
    """

    def __init__(self, root: Path | None = None):
        self.root=(root or Path(__file__).resolve().parents[2]).resolve()
        self.normalized_path=self.root/'model_registry'/'normalized_registry.json'
        self.evidence_path=self.root/'model_registry'/'registry.json'
        if not self.normalized_path.is_file():
            raise ModelCatalogError('normalized_registry.json is missing; guessing active usageKeys is forbidden')
        if not self.evidence_path.is_file():
            raise ModelCatalogError('evidence registry.json is missing')
        self.normalized_raw=json.loads(self.normalized_path.read_text(encoding='utf-8'))
        self.evidence_raw=json.loads(self.evidence_path.read_text(encoding='utf-8'))
        self._validate_normalized()

    @property
    def sha256(self) -> str:
        return hashlib.sha256(self.normalized_path.read_bytes()).hexdigest()

    def _validate_normalized(self) -> None:
        if not isinstance(self.normalized_raw, dict):
            raise ModelCatalogError('normalized registry must be an object keyed by usageKey')
        seen=set()
        for key,row in self.normalized_raw.items():
            if not isinstance(row,dict):
                raise ModelCatalogError(f'{key}: model row must be an object')
            if row.get('usageKey') != key:
                raise ModelCatalogError(f'{key}: usageKey mismatch {row.get("usageKey")!r}')
            if key in seen:
                raise ModelCatalogError(f'duplicate usageKey {key}')
            seen.add(key)
            if row.get('kind') not in {'image','video'}:
                raise ModelCatalogError(f'{key}: unknown kind {row.get("kind")!r}')
            reqs=row.get('requirements') or []
            if not isinstance(reqs,list) or any(not isinstance(x,list) for x in reqs):
                raise ModelCatalogError(f'{key}: requirements must be list[list[str]]')

    def __len__(self) -> int:
        return len(self.normalized_raw)

    def get(self, usage_key: str) -> NormalizedModel:
        try: row=self.normalized_raw[usage_key]
        except KeyError as exc: raise KeyError(f'Unknown normalized usageKey {usage_key!r}') from exc
        return NormalizedModel(
            usage_key=usage_key, family=row.get('family'), family_name=row.get('familyName'), kind=row.get('kind'),
            duration_seconds=row.get('durationSeconds'), requirements=tuple(tuple(x) for x in (row.get('requirements') or [])),
            max_image_refs=row.get('maxImageRefs'), max_audio_refs=row.get('maxAudioRefs'), max_characters=row.get('maxCharacters'),
            max_video_duration=row.get('maxVideoDuration'), generation_time_seconds=row.get('generationTimeSeconds'),
            outputs_audio=row.get('outputsAudio'), deprecated=bool(row.get('deprecated')), status=row.get('status'),
            credit_mapping=dict(row.get('creditMapping') or {}),
        )

    def active(self, *, kind: str | None = None) -> list[NormalizedModel]:
        rows=[]
        for key in self.normalized_raw:
            m=self.get(key)
            if m.deprecated or m.status != 'MODEL_AVAILABLE': continue
            if kind and m.kind != kind: continue
            rows.append(m)
        return rows

    def supporting(self, requirement: str, *, kind: str | None = None) -> list[NormalizedModel]:
        req=requirement.upper()
        out=[]
        for m in self.active(kind=kind):
            if any(req in variant for variant in m.requirements): out.append(m)
        return out

    def cross_check_evidence(self) -> list[EvidenceModelCrossCheck]:
        rows=[]
        for item in self.evidence_raw.get('models',[]):
            key=item['model_key']; normalized=self.normalized_raw.get(key)
            present=normalized is not None
            if present:
                note='Exact usageKey exists in the 2026-08-27 active normalized snapshot.'
            else:
                note='Absent from the 2026-08-27 active snapshot; retain newer runtime evidence without inventing an alias.'
            rows.append(EvidenceModelCrossCheck(
                model_key=key, operation=item.get('operation',''), evidence_level=item.get('evidence_level','UNKNOWN'),
                in_normalized_snapshot=present, snapshot_status=None if not present else normalized.get('status'),
                snapshot_kind=None if not present else normalized.get('kind'), note=note,
            ))
        return rows

    def summary(self) -> dict[str, Any]:
        active=self.active()
        kinds={}
        for m in active: kinds[m.kind]=kinds.get(m.kind,0)+1
        cross=self.cross_check_evidence()
        return {
            'normalized_usage_keys': len(self), 'active_models': len(active), 'kinds': kinds,
            'sha256': self.sha256, 'evidence_models': len(cross),
            'evidence_exact_snapshot_matches': sum(x.in_normalized_snapshot for x in cross),
            'evidence_newer_or_alias_keys': [x.model_key for x in cross if not x.in_normalized_snapshot],
        }
''').lstrip(),encoding='utf-8')

(TOOLS/'validate_model_registry.py').write_text(dedent(r'''
from __future__ import annotations
import hashlib, json
from pathlib import Path
import sys

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'src'))
from gfs.model_catalog import ModelCatalog

catalog=ModelCatalog(ROOT)
snapshot=ROOT/'snapshots'/'2026-08-27'/'normalized_registry.json'
if not snapshot.is_file(): raise SystemExit('snapshot copy missing')
main_hash=hashlib.sha256(catalog.normalized_path.read_bytes()).hexdigest()
snap_hash=hashlib.sha256(snapshot.read_bytes()).hexdigest()
if main_hash != snap_hash: raise SystemExit('normalized registry and dated snapshot differ')
if len(catalog) != 82: raise SystemExit(f'expected 82 usageKeys from documented source, got {len(catalog)}')
if len(catalog.active()) != 82: raise SystemExit('documented snapshot should contain 82 active, non-deprecated models')
summary=catalog.summary()
provenance={
    'snapshot_date':'2026-08-27',
    'verified_in_repo':'2026-08-29',
    'sha256':main_hash,
    'usage_key_count':len(catalog),
    'active_count':len(catalog.active()),
    'source_copies':['model_registry/normalized_registry.json','snapshots/2026-08-27/normalized_registry.json'],
    'note':'Imported from the user project evidence corpus. This is an active-model snapshot, not a replacement for per-operation runtime evidence labels.',
    'evidence_cross_check':[
        {'model_key':x.model_key,'operation':x.operation,'evidence_level':x.evidence_level,'in_normalized_snapshot':x.in_normalized_snapshot,'note':x.note}
        for x in catalog.cross_check_evidence()
    ],
}
(ROOT/'model_registry'/'provenance.json').write_text(json.dumps(provenance,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps(summary,ensure_ascii=False,indent=2))
''').lstrip(),encoding='utf-8')

(TESTS/'test_model_catalog.py').write_text(dedent(r'''
from gfs.model_catalog import ModelCatalog


def test_full_normalized_registry_is_present_and_valid():
    c=ModelCatalog()
    assert len(c)==82
    assert len(c.active())==82
    assert len(c.active(kind='image'))==5
    assert len(c.active(kind='video'))==77
    assert c.get('NARWHAL').kind=='image'
    assert c.get('abra_t2v_8s').duration_seconds==8


def test_requirement_search_uses_normalized_requirements():
    c=ModelCatalog()
    refs={m.usage_key for m in c.supporting('VIDEO_REQUIREMENT_REFERENCES',kind='video')}
    assert 'abra_r2v_4s' in refs
    assert 'veo_3_1_r2v_lite' in refs
    starts={m.usage_key for m in c.supporting('VIDEO_REQUIREMENT_START_IMAGE',kind='video')}
    assert 'abra_i2v_8s' in starts


def test_evidence_cache_is_cross_checked_without_rewriting_newer_keys():
    c=ModelCatalog(); rows={x.model_key:x for x in c.cross_check_evidence()}
    assert rows['abra_t2v_8s'].in_normalized_snapshot
    assert not rows['veo_3_1_edit_lite'].in_normalized_snapshot
    assert rows['veo_3_1_edit_lite'].evidence_level=='RUNTIME_VERIFIED'
''').lstrip(),encoding='utf-8')

# Update evidence registry metadata now that full normalized source is present.
p=MR/'registry.json'; d=json.loads(p.read_text(encoding='utf-8'))
d['completeness']='FULL_ACTIVE_SNAPSHOT_PLUS_RUNTIME_EVIDENCE_CACHE'
d['completeness_note']='Full 82-usageKey active snapshot from 2026-08-27 is present in model_registry/normalized_registry.json with a byte-identical dated snapshot. This evidence-labelled registry remains the runtime resolver authority because its captures are operation-specific and in some cases newer (2026-08-28). A runtime-verified key absent from the older snapshot is retained as verified evidence and is not silently aliased.'
p.write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')

# Add CLI models command without changing resolver semantics.
p=SRC/'cli.py'; s=p.read_text(encoding='utf-8')
if 'from .model_catalog import ModelCatalog' not in s:
    s=s.replace('from .media_integrity import inspect_media\n','from .media_integrity import inspect_media\nfrom .model_catalog import ModelCatalog\n')
if 'sub.add_parser("models")' not in s:
    s=s.replace('    p = sub.add_parser("live-preflight")\n','    p = sub.add_parser("live-preflight")\n    p = sub.add_parser("models"); p.add_argument("--kind", choices=["image","video"]); p.add_argument("--requirement")\n')
needle='''    if args.cmd == "live-preflight":\n        policy = RuntimePolicy.from_env()\n        print(json.dumps({"mode": policy.mode.value, "allow_credits": policy.allow_credits, "allow_partial": policy.allow_partial}, indent=2))\n        return 0\n'''
if 'if args.cmd == "models":' not in s:
    add=needle+'''    if args.cmd == "models":\n        catalog=ModelCatalog()\n        if args.requirement:\n            rows=catalog.supporting(args.requirement,kind=args.kind)\n            payload={"count":len(rows),"models":[m.usage_key for m in rows]}\n        elif args.kind:\n            rows=catalog.active(kind=args.kind); payload={"count":len(rows),"models":[m.usage_key for m in rows]}\n        else:\n            payload=catalog.summary()\n        print(json.dumps(payload,ensure_ascii=False,indent=2))\n        return 0\n'''
    s=s.replace(needle,add)
p.write_text(s,encoding='utf-8')

# Update docs status truthfully.
p=ROOT/'docs'/'IMPLEMENTATION_STATUS.md'; s=p.read_text(encoding='utf-8')
old='- No invented full 82-model registry: the local registry remains an evidence-labelled partial cache until the documented normalized registry is supplied.\n'
new='- Full 82-usageKey normalized active-model snapshot is now imported from the user evidence corpus and hash-verified against the dated 2026-08-27 snapshot. It is used for discovery/cross-checking; operation dispatch still requires evidence-labelled runtime models.\n'
s=s.replace(old,new)
if 'Model catalog provenance' not in s:
    s += '\n## Model catalog provenance\n\n`model_registry/normalized_registry.json` contains 82 active usageKeys (5 image, 77 video). `tools/validate_model_registry.py` requires a byte-identical `snapshots/2026-08-27/normalized_registry.json`, validates key/usageKey identity, and writes `model_registry/provenance.json`. Runtime evidence from 2026-08-28 remains authoritative for actual dispatch; notably `veo_3_1_edit_lite` is runtime-verified but absent from the older active snapshot, so it is retained without inventing an alias.\n'
p.write_text(s,encoding='utf-8')

# Canonical rebuild validates registry after generators and before tests.
p=TOOLS/'rebuild_repository.py'; s=p.read_text(encoding='utf-8')
marker="run([PY,'-m','gfs.registry_build','--root',str(ROOT)],env=env)\n"
if 'validate_model_registry.py' not in s:
    s=s.replace(marker,marker+"run([PY,str(ROOT/'tools'/'validate_model_registry.py')],env=env)\n")
p.write_text(s,encoding='utf-8')
print('Installed full model catalog ingestion, provenance, CLI, tests, and rebuild validation')
