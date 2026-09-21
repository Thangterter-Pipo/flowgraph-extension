# FLOWGRAPH MASTER CONTEXT / PROJECT HANDOFF

> **Purpose:** Single-file knowledge handoff for another ChatGPT/AI account or engineer to understand the FlowGraph project and continue development without needing the original conversation history.
>
> **Snapshot date:** 2026-09-09 (Asia/Ho_Chi_Minh)
>
> **Primary repository:** `E:\Flow_veo\flowgraph-extension`
>
> **GitHub:** `https://github.com/Thangterter-Pipo/flowgraph-extension`
>
> **Important:** This file is the preferred project-context entry point. Older README/docs may contain historically correct but now outdated test counts or capability states. Always verify live code/tests before overriding this snapshot.

---

## 0. INSTRUCTIONS FOR THE NEXT AI / ENGINEER

If you are a new AI/account joining this project, do the following before changing code:

1. Read this entire file once.
2. Inspect the repository at `E:\Flow_veo\flowgraph-extension`.
3. Run `git status`, inspect recent `git log`, then run tests/build/typecheck.
4. Treat real runtime evidence as stronger than documentation claims.
5. Never mark a capability `RUNTIME_VERIFIED` without real runtime evidence and a real artifact/result.
6. Never bypass CAPTCHA, export cookies/tokens, automate passwords, or fake success.
7. Keep Google Flow as the actual generation provider; FlowGraph is the visual workflow/orchestration layer.
8. Do not expand project scope beyond the agreed FlowGraph Extension scope unless the owner explicitly requests it.
9. Preserve project isolation: the user must create/select a Google Flow project before the canvas/runtime is enabled.
10. Preserve fail-closed behavior. If project/media provenance is uncertain, stop instead of guessing.
11. The owner prefers minimal, practical UI: thin/no borders, larger readable text, media is visually dominant, little decorative color.
12. For major work, operate as a senior engineer: inspect code, implement, test, build, verify live if applicable, and report evidence.

Current accepted automated baseline at snapshot time:

```text
Vitest:      36 / 36 test files PASS
Tests:       730 / 730 PASS
Command:     cmd /c npm test -- --run
Observed:    2026-09-09
```

Do not trust older badges that still say 104/104, 187/187, etc. Those were valid earlier milestones.

---

# 1. PROJECT IDENTITY

## 1.1 Name

**FlowGraph Extension**

Working/product concept: a ComfyUI-like, node-based visual workflow studio for Google Flow, implemented as a Chrome Manifest V3 extension.

## 1.2 Core objective

Turn Google Flow media generation into a reusable visual graph workflow in which users connect typed nodes and execute real image/video operations while FlowGraph handles:

- workflow construction;
- dependency planning;
- exact media passing;
- project binding/isolation;
- browser/UI integration with Google Flow;
- runtime execution;
- retries/cancellation/polling;
- persistence;
- preview/download;
- realtime synchronization where practical.

FlowGraph does **not** replace Google Flow, train its own media generation model, or pretend to generate media itself. Google Flow remains the generation platform/provider.

## 1.3 Agreed product scope

The capstone/product scope is **100% FlowGraph Extension**.

Do not re-expand into the previously discussed multi-agent content creator platform unless explicitly requested. That older idea is separate.

The owner explicitly said:

- focus development on FlowGraph;
- other unrelated modules should be “Coming Soon” or excluded;
- project scale should follow the documents already created, not speculative upgrades;
- video creation is based on Google Flow;
- do not add unnecessary AI/model providers.

---

# 2. USERS AND PRODUCT MODEL

Primary user: content creator / AI video creator who already uses Google Flow and wants a faster, repeatable, visual production workflow.

Typical workflow:

```text
Prompt
  -> Text to Image
  -> Image to Video
  -> Extend / Interpolation / Reference / Upscale as needed
  -> Preview
  -> Download / assemble outputs
```

Advanced graph workflows may fan out/fan in and support multiple media inputs.

The owner wants FlowGraph to be capable of professional short-video and film workflows, but development should remain grounded in supported runtime capabilities rather than marketing claims.

---

# 3. PRIMARY DESIGN PRINCIPLES

## 3.1 Real runtime over mock UI

A visible node is not considered implemented merely because it renders in the palette/canvas.

Capability labels historically used:

- `UI_ONLY`: UI exists but no dependable executor/live provider path.
- `RUNTIME_PARTIAL`: important implementation/contract exists but live verification is incomplete or provider constraints remain.
- `RUNTIME_VERIFIED`: proven in real Google Flow runtime with evidence/artifact.

Do not silently promote capability status.

## 3.2 Fail closed

If active project mismatches media provenance, required inputs are absent, provider state is not ready, or execution cannot be proven, fail with a normalized error instead of guessing or fabricating output.

## 3.3 Exact upstream media binding

Downstream media nodes must receive the exact upstream `MediaRef`/media identity, not a synthetic stand-in.

Recent fixes specifically removed synthetic `/asb/<uuid>` URL generation. Authentic Google Flow `/asb/AB-n...` media URLs/tokens are resolved from the real DOM/provider state when required.

## 3.4 User gesture / Google Flow UI boundary

Direct service-worker generation requests triggered reCAPTCHA / unusual-activity blocks because they lacked normal user-gesture/browser context.

Established strategy:

- Preferred path where needed: drive the real Google Flow page/UI.
- CDP/debugger route: insert prompt/value and physically click the real Generate/control.
- Content-script/main-world fallback where appropriate.
- Do not bypass anti-abuse systems.

## 3.5 Project Gate

The canvas and execution are locked until FlowGraph confirms:

```text
Google account connected
+ Google Flow ready
+ active Flow project selected/created
= canvas/runtime enabled
```

Owner requirement: **“Trước khi làm cần tạo dự án trước hoặc chọn dự án; nếu chưa có dự án thì không làm được.”**

If project disappears or changes unexpectedly, lock/fail closed rather than running against stale state.

---

# 4. HIGH-LEVEL ARCHITECTURE

```text
User
  |
  v
FlowGraph Studio UI (React + TypeScript + @xyflow/react)
  |            |                 |
  |            |                 +--> Local persistence / run history
  |            +--> Realtime Flow Sync Controller
  v
Workflow Runtime
  |- GraphValidator
  |- GraphPlanner
  |- Execution session
  |- Bounded concurrency
  |- Node executors
  |- Polling
  |- Retry
  |- Cache
  |- Cancellation
  |- Runtime events
  v
GoogleFlowAdapter / Browser Bridge
  |- MV3 background service worker
  |- content script
  |- MAIN-world DOM interactions where required
  |- chrome.debugger/CDP where required
  |- downloads API
  v
Authorized Google Flow project tab
  v
Google Flow provider / real generated media
```

Key code areas currently visible in repository:

```text
src/adapters/
src/auth/
src/background/
src/content/
src/engine/
src/nodes/
src/runtime/
src/services/
src/shared/
src/storage/
src/types/
src/ui/
tests/unit/
tests/integration/
tests/e2e/
evidence/
docs/
tools/
scripts/
```

---

# 5. TECHNOLOGY STACK

Current stack historically and in repo:

- Chrome Extension Manifest V3
- React 18
- TypeScript
- `@xyflow/react` / React Flow
- Vite
- Vitest
- Zustand (present in dependencies)
- Chrome APIs: scripting/background/service worker, side panel, downloads, identity/debugger as applicable
- Google Flow as external AI media provider
- Browser-local persistence for core extension state
- No mandatory standalone DBMS for core V1

Reference UI/node-graph project explicitly requested by owner:

`https://github.com/xyflow/xyflow`

---

# 6. RUNTIME CORE

## 6.1 Graph validation

Expected responsibilities:

- validate required node inputs;
- validate typed ports;
- reject unsupported node kinds before provider call;
- detect cycles;
- reject invalid graph shapes;
- enforce project/media provenance when relevant.

## 6.2 Graph planner

- topological/dependency ordering;
- support branching;
- preserve ordered multi-input arrays;
- prepare executable dependency graph.

## 6.3 Runtime values

Typed values include concepts such as:

- prompt/text;
- image media refs;
- video media refs;
- generic media;
- file/download values;
- booleans/utility values where required.

Multi-input support was deliberately introduced so `NodeExecutionContext.inputs` can hold `RuntimeValue[]` and preserve input order such as `[A, B, C]`.

Helper concept: `asMediaList(input)` for ordered media collections.

## 6.4 Concurrency

Provider concurrency was experimentally constrained.

Established constant/behavior:

```text
VERIFIED_GOOGLE_FLOW_CONCURRENCY_LIMIT = 2
```

`resolveEffectiveConcurrency()` caps requested runtime concurrency above 2 down to 2.

Live boundary testing found contention around this limit (one branch can hit UI-not-ready behavior), reinforcing the cap.

## 6.5 Cancellation

Runtime includes cancellation/abort behavior.

Latest accepted UI fix: **Cancel Active Task** button is wired so the user interaction directly calls runtime cancellation and emits a cancellation event.

Conceptually:

```js
window.studioRuntime.cancel()
window.dispatchEvent(new CustomEvent('flowgraph:cancel-run'))
```

Exact implementation should always be rechecked in code before editing.

## 6.6 Polling

Asynchronous provider generation is tracked by polling where UI-completed paths are not sufficient.

Executors commonly support:

- completed-via-UI fast path;
- polling fallback;
- normalized timeout/errors.

## 6.7 Retry / downstream resume

The runtime historically supports retry semantics and downstream continuation where possible. Preserve idempotency/project binding; avoid duplicating provider work when cached/successful results exist.

## 6.8 Cache

Project-scoped cache exists. Never reuse media across incompatible Flow projects.

---

# 7. IMPORTANT EXECUTORS / CAPABILITIES

The exact codebase is the final source of truth. This section captures the accepted project evolution.

## 7.1 Prompt

Local typed prompt source.

## 7.2 Text-to-Image (T2I)

Real Google Flow image generation path.

QA combinatorial matrix was explicitly executed:

- 3 image models;
- 5 aspect ratios;
- 4 batch multipliers;
- 60 combinations.

Models used in the agreed UI/QA set:

- Nano Banana Pro
- Nano Banana 2
- Nano Banana 2 Lite

Aspect ratios:

- 16:9
- 4:3
- 1:1
- 3:4
- 9:16

Batch multiplier:

- x1
- x2
- x3
- x4

Test range historically tracked as `TC-T2I-001` through `TC-T2I-060`.

Current test suite includes matrix/oracle/persistence coverage such as:

- `FullT2IMatrix60.test.ts`
- `T2ICombinatorialMatrix.test.ts`
- `FullT2IRegistryOracle.test.ts`
- `FullT2IPersistence.test.ts`

## 7.3 Text-to-Video (T2V)

Real video generation in Google Flow has been live runtime verified in earlier milestones.

Owner UI model set requested for video node:

- Omni 1.1
- Omni 1.0
- Omni 1.0 Mini
- Omni 1.0 Flash

Do not assume names/provider choices are permanently stable; inspect current registries/UI mapping.

## 7.4 Image-to-Video (I2V)

Core behavior: use exact upstream image media ref and generate video.

The project later added extensive I2V combinatorial tests; current suite includes:

- `I2VCombinatorialMatrix.test.ts`
- `FullI2VMatrix256.test.ts`

## 7.5 Start/End Frame Interpolation

This must remain conceptually distinct from ordinary one-image I2V.

Business-logic decision:

- I2V = one source image / elements-style image-to-video.
- Interpolation = Start Frame + End Frame, two semantically distinct images.

`InterpolationExecutor` was implemented with:

- start image required;
- end image required;
- prompt required and trimmed;
- project isolation for both images;
- adapter `generate` call with interpolation kind;
- completed-via-UI support;
- polling fallback;
- normalized invalid-input behavior.

Latest repository history also contains a direct aisandbox interpolation implementation/fix and Flow media preview support. Recheck current preferred path before modifying.

## 7.6 Reference Images Video

`ReferenceVideoExecutor` exists.

Important behavior:

- non-empty prompt;
- references >= 1;
- ordered image references preserved;
- project isolation for all refs;
- adapter receives exact reference list/usage type;
- correct video output type.

The project successfully rendered an 11-scene workflow using reference-based video generation during earlier live work.

## 7.7 Extend / Edit Video

`ExtendVideoExecutor` was later implemented and tested.

Earlier status docs may still call it partial/pending; do not trust them over current code/tests.

## 7.8 Image Upscale

Known provider enum concepts from API investigation:

```text
UPSAMPLE_IMAGE_RESOLUTION_2K
UPSAMPLE_IMAGE_RESOLUTION_4K
```

Historically direct requests were constrained by reCAPTCHA/provider behavior.

Current code includes `ImageUpscaleExecutor.test.ts`; inspect runtime/evidence for current live verification status before labeling verified.

## 7.9 Video Upscale

Provider research found a video upsample endpoint/shape and registry behavior including 1080p/4K concepts. Current code has `VideoUpscaleExecutor.test.ts` and service-worker upscale hardening tests.

Again, distinguish contract/unit coverage from current live verification.

## 7.10 Media/Input/Utility nodes

FG-1206 utility foundation included concepts such as:

- MediaInput
- ImageInput
- VideoInput
- Preview
- Download

Hardening requirements included:

- explicit provenance;
- statically typed ports;
- mandatory `mediaType`;
- transient `previewUrl` resolution.

Presentation semantics later required all visible/canonical node kinds to stay aligned with the actual count. Historical accepted report mentioned **26/26 node kinds** and specifically adding `mediaInput` to the expected semantic registry.

Current observed `PresentationSemantics.test.ts` in the 730-test run reports 6 tests (not the older reported 26-test internal count), so inspect source before quoting internal test counts.

## 7.11 Download

Real media resolution + Chrome downloads.

Core V1 pipeline historically proven:

```text
Prompt -> T2I -> exact IMAGE -> I2V -> exact VIDEO -> Download
```

## 7.12 Gemini / AI enhancement

There is/was Gemini adapter/UI integration. Do not add arbitrary AI providers.

Latest accepted settings behavior: saving Gateway/AI settings should hot-update the live Gemini adapter without requiring page reload, conceptually via:

```js
window.__geminiAdapter.updateConfig({ baseUrl, apiKey, defaultModel })
```

Never hardcode secrets into repo/context/evidence.

## 7.13 Character / continuity concepts

FlowGraph has explored character/likeness/continuity workflows.

A separate canonical character specification called `KAI_001` exists in conversation context, but it is content/example data, not a core immutable runtime architecture requirement unless actively used by the owner.

Do not confuse content DNA with FlowGraph runtime contracts.

---

# 8. GOOGLE FLOW INTEGRATION KNOWLEDGE

## 8.1 Earlier API research

A large Google Flow API reference was built and is stored in:

`flowgraph-extension/docs/GOOGLE_FLOW_API_REFERENCE.md`

Related docs exist under `docs/01...11`.

Historically investigated pipelines/endpoints:

- image upload;
- text to video;
- image to video;
- interpolation;
- reference;
- text to image;
- video upscale;
- cancel active generation;
- character creation;
- image transform;
- image upscale 2K/4K.

## 8.2 Evidence labels

The API/runtime research adopted strict evidence labeling.

Rules:

- never claim live success from payload shape alone;
- a successful fixture + artifact is required for strong runtime claims;
- reCAPTCHA-blocked direct endpoint tests remain partial, not verified;
- sanitize evidence;
- do not export cookies/tokens;
- do not fake provider responses.

## 8.3 reCAPTCHA root cause

A key discovery:

```text
Direct background/service-worker generation fetch
-> provider sees missing/abnormal user gesture/context
-> 403 / unusual activity / reCAPTCHA
```

The practical solution was to interact with the **real Google Flow tab** instead of trying to circumvent provider protections.

## 8.4 UI synchronization

FlowGraph syncs supported state to/from Google Flow UI, including concepts such as:

- active mode/generation node;
- prompt;
- model;
- aspect ratio;
- duration;
- resolution;
- Start Frame;
- End Frame;
- ordered Reference Media;
- project state;
- generation/result state.

Synchronization hardening includes:

- sequence/conflict guard;
- loop/echo prevention;
- project mismatch protection;
- bounded timeouts;
- tolerant handling when UI element is temporarily unavailable.

Recent repository commits include fixes for:

- reliable Angular CDK mode-pane switching;
- physical CDP coordinate clicking for settings controls;
- sync timeout handling;
- authentic Flow media detection.

---

# 9. SIDE PANEL

Side Panel integration reached a mature milestone with real data rather than mock content.

Completed ideas:

- remove mock/fake account/credit/project/log data;
- refresh button;
- real health/account/Flow/project state;
- credits/provider display where available;
- runtime synchronization;
- last-run display;
- live execution log;
- `FLOWGRAPH_EVENT` event stream;
- producer from Studio -> consumer in Side Panel.

Events historically normalized around concepts like:

- `node:status`
- `node:result`
- `run:state`
- `run:error`

Do not reintroduce placeholder account/credit values.

---

# 10. CREDIT / SUBSCRIPTION OBSERVATION

During FG-0903 investigation, the provider UI showed a PRO-style subscription state and did not expose a reliable numeric credit balance through the bridge. No decrement was observed in that context.

Do not hardcode a conclusion that all accounts are unmetered. Treat credit behavior as account/provider-dependent and dynamically observed.

---

# 11. LIVE VERIFICATION HISTORY

A major milestone called roughly **FLOWGRAPH REAL RUNTIME V1 / FG-1300 LIVE Verification** closed 6/6 live checks:

1. Chrome test instance using remote debugging port 9222, extension loaded.
2. Project gate & active project binding.
3. 8 workspaces visible/verified:
   - FLOWGRAPH
   - PROJECT
   - CONTINUITY
   - SHOTS
   - ASSETS
   - STORYBOARD
   - TIMELINE
   - RENDER
4. Node Library / IO / drag-drop, including Start Frame and End Frame slots.
5. Runtime end-to-end execution, result visibility, Side Panel sync.
6. Persistence/reload.

This milestone was considered `RUNTIME_VERIFIED` / closed at the time.

Chrome testing conventions:

- remote debugging port: `9222`
- historical test profile: `E:\Flow_veo\chrome-profile`
- helper tools live under `flowgraph-extension/tools/`

---

# 12. UI / UX — OWNER'S STRONG PREFERENCES

These preferences matter. The owner repeatedly rejected overly decorative UI.

## 12.1 Overall style

- Minimal.
- Professional.
- Media-first.
- No excessive borders.
- “Viền càng mỏng càng tốt.”
- Avoid colorful/neon/glassmorphism for core product UI.
- Text must be readable; previous versions were criticized for text being too small.
- Keep canvas spacious.

## 12.2 Node visual behavior

- Node size should reflect video/image aspect ratio where useful.
- Nodes may support stepped resizing.
- 16:9 preview should be visually prominent.
- Final output node should show the completed video/media.
- Do not repeat labels unnecessarily.

Example owner feedback:

- If a node already says Prompt, do not repeat Prompt twice.
- If port type is obvious, show a compact `in`/`out` descriptor below node/port.
- Start/End node needs sufficiently clear labels to distinguish Start Frame and End Frame.

## 12.3 Canvas layout

Previous directive:

- remove or minimize bottom Execution Panel;
- remove/minimize right Inspector Panel if it wastes canvas space;
- canvas should occupy nearly full width/height;
- use clean, smooth Bézier/cubic edges;
- edges should stay behind nodes;
- avoid edge overlap/obstacles where possible.

Recent git history shows several edge/layout iterations:

- smart obstacle avoidance;
- fork/join layout;
- ensure edges remain below nodes;
- standard cubic Bézier;
- canonical clean multi-node layout.

## 12.4 Node library / palette — latest direction

The owner wants the node list to resemble a Windows-style compact icon list, not a large card panel.

Latest intent:

- node palette appears directly/floating on the canvas;
- transparent/no large background container;
- compact icon on the left, text on the right;
- horizontally/vertically scrollable to access additional nodes;
- no large bounding cards that consume canvas;
- layout inspired more by the second reference image the owner provided in prior UI discussion.

Recent git history indicates:

- multi-format drag-and-drop;
- instant double-click spawn;
- 7-node canonical layout;
- palette drop onto existing node cards must bubble to canvas spawning instead of being swallowed by preview drop handler.

Latest commit visible at snapshot:

```text
0b5edf8 fix(canvas): palette drop onto node cards now bubbles to canvas spawn instead of being silently swallowed by preview drop handler
```

## 12.5 Icons/colors

A previous request explored a neon glassmorphism sprite sheet with color groups. The owner explicitly disliked the result: “màu mè quá”, “xấu quá”.

Therefore do **not** assume neon 3D icons are desired for the actual product UI.

Prefer established, clean icon libraries and restrained palette unless owner explicitly asks for decorative branding assets.

---

# 13. WORKSPACE / FILM-PRODUCTION CONCEPTS

The product has UI workspaces for larger creative production organization:

- FLOWGRAPH — actual node workflow studio
- PROJECT — project-level context/settings
- CONTINUITY — continuity/character/style consistency
- SHOTS — shot organization
- ASSETS — reusable media/reference assets
- STORYBOARD — shot/story planning
- TIMELINE — temporal arrangement
- RENDER — final output/render-related surface

Do not infer that every workspace has equal runtime maturity. FLOWGRAPH runtime is the core product.

---

# 14. PERSISTENCE

Persistence and reload have been explicitly tested.

Preserve:

- workflow definitions;
- project binding;
- safe media references/provenance;
- node configuration;
- run history where applicable;
- transient preview URLs should not be treated as durable canonical identity if they can expire.

Current suite includes `WorkflowPersistence.test.ts` and T2I persistence coverage.

---

# 15. MEDIA HANDLING

Key rules:

1. Store canonical provider/media identity, not fragile synthetic URLs.
2. Resolve live preview URLs when needed.
3. Track `mediaType` explicitly.
4. Enforce project provenance.
5. Preserve ordered multi-input references.
6. Do not send local/dropped fake IDs to provider `/asb/` endpoints.
7. Real video/image previews are a primary UI concern.

Recent fixes in git history include:

```text
0968cb6 guard local and dropped mediaIds from hitting Flow asb proxy
24bbc5c remove synthetic /asb/<uuid> and use authentic Google Flow media tokens
034d199 fix DOM image selector / Start-End video preview
1c54a9f enable interactive video player overlay
```

---

# 16. TESTING AND QA HISTORY

The automated suite grew substantially over the project lifecycle.

Historical milestones included:

- 49/49
- 104/104
- 111/111
- 121/121
- 178/178
- 187/187
- and later 730/730.

**Current snapshot verification:**

```text
Test Files: 36 passed (36)
Tests:      730 passed (730)
Duration:   ~7.52s Vitest internal run
```

Observed test files include:

- FlowSyncController
- UtilityNodes
- ReferenceVideoExecutor
- ExtendVideoExecutor
- WorkflowRuntime
- FlowPayloads
- InterpolationExecutor
- GraphValidator
- SidePanelIntegration
- ServiceWorkerUpscaleContract
- VideoTileDetection
- ProviderConcurrencyLimit
- UpscaleBoundaryHardening
- SyncConflictGuard
- VideoUpscaleExecutor
- NewDedicatedExecutors
- ImageUpscaleExecutor
- FullI2VMatrix256
- WorkflowPersistence
- FullT2IPersistence
- StudioCanvasE2E
- CacheStore
- GraphPlanner
- GoogleFlowAdapterSync
- PresentationSemantics
- I2VCombinatorialMatrix
- FullT2IMatrix60
- TimeoutBudget
- T2ICombinatorialMatrix
- FullT2IRegistryOracle
- PollManager
- FlowSyncTypes
- RuntimeError
- RuntimeValue
- Bridge
- FilmModel

## 16.1 Test philosophy

Unit test pass is necessary but not sufficient for live provider claims.

For provider-dependent capabilities:

```text
unit/contract test + build/typecheck
          !=
RUNTIME_VERIFIED
```

Runtime verification requires actual Google Flow execution and evidence/artifact.

---

# 17. BUILD / QUALITY GATES

For nontrivial implementation work, expected completion checklist:

```text
[ ] inspect current code and existing tests
[ ] implement smallest correct change
[ ] add/update tests
[ ] npm test -- --run (or current project command)
[ ] TypeScript check
[ ] production build
[ ] git diff review
[ ] live Google Flow verification if capability touches provider runtime
[ ] sanitize evidence
[ ] report exact results
```

Do not claim build/typecheck results without running them.

---

# 18. EVIDENCE & SECURITY RULES

These are strict project rules.

## Allowed / required

- sanitized requests/responses;
- real generated image/video evidence;
- MP4 artifacts;
- project IDs only where non-sensitive and safe;
- claim IDs and evidence manifests;
- real UI screenshots where appropriate.

## Prohibited

- CAPTCHA bypass;
- cookie extraction/export;
- auth-token export;
- storing passwords;
- fabricating API success;
- changing `RUNTIME_PARTIAL` to verified without evidence;
- exposing signed/private media query tokens in reports when avoidable.

Google authentication remains a normal manual user action.

---

# 19. DOCUMENTATION / CAPSTONE CONTEXT

The owner prepared Capstone documentation in Vietnamese and English.

Important requirements:

- proposal/project documents should focus 100% on FlowGraph Extension;
- avoid local machine paths inside formal academic deliverables;
- add Table of Contents;
- include System Context Diagram;
- include Use Case Diagram;
- include System Architecture Diagram;
- clearly explain abbreviations:
  - T2I = Text-to-Image
  - T2V = Text-to-Video
  - I2V = Image-to-Video
- define Full node/video modes clearly;
- use `https://github.com/xyflow/xyflow` as an added reference where applicable;
- follow capstone template formatting when producing final docs.

The local repo already has documents such as:

- `docs/FLOWGRAPH_EXTENSION_ARCHITECTURE_DRIVER.md`
- `docs/FLOWGRAPH_EXTENSION_PROPOSAL.md`
- `docs/FlowGraph_Extension_Capstone_Proposal_2026.docx`
- `docs/GOOGLE_FLOW_API_REFERENCE.md`
- `FLOWGRAPH_V1_RELEASE_REPORT.md`

Some docs are historical and may lag the code.

---

# 20. PROJECT DEVELOPMENT PROCESS / AI COLLABORATION MODEL

The owner established a two-role loop:

## Role A — GPT Web / Chief Architect / PM

Responsibilities:

- inspect current state via MCP/filesystem;
- understand architecture and live evidence;
- define precise next tasks;
- review implementation;
- enforce runtime/evidence standards;
- prevent scope drift.

## Role B — Pipo Agent / Senior Engineer

Responsibilities:

- edit code directly;
- run tests/build;
- perform live verification;
- collect sanitized evidence;
- report back.

Loop:

```text
Architect reviews -> assigns exact task
      -> Engineer implements/tests/verifies
      -> reports evidence
      -> Architect accepts/rejects/assigns next
```

A future AI can perform both roles if it has filesystem/browser/tool access, but should preserve the same discipline.

---

# 21. IMPORTANT COMPLETED MILESTONES

## Runtime Foundation

- Graph validator/planner/runtime foundation completed.
- Typed runtime values.
- Retry/cancel/cache/polling foundations.
- Project gate.
- Exact media binding.

## T2I / T2V / I2V

- T2I live pipeline.
- T2V live pipeline.
- I2V live pipeline.
- T2I combinatorial QA matrix.
- large I2V matrix test coverage.

## Interpolation

- standalone executor implemented.
- prompt contract hardened.
- start/end project isolation.
- live work performed.

## Reference video

- ordered multi-input runtime support.
- executor implemented.
- 11-scene reference workflow previously rendered.

## Side Panel

- removed mock values.
- live account/Flow/project runtime state.
- live runtime log/events.
- Studio-to-SidePanel integration.

## Real Runtime V1

- project gate/live extension verified.
- core workspaces visible.
- runtime execution and result flow.
- persistence/reload.

## Provider concurrency

- cap to 2.

## Later UI/runtime hardening

Recent git history as of snapshot shows active refinement of:

- interpolation endpoint path;
- authentic media URLs;
- CDP clicking;
- settings/mode synchronization;
- canvas wire routing;
- interactive video preview;
- combobox dimensions/readability;
- node palette drag/drop/double-click spawning.

---

# 22. KNOWN HISTORICAL PITFALLS

## 22.1 README drift

The root README still contains older V1 numbers and capability table entries. Example: it may say 104/104 tests or mark Interpolation/Reference standalone executor as pending even though later code/tests implemented them.

Never use README alone as current truth.

## 22.2 Direct provider fetch != safe runtime

Direct calls may be technically understood but still blocked by reCAPTCHA/unusual activity. Do not regress to aggressive background calls just because endpoint payloads are known.

## 22.3 Synthetic media IDs

Do not generate plausible-looking Flow asset URLs/IDs. Resolve authentic media.

## 22.4 UI-only node inflation

Do not declare system “complete” by adding many visual nodes without executors.

## 22.5 Excess decorative UI

Owner repeatedly rejected oversized cards, excessive frames, tiny text, neon/glass styling, and clutter.

## 22.6 Confusing I2V and Interpolation

Keep their semantics distinct.

---

# 23. CURRENT REPOSITORY SNAPSHOT SIGNALS

Recent commits observed on 2026-09-09, newest first:

```text
0b5edf8 fix(canvas): palette drop onto node cards now bubbles to canvas spawn instead of being silently swallowed by preview drop handler
0415c52 fix(interaction): enable multi-format drag-and-drop and instant double-click spawn with clean 7-node canonical layout
1c54a9f fix(ui): ensure edges stay strictly beneath nodes with standard cubic bezier and enable interactive video player overlay
c2f6db6 feat(layout): perfect fork-join spatial arrangement ensuring 100% obstacle-free wire routing
e4334b3 feat(ui): implement smart obstacle avoidance edges and clean layout routing for clutter-free canvas
034d199 fix(ui): perfect combobox dimensions, eliminate text truncation, and resolve DOM image selector for seamless Start-End video preview
17d1331 fix(pipeline): enable direct aisandbox interpolation endpoint for instant Start-End video generation and support flow-content CDN preview
24bbc5c fix(media): completely remove synthetic /asb/<uuid> url generation and fetch only authentic Google Flow /asb/AB-n tokens via DOM scraping
839664e fix(sync): implement true physical CDP coordinate clicking for settings-trigger-button and Angular CDK mode pane switching
66bb47f fix(sync): streamline openComposerSettings to reliably detect and toggle Angular CDK mode pane
7befcfe fix(sync): eliminate BridgeTimeoutError by lowering sync timeouts, gracefully handling sync writes and catching runtime message errors
0968cb6 fix(media): guard local and dropped mediaIds from hitting flow asb proxy to eliminate 400 Bad Request console errors
```

Interpretation: the project is no longer only building runtime primitives; it is actively polishing live Google Flow UI sync, media authenticity, and production canvas interaction.

---

# 24. RECOMMENDED ONBOARDING COMMANDS FOR A NEW ACCOUNT

Assuming MCP/filesystem/terminal access to the machine:

```powershell
cd E:\Flow_veo\flowgraph-extension

git status --short
git log --oneline -15

cmd /c npm test -- --run
cmd /c npm run build
```

Then inspect `package.json` for current scripts and run the TypeScript/typecheck command defined by the project.

Useful files to inspect first:

```text
src/runtime/
src/adapters/
src/background/
src/content/
src/ui/studio/
tests/unit/
public/manifest.json
manifest.json
README.md
FLOWGRAPH_V1_RELEASE_REPORT.md
docs/GOOGLE_FLOW_API_REFERENCE.md
```

If doing live browser verification:

- check Chrome CDP port 9222;
- inspect current Flow project tab;
- verify extension build is loaded from `dist/`;
- do not assume an old browser target/page remains valid.

---

# 25. NEXT-AI DECISION RULES

When asked “continue the project” without a detailed task:

1. Read this handoff.
2. Check `git status` and recent commits.
3. Run current tests/build/typecheck.
4. Inspect TODOs/current failing live behavior, not old conversations.
5. Prefer fixing the narrowest real user-visible defect.
6. Preserve all existing passing tests.
7. Add regression tests.
8. Verify in real Google Flow for provider/UI integration changes.
9. Commit only when owner or workflow expects it; do not push unless explicitly authorized.

When a new request conflicts with older design guidance, the **newest explicit owner instruction wins**.

---

# 26. UI NODE-LIBRARY DIRECTION — CURRENT HANDOFF

Because this was the owner's most recent design focus before this context snapshot, preserve it unless changed:

```text
Canvas background
  + floating transparent node list
      [icon] Node Name
      [icon] Node Name
      [icon] Node Name
  + no giant panel card
  + compact Windows-like application/icon-list feel
  + readable text
  + can scroll for more nodes
  + drag node to canvas
  + double-click node to spawn
```

Node palette must not steal excessive space from the graph.

Dropping palette nodes over an existing card should still spawn at canvas coordinates rather than being consumed by media preview drop zones.

---

# 27. PROFESSIONAL VIDEO / FILM WORKFLOW VIEW

The owner wants the system to eventually support professional creation patterns, but current engineering should interpret that as composable graph capability rather than an all-in-one nonlinear editor.

FlowGraph's useful professional strengths:

- reusable generation graphs;
- precise media dependency chaining;
- project isolation;
- reference/continuity inputs;
- start/end interpolation;
- extend/upscale operations;
- branching and multi-input flows;
- asset and shot organization;
- preview/download;
- reproducibility.

Do not claim arbitrary-length film production is solved purely by one generation node. Longer projects require scene/shot orchestration, continuity, asset management, timeline/render composition, and provider constraints.

---

# 28. TERMINOLOGY

Use these consistently:

- **FlowGraph**: the Chrome extension/workflow system.
- **Google Flow**: external provider/web app.
- **Studio**: primary FlowGraph UI.
- **Node kind**: executable/presentational node type.
- **Executor**: runtime implementation for a supported node kind.
- **MediaRef**: canonical runtime media identity/provenance wrapper.
- **Project Gate**: prevents editing/execution without valid Flow project context.
- **T2I**: Text-to-Image.
- **T2V**: Text-to-Video.
- **I2V**: Image-to-Video.
- **Interpolation**: Start Frame + End Frame video generation.
- **Reference Video**: generation using one or more ordered reference images.
- **Runtime Verified**: proven with real provider execution/evidence.

---

# 29. WHAT NOT TO STORE IN FUTURE HANDOFFS

Do not put the following in this file or successor context files:

- access tokens;
- cookies;
- passwords;
- 2FA secrets;
- signed private URLs with durable credentials;
- personal account credentials;
- private API keys.

Reference configuration conceptually only.

---

# 30. SOURCE PRIORITY ORDER

When information conflicts, resolve in this order:

1. **Current live runtime observation/evidence**
2. **Current source code + current passing tests**
3. **Recent git commits**
4. **This master handoff snapshot**
5. **Recent milestone/evidence reports**
6. **Root README**
7. **Older docs / old chat claims**

Reason: documentation inevitably lags an actively changing codebase.

---

# 31. MINIMUM ACCEPTANCE STANDARD FOR NEW FEATURES

A new provider-backed node/capability is not “done” until:

```text
A. UX/presentation exists
B. typed input/output contract exists
C. graph validation supports it
D. executor exists
E. adapter/bridge path exists
F. project provenance is enforced
G. unit/contract tests pass
H. build/typecheck pass
I. live Google Flow run succeeds
J. authentic result/media is observed
K. evidence is sanitized
L. capability status/doc is updated accurately
```

For local-only utility nodes, live provider run may not apply, but runtime behavior still requires tests.

---

# 32. MASTER SUMMARY FOR FAST AI INGESTION

If context window is limited, read this section plus sections 0, 3, 7, 12, 16, 23, 30, 31.

**FlowGraph Extension** is a Manifest V3 Chrome extension that adds a ComfyUI-like node graph on top of Google Flow. It performs real workflow orchestration: graph validation/planning, typed data passing, exact media refs, project isolation, bounded concurrency (known provider cap 2), polling/retry/cancel/cache, persistence, Side Panel telemetry, and realtime UI synchronization. Google Flow remains the actual image/video generator.

The strongest engineering rule is **real evidence over mock success**. Direct service-worker generation requests historically triggered reCAPTCHA/unusual activity, so FlowGraph often interacts with the real authorized Flow tab using content-script/main-world/CDP user-like UI actions rather than bypassing provider protections. Never bypass CAPTCHA, export cookies/tokens, or fabricate results.

Core capabilities have included Prompt, T2I, T2V, I2V, Start/End Interpolation, Reference Video, Extend/Edit, Image/Video Upscale, Media/Image/Video inputs, Preview and Download. Some capability status labels in older README files are stale; inspect current executors/tests/evidence before declaring runtime status.

Multi-input support preserves ordered references. Interpolation must remain distinct from single-image I2V. Authentic Google Flow media identities must be used—recent fixes explicitly removed synthetic `/asb/<uuid>` URLs. Project provenance mismatches must fail closed.

The current automated baseline verified on 2026-09-09 is **36/36 test files and 730/730 tests passing**. The suite includes T2I 60-combination coverage and very large I2V matrix coverage, runtime/persistence/sync/executor/side-panel/upscale tests.

The UI owner wants a highly minimal, professional, media-first design: readable text, thin or no borders, no excessive color, no oversized panels, full canvas, clean Bézier wires behind nodes. The latest node-library direction is a transparent floating Windows-like compact icon+label list on the canvas, scrollable, supporting drag/drop and double-click spawn. Do not reintroduce giant palette cards or neon glassmorphism styling unless explicitly asked.

Current repository activity is focused on live Google Flow integration and UI polish: authentic media token detection, CDP physical click reliability, Angular settings-mode switching, interpolation path, preview/media fixes, edge routing, interactive video overlay, and node palette spawn interactions.

Primary repo: `E:\Flow_veo\flowgraph-extension`.

---

# 33. SNAPSHOT VERIFICATION RECORD

Generated/updated for this handoff on 2026-09-09.

Repository was accessible through the Flow_veo filesystem connector.

Observed:

```text
Repository: E:\Flow_veo\flowgraph-extension
Latest visible commit: 0b5edf8
Vitest result: 36 / 36 files PASS
Total tests: 730 / 730 PASS
```

The exact codebase can change after this file is written. A new AI must rerun verification before making decisions based on counts/status.

---

# 34. CONTEXT UPDATE POLICY

When significant milestones happen, update this same file rather than creating many competing context files.

Recommended update pattern:

```text
- update Snapshot date
- update current test/build status
- add latest git milestone
- update capability states
- record important architectural decisions
- record owner UX decisions
- remove/mark obsolete claims
```

Keep one master handoff file as the entry point. Detailed evidence can remain in `evidence/` and detailed specifications in `docs/`.

---

# END OF FLOWGRAPH MASTER CONTEXT / PROJECT HANDOFF
