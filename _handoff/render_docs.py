from __future__ import annotations

import json
from collections import Counter
from pathlib import Path
from textwrap import dedent

ROOT=Path(r"E:\Google-flow-skills")
plan=json.loads((ROOT/"skills_plan"/"plan.json").read_text(encoding="utf-8"))
rows=plan["skills"]
counts=Counter(r["category"] for r in rows)
order=["flow","foundation","story","craft","continuity","prompt","strategy","genre","qc","failure","orchestration"]

arch=f'''# Skills Architecture — Google-Flow-Skills

An evidence-aware AI filmmaking operating system for Google Flow / Veo. The repository implements an **explicit-specialist architecture**: every independently useful video element and every distinct video genre is represented by its own skill, while department-level directors coordinate rather than absorb those specialists.

**Current planned inventory: {plan['skill_count']} skills.**

---

## 1. Design axioms

1. **One independently testable responsibility = one skill.** Focal length, depth of field, key light, fill, headroom, cloth motion, prop continuity, product-logo integrity, TikTok grammar, perfume-commercial grammar, and each Flow operation can be routed and repaired independently.
2. **Directors coordinate; specialists decide.** `craft/lighting-director` owns the complete lighting plan, while `craft/key-light-designer`, `craft/fill-light-designer`, `craft/backlight-designer`, etc. own narrow parameters. The director integrates specialist outputs and resolves cross-parameter trade-offs; it does not erase the specialist skills.
3. **Creative layer never touches the wire.** No creative skill may hardcode an endpoint, payload field, model key, reCAPTCHA behavior, or credit price.
4. **Runtime layer never makes taste decisions.** Flow skills execute approved plans and never choose lens, framing, lighting, performance, or genre grammar.
5. **Evidence labels are load-bearing.** `[RUNTIME_PARTIAL]` is never upgraded to verified. `[UNKNOWN]` is never turned into a guessed API.
6. **State is typed and explicit.** Project, visual, brand, character, shot, continuity, generation, QC, and manifest state are shared JSON documents rather than free-form hidden context.
7. **Every heuristic decision is motivated.** Generic terms such as “more cinematic”, “epic”, or “beautiful” never substitute for observable behavior.
8. **Failure repair is causal.** Diagnose → identify owner → change minimum necessary parameters → edit/regenerate → compare score. Blind retry is prohibited.
9. **Security boundaries are hard constraints.** No CAPTCHA bypass, token fabrication/replay, cookie theft, OAuth extraction, quota bypass, or payment bypass.

---

## 2. Layer model

```text
L10 orchestration   project planning, routing, shot pipeline, manifests, asset/media/state/QC/budget managers
L9  failure         causal failure analyzers and repair planning
L8  qc              prompt/video/craft/identity/product/brand/artifact critics and acceptance gates
L7  genre           every distinct format/genre/commercial specialization
L6  strategy        method/reference/interpolation/edit/retry/variant/budget routing
L5  prompt          Veo prompt architecture, method writers, validation, conflict detection, compression
L4  continuity      authoritative project state plus per-domain continuity specialists
L3  craft           cinematography, lens, camera, lighting, color, production, character, wardrobe, performance,
                   motion, composition, temporal, product, vertical/social, sound-intent specialists
L2  story           brief analysis, concept, beats, script, scenes, sequences, storyboard, coverage, hooks
L1  foundation      intake, creative/film/visual/commercial/narrative/documentary direction and project bibles
L0  flow            evidence-aware Google Flow runtime operations and local authorized-browser helpers
```

Static dependency edges point only to the same or a lower layer. A higher-layer genre can pass a `genre_profile` as data to lower-layer craft through orchestration, but a craft skill never declares an upward dependency on a genre skill. This keeps the registry graph acyclic while preserving genre influence.

---

## 3. Current inventory by category

| Category | Layer | Skills |
|---|---:|---:|
'''
for cat in order:
    arch += f"| `{cat}` | {next(r['layer'] for r in rows if r['category']==cat)} | {counts[cat]} |\n"
arch += f"| **Total** |  | **{len(rows)}** |\n"
arch += dedent('''

---

## 4. Parent-director / specialist coordination

Examples of deliberate two-level ownership:

```text
craft/lighting-director
  ├─ key-light-designer
  ├─ fill-light-designer
  ├─ backlight-designer
  ├─ practical-light-designer
  ├─ natural-light-designer
  ├─ studio-lighting-designer
  ├─ contrast-designer
  ├─ exposure-designer
  ├─ time-of-day-lighting
  └─ lighting-continuity-supervisor

craft/lens-director
  ├─ focal-length-designer
  ├─ depth-of-field-designer
  ├─ focus-pull-designer
  └─ perspective-designer

craft/composition-director
  ├─ rule-of-thirds-director
  ├─ center-framing-director
  ├─ symmetry-director
  ├─ negative-space-director
  ├─ leading-lines-director
  ├─ foreground-layering-director
  ├─ depth-layering-director
  ├─ visual-balance-director
  ├─ headroom-eyeline-supervisor
  ├─ platform-safe-composition
  ├─ caption-safe-area-planner
  └─ vertical-video-director

continuity/continuity-supervisor
  ├─ character-continuity
  ├─ wardrobe-continuity
  ├─ prop-continuity
  ├─ location-continuity
  ├─ lighting-continuity
  ├─ camera-continuity
  ├─ screen-direction-continuity
  ├─ movement-continuity
  ├─ temporal-continuity
  ├─ color-continuity
  └─ environment-continuity
```

The parent owns **integration and arbitration**. A specialist owns **one narrow decision**. Neither is an alias for the other.

---

## 5. Repository layout

```text
Google-flow-skills/
├── GOOGLE_FLOW_API_REFERENCE.md
├── SECURITY_POLICY.md
├── SKILLS_ARCHITECTURE.md
├── SKILLS_TAXONOMY.md
├── SKILL_CONTRACT.md
├── VIDEO_PRODUCTION_PIPELINE.md
├── skills_plan/
│   ├── plan.json
│   └── ids.json
├── schemas/
├── model_registry/
├── skills/
│   ├── registry.json              # generated
│   ├── flow/
│   ├── foundation/
│   ├── story/
│   ├── craft/
│   ├── continuity/
│   ├── prompt/
│   ├── strategy/
│   ├── genre/
│   ├── qc/
│   ├── failure/
│   └── orchestration/
├── src/gfs/
├── tests/
└── tools/
```

Every skill package contains `SKILL.md`, `examples/example.md`, and `tests/cases.yaml`. Shared production schemas live once in `/schemas`; local schemas are created only for genuinely skill-specific structures.

---

## 6. Evidence-aware Flow runtime

Source of truth: `GOOGLE_FLOW_API_REFERENCE.md`.

Verified request-shape rules include:

- `startImage`, `endImage`, `videoInput`: `{"mediaId": "<uuid>"}`.
- `referenceImages`: `[{"mediaId": "<uuid>", "imageUsageType": "IMAGE_USAGE_TYPE_ASSET"}]`.
- image upload uses raw Base64 `imageBytes`, never the disproved `encodedImage`.
- image upsample uses only `UPSAMPLE_IMAGE_RESOLUTION_2K` or `UPSAMPLE_IMAGE_RESOLUTION_4K`.
- backend response `media[].name` is interpreted as the media identifier, while request-side video references use `mediaId`.

`src/gfs/evidence.py` gates capability confidence. `src/gfs/payloads.py` centralizes verified field shapes. `src/gfs/redact.py` prevents secret material from entering logs or fixtures. `src/gfs/errors.py` keeps reCAPTCHA/security rejection, schema failure, precondition failure, generation failure, network failure, and CDP/WebSocket failure separate.

Browser-generated reCAPTCHA security material is never fabricated, persisted, replayed, or bypassed. Runtime mutation code must execute only in the authorized user's legitimate browser/session context.

---

## 7. Generation control hierarchy

```text
project brief
→ project / brand / character / visual bibles
→ genre profile
→ story / scene / shot plan
→ parent craft directors
→ narrow specialist skills
→ continuity state validation
→ generation method + reference strategy
→ method-specific Veo prompt writer
→ prompt conflict/quality preflight
→ evidence-aware Flow runtime
→ polling + media ledger
→ specialist QC critics
→ aggregate scorer + acceptance gate
→ failure diagnosis
→ edit or bounded parameter-changing regeneration
→ accepted shot + next continuity state
→ project manifest
```

A genre does not hardcode camera/lens/light values. It emits tendencies and QA weights. Craft specialists still make the final shot-specific choice from the genre profile, visual bible, shot function, and continuity state.

---

## 8. State and media identity

Project-level production states:

```text
PLANNED → PROMPT_READY → QUEUED → ACTIVE → SUCCESSFUL → QC_PENDING
→ QC_PASSED / QC_FAILED → EDIT_REQUIRED / REGENERATE_REQUIRED → FINAL
```

Runtime media status is mapped separately so transport failure cannot masquerade as media failure. The asset/media managers preserve logical-asset identity, media lineage, and the backend `media.name` ↔ request `mediaId` mapping.

---

## 9. Extensibility

- New genre: add one `genre/*` specialist, register it, add tests. No Flow runtime change.
- New camera/light/product subdiscipline: add one craft specialist beneath the relevant director. No genre rewrite.
- New Flow model: add an evidence-labelled registry row. Genre skills do not change.
- New Flow capability: add one runtime skill only after source evidence establishes endpoint/shape/status.

The generated `skills/registry.json` and `skills_plan/plan.json` are the machine-readable inventory. Documentation must never carry a stale hard-coded count as authority.
''')
(ROOT/"SKILLS_ARCHITECTURE.md").write_text(arch,encoding="utf-8")

# Taxonomy rendered directly from plan so it cannot drift.
tax = f'''# Skills Taxonomy — Explicit Specialist Inventory\n\nThis file is generated from `skills_plan/plan.json`. Current inventory: **{len(rows)} skills**. Every independently useful video element, distinct genre/format, Flow operation, QC concern, and failure-analysis responsibility is routable as its own skill. Parent directors remain as integration authorities; they do not collapse their specialists.\n\n'''
for cat in order:
    cr=[r for r in rows if r["category"]==cat]
    tax += f"## L{cr[0]['layer']} — `{cat}/` ({len(cr)})\n\n"
    if cat=="flow":
        tax += "| Skill | Responsibility | Evidence |\n|---|---|---|\n"
        for r in cr:
            tax += f"| `{r['id']}` | {r['responsibility']} | `{r['evidence_level']}` |\n"
    else:
        tax += "| Skill | Responsibility |\n|---|---|\n"
        for r in cr:
            tax += f"| `{r['id']}` | {r['responsibility']} |\n"
    tax += "\n"
tax += dedent('''
## Naming and overlap rule

The only rejected shapes are true god objects such as `video-maker`, `everything-video`, or `make-professional-video`. Requested specialists are **not** rejected merely because a parent director also exists.

A parent/specialist pair is valid when responsibilities differ, for example:

- `craft/lighting-director`: integrate the complete lighting design and arbitrate interactions.
- `craft/key-light-designer`: decide the key source only.
- `craft/fill-light-designer`: decide fill/negative-fill behavior only.
- `craft/contrast-designer`: decide the resulting contrast structure only.

Likewise a broad genre and a product-category director may both exist when their grammar differs enough to route and fail independently: `genre/luxury-commercial`, `genre/perfume-ad-director`, `genre/watch-commercial-director`, `genre/jewelry-commercial-director`, etc.

## Evidence rule

Runtime facts come only from `GOOGLE_FLOW_API_REFERENCE.md` and `model_registry/`. Creative expertise may use professional filmmaking knowledge, but no creative inference may be promoted into an API claim.
''')
(ROOT/"SKILLS_TAXONOMY.md").write_text(tax,encoding="utf-8")

# Authoring brief: concise rewrite aligned with specialist architecture.
author=dedent(f'''
# Authoring Brief — Skill Packages

This brief is subordinate to `SKILL_CONTRACT.md`, `SKILLS_ARCHITECTURE.md`, `SECURITY_POLICY.md`, and `GOOGLE_FLOW_API_REFERENCE.md`.

## 1. Non-negotiables

1. Copy the machine contract from `skills_plan/plan.json`; current plan contains **{len(rows)}** skills.
2. One independently testable responsibility per skill. Parent directors integrate specialists; specialist skills remain separate.
3. Creative skills never hardcode Flow endpoints/model keys/payload fields/credit prices.
4. Flow skills never make aesthetic decisions and never upgrade evidence labels.
5. No secret, OAuth bearer, cookie, reCAPTCHA token, PII, or signed CDN secret in examples, fixtures, logs, or manifests.
6. Verified request shapes: media request references use `mediaId`; reference images also carry `IMAGE_USAGE_TYPE_ASSET`; image upload uses raw Base64 `imageBytes`; image upsample uses only the verified 2K/4K enums.
7. No seed-control API is verified. `strategy/seed-reference-consistency-planner` is reference-consistency only and must state seed control is unavailable.

## 2. Required package

```text
skills/<category>/<name>/
├── SKILL.md
├── examples/example.md
└── tests/cases.yaml
```

Create `schemas/`, `scripts/`, or `fixtures/` only when the skill genuinely needs them. Shared production structures live in `/schemas`.

## 3. Required SKILL.md sections

```text
Purpose
Responsibility
When To Use
When NOT To Use
Inputs
Outputs
Dependencies
Decision Framework
Workflow
Professional Standards
Google Flow Integration
Runtime Evidence
Constraints
Failure Modes
Recovery Strategy
Quality Checklist
Examples
```

Decision Framework must contain condition → choice → reason. Failure Modes must contain `signature | cause | owning fix`. Quality Checklist must have at least five actionable checks.

## 4. Depth targets

Depth is measured by decision quality, not padding:

- parent craft directors and genre skills: roughly 150–320 substantive lines when authored manually;
- narrow specialist skills: roughly 90–220 substantive lines;
- flow/strategy/orchestration: roughly 100–260 lines;
- examples: two worked cases minimum;
- tests: category-required happy path, bad input, conflict/partial/budget/continuity/threshold cases as applicable.

A 100-line specialist with real ratios, spatial logic, failure signatures, and trade-offs is superior to a 250-line file of adjectives.

## 5. Director / specialist rule

A parent skill must not duplicate specialist decisions line by line. The parent sets integration policy and resolves interactions. Example:

```text
lighting-director: integrates source motivation + hierarchy + ratios + practicals + exposure
key-light-designer: key source only
fill-light-designer: fill/negative fill only
backlight-designer: separation source only
contrast-designer: resulting contrast structure only
```

The same pattern applies to cinematography, lens, composition, production design, character, performance, motion, temporal design, product video, and continuity.

## 6. Creative / runtime boundary

Creative skill integration line: `This skill emits specification only.` It may name a downstream skill id, but not a wire endpoint.

Flow wire skills cite the exact documented endpoint and source section. Local runtime helpers such as model resolver, error classifier, browser session, or overlay handler name their **local surface** plus the source section that justifies their behavior; they are not required to invent a fake backend endpoint.

## 7. Tests and audit

Run:

```text
set PYTHONPATH=src&&python -m gfs.registry_build --root .
pytest
```

Registry build must match `skills_plan/plan.json`, resolve all dependencies, keep dependency edges non-upward and acyclic, validate evidence labels, and verify required skill sections.
''').lstrip()
(ROOT/"docs"/"AUTHORING_BRIEF.md").write_text(author,encoding="utf-8")

# Patch contract examples/rules that contradicted the layer model.
contract=(ROOT/"SKILL_CONTRACT.md").read_text(encoding="utf-8")
contract=contract.replace("optional_dependencies:\n  - genre/luxury-commercial", "optional_dependencies:\n  - foundation/visual-bible-builder")
contract=contract.replace("- **Google Flow Integration** for creative skills must state that the skill emits\n  specification only and name the downstream skill that executes. For `flow/*` it\n  must name the endpoint exactly as written in `GOOGLE_FLOW_API_REFERENCE.md`.", "- **Google Flow Integration** for creative skills must state that the skill emits specification only and name the downstream owner. Flow skills that map to a documented wire operation name the exact endpoint. Local runtime helpers (browser session, overlay handler, model resolver, error classifier) name their local surface and the source section that justifies it; they never invent an endpoint.")
(ROOT/"SKILL_CONTRACT.md").write_text(contract,encoding="utf-8")

# Append a specialist fan-out section to the production pipeline if absent.
pipe=(ROOT/"VIDEO_PRODUCTION_PIPELINE.md").read_text(encoding="utf-8")
marker="## Explicit specialist fan-out"
if marker not in pipe:
    pipe += dedent('''

---

## Explicit specialist fan-out

For each shot, a parent department can fan out to narrow specialists before integration:

```text
shot_spec skeleton
  → cinematography-director
      → shot-size / angle / height / distance specialists
      → lens-director → focal-length / DoF / focus / perspective specialists
      → camera-movement-director → speed / stability specialists
      → composition-director → framing / balance / safe-area specialists
  → lighting-director → key / fill / back / practical / natural / studio / contrast / exposure specialists
  → production-designer → set / location / architecture / prop / material / environment specialists
  → character/performance/motion/temporal/product specialists
  → continuity per-domain specialists → continuity-supervisor integration
  → generation method + references
  → method-specific prompt writer
  → preflight QC
  → Flow runtime
```

Orchestration may parallelize independent specialists, but parent integration occurs before prompt composition. Genre profiles arrive as data and influence tendencies/QA weights; they do not create upward static dependencies from craft to genre.
''')
    (ROOT/"VIDEO_PRODUCTION_PIPELINE.md").write_text(pipe,encoding="utf-8")

print(f"Rendered architecture/taxonomy/authoring docs for {len(rows)} skills")
