# PIPO FLOW / FLOWGRAPH — PROJECT CONTEXT MASTER

> Canonical handoff context for future ChatGPT/AI sessions.
> Snapshot generated: 2026-09-06 (Asia/Ho_Chi_Minh)
> Project root: `E:\Flow_veo`
> Purpose: preserve the consolidated context, decisions, runtime status, evidence rules, UI/UX requirements, architecture, and next-step direction accumulated across project sessions.

---

## 0. HOW TO USE THIS FILE

This file is the primary context/handoff document for the Pipo Flow / FlowGraph project.

When a new AI/session starts:
1. Read this file first.
2. Read `FLOWGRAPH_REAL_RUNTIME_TASKLIST.md` for detailed checklist/evidence state.
3. Read `FLOWGRAPH_V1_RELEASE_REPORT.md` and `docs/FLOWGRAPH_RUNTIME_CAPABILITY_MATRIX.md` for runtime claims.
4. Inspect current git status/log before changing code.
5. Never promote a capability to `RUNTIME_VERIFIED` without real sanitized runtime evidence.

This document is a consolidated summary of all project-session context currently available to ChatGPT plus a fresh verification against the local repository. It is not a verbatim export of every chat transcript.

---

# 1. PROJECT IDENTITY

## 1.1 Main project

Working project: **Pipo Flow / FlowGraph Extension**

Local repository:

```text
E:\Flow_veo
```

Primary implementation:

```text
E:\Flow_veo\flowgraph-extension
```

Core concept:

> A ComfyUI-like node-based visual runtime for Google Flow, implemented as a Chrome Extension, allowing users to construct real image/video generation pipelines with drag-and-drop nodes while using the real Google Flow browser session as the execution surface.

FlowGraph is intended to become the professional video-generation / filmmaking module inside a larger **Multi-Agents System for Content Creator**.

---

# 2. ORIGIN / PRODUCT VISION

The broader product idea began as:

> **Multi agents system for content creator** — an AI-assisted system for creating content, generating video/images/scripts, publishing content, and managing multiple social platforms.

High-level modules envisioned:
- Script writing via Gemini / ChatGPT.
- Image generation.
- Video generation.
- Publishing to Facebook, YouTube, etc.
- Multi-platform content management.
- AI agents assigned to specialized automation responsibilities.

Important strategic decision:

> **Video generation should use Google Flow** where possible to reduce implementation/token cost and shorten development time.

FlowGraph is therefore one module of the larger content-creator architecture, but current engineering priority is to make FlowGraph itself real, reliable, and production-oriented.

---

# 3. CORE PRODUCT GOAL FOR FLOWGRAPH

FlowGraph should not be a UI demo.

The target is a real node-based production runtime capable of:
- creating/selecting a Google Flow project;
- building a graph visually;
- validating the graph;
- planning execution order;
- executing nodes against the real Google Flow session;
- propagating real media references between nodes;
- previewing real image/video output;
- downloading final artifacts;
- saving/restoring workflows;
- handling failures, timeout, retry, cancel, cache, credits, and concurrency;
- supporting a widening set of Google Flow capabilities without falsely claiming unsupported runtime behavior.

Long-term product direction:

> Enable professional short-video or film workflows of arbitrary practical duration by composing many scenes/shots through graphs, rather than being constrained to a single generation call.

---

# 4. NON-NEGOTIABLE ENGINEERING / EVIDENCE RULES

These rules were repeatedly established and must remain authoritative:

1. **No fake success.**
2. UI existence does not mean capability completion.
3. `DONE` requires code + suitable tests/build.
4. `RUNTIME_VERIFIED` requires real runtime evidence.
5. Do not bypass CAPTCHA/reCAPTCHA or Google security mechanisms.
6. Do not export/dump/copy browser tokens, cookies, OAuth credentials, or reCAPTCHA payloads.
7. Evidence must be sanitized.
8. If Google/security prevents execution, fail closed and classify honestly (`RUNTIME_PARTIAL`, provider error, `CAPTCHA_REQUIRED`, etc.).
9. Real media claims require real artifacts/media IDs where applicable.
10. Security boundary failures are evidence too, when they prove fail-closed behavior.
11. A critical-path bug should be fixed before expanding downstream capability.
12. Prefer a smaller real pipeline over a larger simulated feature set.
13. Each milestone should include regression build/test.
14. Capability statuses must distinguish among at least:
   - `RUNTIME_VERIFIED`
   - `CONTRACT_VERIFIED`
   - `RUNTIME_PARTIAL`
   - `UI_ONLY`
   - `COMING_SOON`

---

# 5. GOOGLE FLOW API RESEARCH PHASE

Major research/work occurred around 2026-08-27 onward.

Primary documentation:

```text
GOOGLE_FLOW_API_REFERENCE.md
FLOW_API_MAP.md
model_registry/
evidence/
evidence_manifest.json
sdk/
tests/
```

Key accomplishments from API/runtime research:
- Reverse-engineered/normalized Google Flow-related request and model shapes.
- Built a model registry / normalized registry.
- Added evidence-backed runtime status labels.
- Built SDK/client utilities with dynamic auth/model resolution.
- Added guardrail tests and evidence verification tooling.
- Produced a Google Flow API Reference 2.0.0-style documentation set.

Historical verified/researched flows included:
- image upload;
- Text-to-Video;
- Image-to-Video;
- Start/End Frame interpolation;
- Reference Images Video;
- Extend/Edit Video;
- Image/Video upscale;
- cancel and other provider operations to varying verification levels.

Important historical constraint:
- Direct provider calls could hit `403 PUBLIC_ERROR_UNUSUAL_ACTIVITY` / reCAPTCHA-related failures.
- This drove the architecture toward **using the real Google Flow UI/session via browser automation**, rather than pretending direct provider calls were reliable.

---

# 6. FLOWGRAPH EXTENSION ARCHITECTURE

Current architectural direction:

```text
FlowGraph Studio UI
    ↓
chrome.runtime.sendMessage
    ↓
Extension Service Worker / Bridge
    ↓
Google Flow tab
    ↓
Real UI interaction / supported bridge operations
    ↓
Real Google Flow generation
    ↓
MediaRef propagation
    ↓
Preview / Download / workflow result
```

Key areas:

```text
flowgraph-extension/src/runtime/
flowgraph-extension/src/runtime/executors/
flowgraph-extension/src/adapters/google-flow/
flowgraph-extension/src/background/
flowgraph-extension/src/ui/studio/
flowgraph-extension/tests/unit/
flowgraph-extension/evidence/
```

The browser path exists specifically to preserve the real Google Flow session/security context.

Historically, direct service-worker provider fetch for generation failed under anti-abuse/reCAPTCHA conditions. The production direction was changed to perform generation through the real page, including text insertion and real Generate button interaction, without synthesizing/faking security tokens.

---

# 7. PROJECT GATE — IMPORTANT UX/RUNTIME REQUIREMENT

User decision:

> Before doing any work, the user must create a project or choose an existing project. If no project is active, the whole canvas must be locked.

Required actions:
- **Tạo dự án** (Create Project)
- **Chọn dự án** (Select Project)

Expected states:
- Account connected.
- Google Flow tab ready.
- Project list real.
- Create project real.
- Select project real.
- Active project synchronized.
- Canvas fail-closed when project is missing/home state.
- Canvas unlocks when a valid project becomes active.

The project gate has previously been runtime-verified with live lock/unlock behavior, including reactivity after navigation.

Do not regress the fail-closed project gate.

---

# 8. RUNTIME CORE

Runtime concepts implemented/established:
- graph validation;
- graph planning/topological execution;
- execution context;
- per-node runtime states;
- typed runtime values;
- media propagation;
- polling;
- normalized errors;
- timeout budgets;
- retry;
- cancel;
- cache;
- bounded concurrency;
- save/reload/restore;
- runtime results persisted as sanitized metadata, not signed URLs/secrets.

Representative normalized errors include:
- `AUTH_EXPIRED`
- `PROJECT_REQUIRED`
- `INVALID_INPUT`
- `PROVIDER_ERROR`
- `MEDIA_FAILED`
- `CAPTCHA_REQUIRED`
- `TIMEOUT`
- `CANCELLED`
- `UNSUPPORTED_NODE`

---

# 9. REAL PIPELINE V1

The foundational real FlowGraph chain is:

```text
Prompt → Text-to-Image → Image-to-Video → Download
```

This chain has been run successfully against the real Google Flow session multiple times with real media IDs and MP4 artifacts.

Verified behaviors historically include:
- real prompt insertion;
- real generation trigger;
- real image media ID;
- exact upstream image media selected for I2V;
- real video media ID;
- real image/video node preview;
- real download artifact;
- no fake media fallback;
- save/reload/restore;
- multiple consecutive full-chain passes;
- fresh cache-bypassed runs.

Additional real T2V runs were also captured with distinct media IDs and valid MP4 artifacts.

Evidence is primarily under:

```text
flowgraph-extension/evidence/flowgraph_v1/
```

and associated root evidence/report files.

---

# 10. CAPABILITY DEVELOPMENT — FG-1201 THROUGH FG-1206

The latest project-session handoff reported the following completed state:

## FG-1201 — Text-to-Video

Status:

```text
RUNTIME_VERIFIED
```

Live runs completed successfully.

## FG-1202 — Start/End Interpolation

Status:

```text
RUNTIME_VERIFIED
```

Live interpolation runs completed successfully.

User-facing requirement:
- Start Frame and End Frame must be visually distinguishable.
- Do not rely on duplicated labels; use concise but clear IO/notes.

## FG-1203 — Reference Images Video

Status:

```text
RUNTIME_VERIFIED
```

Live runs completed successfully.

## FG-1204 — Extend/Edit Video

Status:

```text
RUNTIME_VERIFIED
```

Live runs completed successfully.

## FG-1205 — Upscale Runtime

Historical session summary described this as `RUNTIME_PARTIAL`, but the **current repository git history on 2026-09-06 is newer** and includes:

```text
ebbcffe feat(runtime): complete 4 live upscale runs (2K/4K/1080p/4K) and finalize FG-1205 evidence
86cca5a feat(runtime): verify Live Upscale runs and record fail-closed security evidence (FG-1205)
dacba3c chore(capabilities): align upscale summary wording with live verification evidence
```

Therefore future sessions must consult the current capability matrix/tasklist rather than relying on the older partial label.

Important hardening already done:
- project isolation;
- correct IMAGE media type for image upscale;
- dedicated upscale bridge routing;
- service-worker contract tests;
- boundary regression tests;
- fail-closed security behavior.

## FG-1206 — Utility Foundation

Utility nodes:
- `MediaInput`
- `ImageInput`
- `VideoInput`
- `Preview`
- `Download` integration/foundation as applicable

Hardening completed across Task 5A stages:
- explicit MediaRef provenance;
- static typed ports;
- source mediaType validation;
- mandatory mediaType;
- materialized utility configs in palette;
- transient `previewUrl` resolution;
- fail closed with `PREVIEW_FAILED` if preview resolution fails.

Current git head confirms:

```text
2390846 feat(runtime): verify Live Utility Workflows and promote FG-1206 to RUNTIME_VERIFIED
```

Thus FG-1206 is currently treated as:

```text
RUNTIME_VERIFIED
```

subject to the evidence files/current matrix remaining intact.

---

# 11. CURRENT VERIFIED CODEBASE SNAPSHOT — 2026-09-06

A fresh test was run while generating this context file:

```text
npm test -- --run
```

Result:

```text
25 / 25 test files PASSED
184 / 184 tests PASSED
```

This supersedes earlier chat handoff numbers such as 49/49, 104/104, and 178/178.

A fresh production build was also run:

```text
npm run build
```

Result:

```text
PASS
build:bridge PASS
tsc -b PASS
Vite production build PASS
1790 modules transformed
```

Current produced major bundles at snapshot time include approximately:

```text
studio-CfiBr0_8.js   464.69 kB (gzip 121.14 kB)
theme-Bkh5UBwQ.js    149.14 kB (gzip 47.57 kB)
sidepanel-B2m-U2iN.js 16.35 kB (gzip 3.96 kB)
```

Note: repository working tree is **not clean** at the snapshot time. There are modified/untracked runtime/UI/debug/research files, including active film-workspace work. A new session must run `git status` before committing/reverting anything.

---

# 12. LATEST REPOSITORY HISTORY SNAPSHOT

Recent commits observed 2026-09-06:

```text
2390846 feat(runtime): verify Live Utility Workflows and promote FG-1206 to RUNTIME_VERIFIED
59147b1 fix(runtime): strictly fail-closed with PREVIEW_FAILED on preview resolution error
2f03d01 feat(runtime): wire transient previewUrl resolution in PreviewExecutor (Task 5A.4)
5dd4383 feat(runtime): enforce mandatory mediaType & materialize utility configs in palette (Task 5A.3)
852716d fix(runtime): validate source mediaType for Image and Video Input executors (Task 5A.2)
617bd64 feat(runtime): harden utility MediaRef provenance & static ports (Task 5A.1)
4489419 feat(runtime): implement Utility nodes (MediaInput, ImageInput, VideoInput, Preview) (FG-1206)
dacba3c chore(capabilities): align upscale summary wording with live verification evidence
ebbcffe feat(runtime): complete 4 live upscale runs (2K/4K/1080p/4K) and finalize FG-1205 evidence
86cca5a feat(runtime): verify Live Upscale runs and record fail-closed security evidence (FG-1205)
982188e test(sw): add service worker upscale contract tests (Task 4A.4)
b5c2ec5 test(upscale): add boundary regression tests for project isolation & media type (Task 4A.3)
12dc8eb fix(sw): enforce project isolation and correct IMAGE media type for imageUpscale (Task 4A.2)
5b32e45 fix(sw): route upscale kinds directly to dedicated generateApi path (Task 4A.1)
237ecfc fix(bridge): harden upscale bridge routes and keep RUNTIME_PARTIAL status
```

This sequence shows that newer verification/hardening supersedes older partial-state commits.

---

# 13. UI / UX REQUIREMENTS FROM USER FEEDBACK

These are explicit user preferences and should guide all future FlowGraph UI work.

## 13.1 General visual direction

User wants:
- compact;
- clean;
- readable;
- less visual noise;
- professional editor feel;
- optimized canvas space;
- node information immediately understandable.

## 13.2 Typography

Explicit feedback:

> “Chữ nhỏ quá tôi không thấy rõ.”

Therefore:
- do not shrink node typography excessively for compactness;
- keep important IO/status/model text readable at normal zoom;
- compact layout should come from removing redundancy, not tiny fonts.

## 13.3 Remove duplicated labels

User observed nodes containing redundant labels such as duplicate Prompt/Video/Start text.

Decision:
- remove repeated content;
- do not show the same semantic label in header, body, port and description unnecessarily.

Preferred pattern:

```text
IN: ...
OUT: ...
```

with only essential extra notes when ambiguity exists.

## 13.4 Node borders / description

User asked to reduce the descriptive block footprint:
- avoid unnecessary borders;
- concise descriptions;
- important information only;
- no large repeated explanatory panels inside every node.

## 13.5 Start/End Frame special case

Interpolation is an exception where a bit more clarity is necessary.

Need clearly identify:
- Start Frame
- End Frame

while still avoiding oversized text blocks.

## 13.6 Preview sizing

User explicitly worried that image/video previews would become too small.

Design implication:
- node should stay compact when idle;
- actual media preview needs a usable size or expand/view mechanism;
- avoid embedding an unreadably tiny thumbnail just to claim preview support;
- preserve cinematic inspection usability.

## 13.7 IO capability display

User wants each node to display its usable input and output clearly.

Do not over-describe.

Example concept:

```text
IN  Image + Prompt
OUT Video
```

or similarly concise typed IO.

## 13.8 Model visibility

User wants supported models visible per node, including the Google Flow image/video models available to that capability.

Model catalog must come from real/normalized capability data where possible, not invented names.

## 13.9 UI stability

Historical feedback:

> “bật UI”
> “ui lại tắt rồi”

Therefore extension UI lifecycle/stability matters. Avoid changes that make Studio/sidepanel appear/disappear unexpectedly.

---

# 14. PROMPT BOOSTER / SMART PROMPT

Requested feature direction:
- Prompt Booster using Gemini.
- Presets/styles such as:
  - cinematic;
  - realistic;
  - art;
  - custom.
- One-click prompt enhancement.
- Prompt writing should integrate naturally with node workflow.

A live Prompt Writer/sync workflow has previously had evidence captured, including Slate editor handling and mode switching.

---

# 15. FILMMAKING / MULTI-SCENE DIRECTION

The user asked whether the system is sufficient for professional filmmaking and requested moving toward a system that can create short videos or films with arbitrary duration professionally.

The architectural answer is scene/shot composition rather than one long provider call.

Future film layer should conceptually support:
- Film Project
- Scene
- Shot
- sequence/timeline ordering
- per-shot prompt/media/model settings
- continuity references
- character/location/style consistency
- generated media tracking
- shot revision/history
- scene assembly
- final export pipeline

Repository evidence of current work in this direction includes untracked/modified files at snapshot time:

```text
flowgraph-extension/src/ui/studio/filmModel.ts
flowgraph-extension/src/ui/studio/fineDiningWorkflow.ts
flowgraph-extension/src/ui/studio/useFilmProject.ts
flowgraph-extension/src/ui/studio/workflowPersistence.ts
flowgraph-extension/tests/unit/FilmModel.test.ts
flowgraph-extension/tests/unit/WorkflowPersistence.test.ts
fine_dining_11_scenes_workflow.json
fine_dining_11_scenes_omni_results.json
generate_11_scenes_workflow.ts
render_11_scenes_omni.py
render_all_11_omni_batch.py
retry_failed_scenes.py
```

This indicates active development toward multi-scene filmmaking/workflow persistence beyond the original V1 runtime.

Do not delete/revert these files merely because they are untracked without first inspecting their purpose.

---

# 16. SAMPLE MULTI-SCENE WORK

A multi-scene “fine dining” workflow has been used as a practical filmmaking/runtime exercise.

Relevant files:

```text
fine_dining_11_scenes_workflow.json
fine_dining_11_scenes_omni_results.json
generate_11_scenes_workflow.ts
render_11_scenes_omni.py
render_all_11_omni_batch.py
retry_failed_scenes.py
```

Future sessions working on professional film orchestration should inspect these assets instead of starting from scratch.

---

# 17. MCP / LOCAL COMPUTER INTEGRATION

The project uses a custom MCP filesystem/server path for AI access to the Windows machine/repository.

Current environment concept:

```text
ChatGPT Web
  → HTTPS public connector
  → cloudflared/VPS/reverse tunnel
  → MCP server on Windows
  → E:\Flow_veo filesystem / commands / Chrome CDP
```

Historical public MCP setup used port 3080 and an SSH reverse tunnel.

Important user request from another related session:
- create a watcher/reconnect mechanism so MCP does not keep dropping;
- improve connector stability/reconnection.

Project contains:

```text
mcp_server/
chatgpt-web-bridge/
check_bridge.py
```

and various scripts around the ChatGPT/browser bridge.

Operational rule:
- treat MCP stability as infrastructure required for productive autonomous iteration.

---

# 18. CHROME / CDP DEVELOPMENT ENVIRONMENT

Known dedicated Chrome automation profile:

```text
E:\Flow_veo\chrome-profile
```

Remote debugging historically:

```text
port 9222
```

Other test profiles exist:

```text
chrome-profile-chatgpt-live
chrome-profile-test
chrome-profile2
```

The dedicated FlowGraph profile is preferred for runtime tests instead of the user's ordinary browser profile.

The `_ctl/` directory contains a large collection of runtime probes, CDP helpers, screenshots, network experiments, and live test utilities. Many are diagnostic artifacts; inspect before cleanup.

---

# 19. SECURITY / PRIVACY BOUNDARIES

Never write the following into evidence, docs, chat handoffs, UI persistence, or logs:
- bearer tokens;
- OAuth access tokens;
- cookies;
- reCAPTCHA tokens/payloads;
- raw browser credentials;
- signed preview URLs when persistence is unnecessary.

Use stable sanitized metadata such as:
- project ID;
- media ID;
- MIME/media type;
- filename;
- status;
- timestamps;
- sanitized request/response shape.

Preview URLs should be transiently resolved when needed rather than persisted as secrets/capabilities.

---

# 20. IMPORTANT DOCUMENTS / SOURCES OF TRUTH

## Runtime / planning

```text
FLOWGRAPH_REAL_RUNTIME_TASKLIST.md
FLOWGRAPH_V1_RELEASE_REPORT.md
FLOWGRAPH_REALTIME_SYNC_REPORT.md
AUDIT_REPORT_20260902.md
```

## API / models

```text
GOOGLE_FLOW_API_REFERENCE.md
FLOW_API_MAP.md
model_registry/
```

## Evidence

```text
evidence/
flowgraph-extension/evidence/
evidence_manifest.json
```

## Extension code

```text
flowgraph-extension/
```

## Tools / live probes

```text
_ctl/
```

## Bridge / MCP

```text
mcp_server/
chatgpt-web-bridge/
```

---

# 21. RELEASE / CAPABILITY STATUS PRINCIPLE

Do not assume an old report is current merely because it says “release report”.

The repository evolved rapidly after the original V1 report.

For example:
- Early V1 report: 49/49 tests.
- Later runtime tasklist: 104/104 tests.
- Project session handoff: 178/178 tests.
- Fresh 2026-09-06 verification: **184/184 tests, 25/25 files**.

Likewise, a capability may progress:

```text
UI_ONLY
→ CONTRACT_VERIFIED
→ RUNTIME_PARTIAL
→ RUNTIME_VERIFIED
```

Always reconcile:
1. git history;
2. current tasklist;
3. current capability matrix;
4. evidence files;
5. fresh build/tests;
6. live runtime evidence where claim requires it.

---

# 22. KNOWN HISTORICAL MILESTONES

## M1 — Project Ready
- real account state;
- real Flow state;
- real project list/create/select;
- real canvas gate.

## M2 — Runtime Core Ready
- validation;
- planning;
- execution context;
- node states;
- data propagation.

## M3 — First Real Generation

```text
Prompt → T2I
```

## M4 — First Real Chain

```text
Prompt → T2I → I2V
```

## M5 — Real Runtime V1

```text
Prompt → T2I → I2V → Download
```

## M6 — Production Runtime
- retry;
- resume;
- cancel;
- cache;
- credits;
- concurrency;
- run history.

## M7 — Node Coverage
- T2V;
- interpolation;
- reference;
- extend;
- upscale;
- utility nodes.

## M8 — Release

FlowGraph behaves as a real node-based Google Flow runtime, not a simulated editor.

---

# 23. CURRENT PRODUCT PRIORITY

The user previously made the priority explicit:

> Focus on developing FlowGraph; other unrelated areas may be shown as “coming soon”.

Near-term engineering should prioritize:
1. reliability of existing verified nodes;
2. professional film/multi-scene workflow layer;
3. clean compact node UI;
4. project/workflow persistence;
5. real media previews;
6. scene/shot orchestration;
7. runtime evidence for every promoted capability;
8. MCP/browser bridge stability.

Avoid distracting expansion into unrelated product modules until FlowGraph is stable enough to serve as the real video-generation engine.

---

# 24. DO NOT REGRESS THESE DECISIONS

- Do not remove project gating.
- Do not revert from real Google Flow execution to simulation.
- Do not use “last/random image” fallback for an exact upstream MediaRef requirement.
- Do not fabricate preview media.
- Do not save secret tokens/cookies.
- Do not bypass CAPTCHA/reCAPTCHA.
- Do not label a capability runtime-verified based only on payload/unit tests.
- Do not make node text tiny simply to save space.
- Do not reintroduce redundant Prompt/Video/Start labels.
- Do not make Start Frame / End Frame ambiguous.
- Do not assume untracked film-workspace files are disposable.

---

# 25. RECOMMENDED NEW-SESSION BOOT SEQUENCE

When continuing work in a fresh AI session:

```text
1. Read PROJECT_CONTEXT_MASTER.md
2. git status
3. git log -n 15
4. Read FLOWGRAPH_REAL_RUNTIME_TASKLIST.md
5. Read current runtime capability matrix
6. Inspect working-tree changes relevant to requested task
7. Run targeted tests
8. Implement smallest safe change
9. Run full test suite/build when milestone changes
10. Capture sanitized runtime evidence before status promotion
11. Update tasklist/context when major state changes
```

---

# 26. CURRENT SNAPSHOT SUMMARY

As of this context generation on **2026-09-06**:

```text
Project root: E:\Flow_veo
Primary app: flowgraph-extension
Tests: 184 / 184 PASS
Test files: 25 / 25 PASS
Production build: PASS
TypeScript build: PASS
Google Flow execution architecture: browser/extension bridge, real session
Project Gate: established and historically runtime verified
Core V1 pipeline: real runtime verified
T2V: runtime verified
Interpolation: runtime verified
Reference Video: runtime verified
Extend/Edit Video: runtime verified
Upscale: newer live verification/hardening commits exist; use current matrix/evidence for exact label
Utility Foundation FG-1206: RUNTIME_VERIFIED per latest commit
Film/multi-scene layer: active development in working tree
Working tree: dirty; inspect before any cleanup/reset/commit
```

---

# 27. USER INTENT / COLLABORATION STYLE

The user wants the AI to act as a lead architect/engineering collaborator, not merely provide suggestions.

Expected behavior:
- inspect the real codebase;
- make concrete changes when asked;
- run tests/builds;
- validate runtime honestly;
- keep documentation/tasklists synchronized;
- preserve previous project decisions across sessions;
- make progress without repeatedly asking questions already answered in prior context.

The user prefers concise visible notes/UI, but expects deep engineering rigor behind them.

---

# 28. FINAL HANDOFF NOTE

This file should be updated whenever any of the following materially changes:
- capability status;
- architecture;
- test/build baseline;
- major UI decision;
- film project model;
- project persistence design;
- Google Flow provider behavior;
- security boundary;
- MCP/browser bridge architecture;
- critical-path milestone.

Recommended rule:

> **Treat `PROJECT_CONTEXT_MASTER.md` as the durable cross-session memory of the FlowGraph project, while the tasklist/evidence files remain the detailed engineering proof.**
