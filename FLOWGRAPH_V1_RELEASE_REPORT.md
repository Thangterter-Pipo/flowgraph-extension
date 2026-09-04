# FlowGraph V1 Release Report

Status as of 2026-09-03 04:10 (+07:00). This is the release-ready report requested by the
objective (§36) and the follow-on release task. The companion detail report lives at
[`flowgraph-extension/FLOWGRAPH_V1_RELEASE_REPORT.md`](flowgraph-extension/FLOWGRAPH_V1_RELEASE_REPORT.md).

Every "live" line below cites a captured, sanitized file under
`flowgraph-extension/evidence/flowgraph_v1/`. No claim is based on mock-only passes; no success
is reported without a real artifact. Live session and profile are the dedicated test profile
(`E:\Flow_veo\chrome-profile`), never the user's real profile.

---

## Version

- Real Runtime **V1** (`flowgraph-extension`).
- Workflow schema **v3** (`schemaVersion: 3`).
- Supported runtime kinds: `prompt`, `t2i`, `i2v`, `download`.
- Extension-supported generation via Google Flow UI (not direct provider API).
- Bundle: `dist/assets/studio-CsIUHJAG.js` = **324.84 kB** (gzip **88.97 kB**).

---

## Build

- `npm run build` — **PASS**.
- TypeScript: **0 errors** (`tsc -b`, part of the production build).
- `service-worker.js` + `flow-content-script.js` rebuilt via `build:bridge`.

---

## Tests

- `npm test -- --run` — **49 / 49 PASS** (8 / 8 files).
  - `FlowPayloads` 12, `GraphValidator` 7, `GraphPlanner` 5, `CacheStore` 5,
    `WorkflowRuntime` 8, `PollManager` 4, `RuntimeError` 4, `RuntimeValue` 4.

---

## Runtime architecture

- **Architecture:** `Studio UI -> chrome.runtime.sendMessage -> service-worker bridge ->
  Google Flow tab (CDP UI automation) -> real media`; executors live in
  `src/runtime/executors/`, adapters in `src/adapters/google-flow/`.
- **Retry:** `runtime.retryNode` / `runtime.retryFailed` reuse successful upstream outputs and
  resume downstream without re-running upstream. Automated integration tests cover failure/retry.
  **Status:** code + automated verified; live not re-run this pass.
- **Cancel:** abort of the client runtime plus best-effort provider cancel; dependent nodes
  marked CANCELLED/SKIPPED where supported. `cancelGeneration` shape is `RUNTIME_PARTIAL`.
  **Status:** automated verified; live not re-run this pass.
- **Cache:** project-scoped result cache keyed by node fingerprint (kind/config/prompt/model/seed/
  upstream media IDs/project); `CACHE HIT` surfaced. **Status:** automated + contract verified.
- **Concurrency:** bounded batch scheduler with default concurrency `2`; parallel independent
  branches run within the limit. **Status:** automated verified.
- **Error handling:** normalized `RuntimeError` codes (`AUTH_EXPIRED`, `PROJECT_REQUIRED`,
  `INVALID_INPUT`, `PROVIDER_ERROR`, `MEDIA_FAILED`, `CAPTCHA_REQUIRED`, `TIMEOUT`, `CANCELLED`, ...),
  per-node diagnostics, `UNSUPPORTED_NODE` blocks before any provider call. **Status:** code +
  automated verified.
- **Polling:** `PollManager` wraps `batchCheckAsyncVideoGenerationStatus`; image path is sync and
  returns with 200, video polls to terminal. **Status:** code + automated verified; live video
  polling exercised through Runs 1–4.

---

## Google Account

- Account: **CONNECTED** — `nhom8digitalmarketing1@gmail.com` (display name "Môn Digital Qua"),
  session expires `2026-09-03T13:42:22.000Z`.
  - Evidence: `flowgraph-extension/evidence/flowgraph_v1/account/account_live_2026-09-02T20-15-26Z.json`
    (`sanitized: true`, `secretsPresent: false`).

---

## Google Flow

- Flow: **READY** — tab `https://labs.google/fx/vi/tools/flow/project/23e7d6d8-d0bc-441b-b720-e63b0ffa9d32`,
  title "Google Flow - FlowGraph V1 Live 2026-09-02".

---

## Project management

- Project: **23e7d6d8-d0bc-441b-b720-e63b0ffa9d32** ("FlowGraph V1 Live 2026-09-02"), created via
  the live bridge and selectable in the real project list.
  - Project-list production transport verified live: Studio -> `chrome.runtime.sendMessage` ->
    service-worker -> `project.searchUserProjects`; returns **20 real projects** including the
    target, `account CONNECTED`, `flow READY`, `noSecrets: true`.
  - Evidence: `flowgraph-extension/evidence/flowgraph_v1/projects/project_list_bridge_2026-09-02T20-54-49-209Z.json`,
    `project_list_bridge_2026-09-02T20-57-13-168Z.json`,
    `project_list_live_2026-09-03T03-42-00Z.json`.

---

## Project Gate

- Canvas Gate: **UNLOCK** (live) — `locked: false`, `gateText: null`, `runDisabled: false`, with
  `activeProject` synced to the Flow tab's `projectId`.
- The lock/unlock gate was re-verified this pass: a `home-locked` step shows `locked: true`,
  `runDisabled: true`, gate text `PROJECT REQUIRED`, flow state `PROJECT_REQUIRED`; both
  `project-unlocked` and `project-unlocked-again` show `locked: false`, `runDisabled: false`,
  flow state `READY`.
  - Evidence: `flowgraph-extension/evidence/flowgraph_v1/projects/project_gate_live_2026-09-03T03-42-00Z.json`.
  - The gate fix lives in `src/ui/studio/useStudioConnection.ts` (`refreshAccount()` syncs
    `activeProject` from `liveFlow.projectId`). Do not revert.
- **Live reactivity (fail-closed) verified.** The service worker now derives a definitive gate
  state from the real tab URL (`projectIdFromUrl`) when the content-script relay is still warming
  up after a navigation, and the Studio `FLOWGRAPH_EVENT` listener re-reads the live account state
  so a stale `ERROR` pill clears as soon as the bridge recovers. Reactivity evidence:
  navigating the Flow tab to home locks the canvas (`gate=True`, `runDisabled=True`, pill `warn`)
  within ~1s and navigating back to the project unlocks it (`gate=False`, `runDisabled=False`,
  pill `online`) within ~1s — no reload, no 120s poll, no forced unlock.
  - Evidence: `flowgraph-extension/evidence/flowgraph_v1/projects/project_gate_live_reactivity_2026-09-02T21-35-38-062Z.json`,
    `project_gate_live_reactivity_2026-09-02T21-36-13-566Z.json`,
    `project_gate_live_reactivity_2026-09-02T21-52-54-889Z.json` (fresh re-probe after rebuild).
  - Fix files: `src/background/service-worker.ts` (`projectIdFromUrl`, `pingFlowTab` catch
    fallback) and `src/ui/studio/useStudioConnection.ts` (`FLOWGRAPH_EVENT` listener calls
    `refreshAccount()`).

---

## T2I

- Prompt inserted: **YES** — `Input.insertText` into the Slate `[contenteditable]` editor.
- Generate clicked: **YES** — production path dispatches `Input.dispatchMouseEvent`
  (pressed + released) at the center of `button > i.google-symbols[textContent="arrow_forward"]`
  and never force-enables or un-disables the button. Runs 1–4 producing real media is the proof.
- Live mediaId (Run 4): **`ff49d846-c300-404f-a2d2-adddc9c31b83`** (`image/jpeg`).
- Preview: **rendered `<img>`** via `media.getMediaUrlRedirect?...=ff49d846...`
  (`naturalWidth 1376`, `naturalHeight 768`).
- Result: **SUCCESS** — T2I node status `success`, downstream continued.
  - Evidence: `flowgraph-extension/evidence/flowgraph_v1/t2i/run1_20260903_012408.json`,
    `run2_20260903_013803.json`, `run3_20260903_013938.json`, `run4_20260903_021704.json`.
  - Historical 403 `PUBLIC_ERROR_UNUSUAL_ACTIVITY` / `reCAPTCHA evaluation failed` is preserved as
    `t2i/t2i_recaptcha_failure_evidence.json` (`fakeSuccessEmitted: false`). The direct provider
    path is not the production path.

---

## I2V

- Upstream T2I mediaId: **exact match** — I2V is fail-closed on the upstream `startImage.mediaId`.
  - Run 4 upstream = `ff49d846-c300-404f-a2d2-adddc9c31b83` (the exact T2I output).
- Selected exact upstream media: **YES** — UI automation locates the media element whose URL /
  `data-media-id` contains exactly the upstream ID, selects it, then generates. If the exact ID is
  not found it returns an error (no "last image" fallback, no random state selection).
- Video mediaId (Run 4): **`31e26cf9-dbf3-4538-ad96-acb39a8f4f94`** (`video/mp4`),
  upstream = `ff49d846...`.
- Preview: **rendered `<video>`** via `media.getMediaUrlRedirect?...=31e26cf9...`.
- Result: **SUCCESS** — I2V node status `success`.
  - Evidence: `flowgraph-extension/evidence/flowgraph_v1/i2v/run1_20260903_012408.json`,
    `run2_20260903_013803.json`, `run3_20260903_013938.json`, `run4_20260903_021704.json`.

---

## Download

- Download ID: **2** (Run 1), **3** (Run 2), **4** (Run 3); Run 4 uses the same Chrome download bridge.
- Artifact: `flowgraph-output (3).mp4` (Run 4), **2,355,932** bytes, `video/mp4`,
  referenced from `C:\Users\thang\Downloads\flowgraph-output (3).mp4`.
- Result: **SUCCESS** — download node resolves the exact I2V `mediaId` and only reports success
  once the download starts/completes.
  - Evidence: `flowgraph-extension/evidence/flowgraph_v1/download/run1_20260903_012408.json`,
    `run2_20260903_013803.json`, `run3_20260903_013938.json`, `run4_20260903_021704.json`.

---

## Media Preview

- T2I node-card preview renders `<img>` via `media.getMediaUrlRedirect` (Run 4,
  `naturalWidth 1376`, `naturalHeight 768`).
- I2V node-card preview renders `<video>` via `media.getMediaUrlRedirect` (Run 4).
- Download node-card preview renders `<video>` via `media.getMediaUrlRedirect` (Run 4).
- Good precedent: `e2e/run4_preview_render.png`.

---

## Save / Reload / Restore

- **SUCCESS** (three passes; latest with non-null `runtimeResults`):
  - `e2e/save_reload_restore_2026-09-02T20-05-38-766Z.json`
  - `e2e/save_reload_restore_2026-09-02T20-15-26-857Z.json`
  - `e2e/save_reload_restore_2026-09-02T20-40-52-119Z.json`
- After `Save`, schema v3 workflow `FlowGraph V1 Pipeline` persists 4 nodes / 3 edges,
  `projectBinding` `23e7d6d8...`, and the restored Studio reload rehydrates `runtimeResults`
  (media ID + metadata only; no signed URLs, no secrets).

---

## Retry

- `runtime.retryNode` / `runtime.retryFailed` reuse successful upstream outputs and resume
  downstream without re-running upstream.
- **Status:** automated integration tests (`WorkflowRuntime.test.ts`) cover failure/retry.
  Live retry was not re-exercised this pass (honest caveat).

---

## Cancel

- Abort of the client runtime plus best-effort provider cancel; dependent nodes marked
  CANCELLED/SKIPPED where supported.
- `cancelGeneration` shape is `RUNTIME_PARTIAL`.
- **Status:** automated verified; live not re-run this pass.

---

## Cache

- Project-scoped result cache keyed by node fingerprint (kind/config/prompt/model/seed/upstream
  media IDs/project); `CACHE HIT` surfaced.
- **Status:** automated + contract verified.

---

## Concurrency

- Bounded batch scheduler with default concurrency `2`; parallel independent branches run within
  the limit.
- **Status:** automated verified.

---

## Error handling

- Normalized `RuntimeError` codes: `AUTH_EXPIRED`, `PROJECT_REQUIRED`, `INVALID_INPUT`,
  `PROVIDER_ERROR`, `MEDIA_FAILED`, `CAPTCHA_REQUIRED`, `TIMEOUT`, `CANCELLED`, etc.
- Per-node diagnostics; `UNSUPPORTED_NODE` blocks before any provider call.
- **Status:** code + automated verified.

---

## Security

- No CAPTCHA bypass: **TRUE** — no spoofed user activation, no injected/faked reCAPTCHA token, no
  anti-bot override. CAPTCHA/security challenge surfaces as `CAPTCHA_REQUIRED` / provider error.
- No token leak: **TRUE** — no `Authorization`, `access_token`, or reCAPTCHA token is written to
  evidence; account evidence has `secretsPresent: false`; project list has `noSecrets: true`.
- No cookie leak: **TRUE** — no cookie is copied to evidence or UI; the UI adapter is sanitized and
  the service worker never forwards raw credentials to React.
- No fake success: **TRUE** — the historical reCAPTCHA rejection was recorded as a real
  `PROVIDER_ERROR` (`fakeSuccessEmitted: false`); `UNSUPPORTED_NODE` blocks unsupported kinds
  before any provider call.
- Audit note: the bearer token is held in-memory in the service worker only; the content script
  relays OAuth/reCAPTCHA token to the SW transiently and never surfaces it to React, localStorage,
  `chrome.storage`, or any log. UI persists only non-secret metadata (account/flow/project/
  mediaId/mimeType/fileName; never signed preview URLs).

---

## Live Runs

Real chain `Prompt -> T2I -> I2V -> Download`, on the live Google Flow session (project
`23e7d6d8...`):

- **Run 1** — SUCCESS. T2I `169262ae...` -> I2V `d7037bf3...` (upstream exact) -> download
  `flowgraph-output.mp4` (2,480,531 B, downloadId 2). `e2e/run1_20260903_012359.json`
- **Run 2** — SUCCESS. T2I `ad357851...` -> I2V `de94329e...` (upstream exact) -> download
  `flowgraph-output (1).mp4` (2,045,762 B, downloadId 3). `e2e/run2_20260903_013803.json`
- **Run 3** — SUCCESS. T2I `fa406712...` -> I2V `290f881c...` (upstream exact) -> download
  `flowgraph-output (2).mp4` (2,868,029 B, downloadId 4). `e2e/run3_20260903_013938.json`
- **Run 4** — SUCCESS (includes node-card preview render proof). T2I `ff49d846...` -> I2V
  `31e26cf9...` (upstream exact) -> download `flowgraph-output (3).mp4` (2,355,932 B).
  `e2e/run4_20260903_021704.json`, `e2e/run4_preview_render.png`

Run count: **4 consecutive live successes**, exceeding the "2–3 successful runs" release bar.

---

## Evidence Index

All under `flowgraph-extension/evidence/flowgraph_v1/`:

- `account/account_live_2026-09-02T20-15-26Z.json`
- `projects/project_gate_live_2026-09-02T20-01-03-955Z.json`
- `projects/project_gate_live_reload_2026-09-02T20-02-16-550Z.json`
- `projects/project_gate_live_2026-09-03T03-42-00Z.json`
- `projects/project_gate_live_reload_2026-09-02T20-41-22-114Z.json`
- `projects/project_gate_live_reactivity_2026-09-02T21-35-38-062Z.json`
- `projects/project_gate_live_reactivity_2026-09-02T21-36-13-566Z.json`
- `projects/project_gate_live_reactivity_2026-09-02T21-52-54-889Z.json`
- `projects/project_list_live.json`
- `projects/project_list_request_shape.json`
- `projects/project_list_live_2026-09-03T03-42-00Z.json`
- `projects/project_list_bridge_2026-09-02T20-54-49-209Z.json`
- `projects/project_list_bridge_2026-09-02T20-57-13-168Z.json`
- `t2i/run1_20260903_012408.json`, `t2i/run2_20260903_013803.json`,
  `t2i/run3_20260903_013938.json`, `t2i/run4_20260903_021704.json`
- `t2i/t2i_recaptcha_failure_evidence.json`
- `i2v/run1_20260903_012408.json`, `i2v/run2_20260903_013803.json`,
  `i2v/run3_20260903_013938.json`, `i2v/run4_20260903_021704.json`
- `download/run1_20260903_012408.json`, `download/run2_20260903_013803.json`,
  `download/run3_20260903_013938.json`, `download/run4_20260903_021704.json`
- `e2e/run1_20260903_012359.json`, `e2e/run2_20260903_013803.json`,
  `e2e/run3_20260903_013938.json`, `e2e/run4_20260903_021704.json`
- `e2e/run4_preview_render.png`
- `e2e/save_reload_restore_2026-09-02T20-05-38-766Z.json`,
  `e2e/save_reload_restore_2026-09-02T20-15-26-857Z.json`,
  `e2e/save_reload_restore_2026-09-02T20-40-52-119Z.json`
- `e2e/fresh_session_boundary_2026-09-03T03-42-00Z.json`

---

## Known Limitations

- **Fresh cold-session E2E is NOT fully verified.** A truly cold profile was launched (port 9226)
  and probed: no auth token (`hasAccessToken: false`, `user: null`) and the extension did not load;
  the content script was not injected. A first-run cold E2E legitimately stops at manual login +
  extension load. This boundary is not automated, and token / cookie / password automation is out
  of scope by policy. Documented as `STOPPED-AT-MANUAL-LOGIN` in
  `e2e/fresh_session_boundary_2026-09-03T03-42-00Z.json`; FG-1505 remains unchecked for this item.
- **Credit actual delta is NOT live-verified.** `probe_credits_9224.mjs` returns only
  `userPaygateTier: PAYGATE_TIER_ONE` and `serviceTier: SERVICE_TIER_INTERMEDIATE`; it does not
  expose a reliable before/after credit count. FG-1504 `Verify credits if measurable` remains
  unchecked; the report documents credits as unknown, not fake.
- **Retry / cancel / error live paths were not re-exercised this pass.** Covered by automated
  integration tests only; live retry/cancel/error runs were not performed on this session.

These items are follow-up / hardening work, not failures of the core `Prompt -> T2I -> I2V ->
Download` runtime, which has four consecutive live successes on a real Google Flow session.

---

## Capability Matrix

See [`docs/FLOWGRAPH_RUNTIME_CAPABILITY_MATRIX.md`](docs/FLOWGRAPH_RUNTIME_CAPABILITY_MATRIX.md).

Summary:

- `RUNTIME_VERIFIED`: `prompt`, `t2i`, `i2v`, `download` — real runtime evidence confirmed.
- `RUNTIME_PARTIAL`: `t2v`, `extend`, `interpolation`, `reference`, `upscale`, `imageTransform`,
  `imageUpscale`, `cancelGeneration`, `characterCreate` — adapter/payload partially verified;
  executor not enabled or provider constraints block success.
- `UI_ONLY`: `uploadImage`, `gemini`, `likenessCheck`, `likenessList`, `characterAssign`,
  `creationAgent`, `condition`, `delay`, `note` — palette node exists; no runtime path; never
  simulated on Run.
- `COMING_SOON`: not implemented (e.g., remaining backlog features).

**Honesty rule:** No kind in the matrix shows fake success. Run validation reports
`UNSUPPORTED_NODE` for anything without an executor, before any provider call.

---

## Final Verdict

**READY** for FLOWGRAPH Real Runtime V1 (extension-supported runtime).

The core real pipeline (`Prompt -> Text-to-Image -> Image-to-Video -> Download`) has **4 consecutive
live successes** on a real Google Flow session, with:

- real account / flow / project / canvas gate (project gate locked and unlocked verified);
- real inserted prompt and `arrow_forward` click (no force-enable, no direct provider path);
- exact upstream T2I → I2V media binding (fail-closed), real video `mediaId`;
- real Chrome download artifact with bytes;
- save / reload / restore rehydrating `runtimeResults` on a schema-v3 workflow;
- no CAPTCHA bypass, no token/cookie leak, no fake success.

Release caveats carried forward (documented above, not blocking the V1 gate): fresh cold-session
full E2E, live credit-delta verification, and live retry/cancel/error runs.

---

# ADDENDUM — 2026-09-05 05:45 (+07:00): three clean full-chain passes

Since the report above was written, the pipeline was re-run **three times end to end with the
cache bypassed**, on the live project `729eaa19-1c85-4cfc-89c3-5f86de2dffc5`, each pass producing
brand-new image and video `mediaId`s and a real MP4 on disk:

| Pass | Run | T2I image | I2V video | Download | Bytes | Wall time |
|---|---|---|---|---|---|---|
| 1 | `38e0eda0` | `c8253b91…` | `7f06b147…` | id 33 `flowgraph-output (10).mp4` | 8,380,117 | 125 s |
| 2 | `6f9e6355` | `54207841…` | `b47ecddd…` | id 34 `flowgraph-output (11).mp4` | 8,089,921 | 123 s |
| 3 | `3bf976c5` | `fb3650ad…` | `b8db27b9…` | id 35 `flowgraph-output (12).mp4` | 7,933,254 | 113 s |

All three files start with a real `ftypisom` box header
(`00 00 00 20 66 74 79 70 69 73 6f 6d`), and the Studio node cards render the actual media
(`img` natural size 1376×768 for the Run 7 image). Evidence:
`evidence/flowgraph_v1/e2e/run[5-7]_*.json` plus the matching per-node `t2i/`, `i2v/`,
`download/` files.

Five defects were found and fixed on the way, each committed and live-verified:

1. `856b6d7` — `Fetch.enable` + `failRequest` on `flow-content.google/video/*` stops the app making
   a duplicate copy while the signed URL is captured.
2. `8b05820` — the Flow tab returns to the project gallery after a download resolves.
3. `6e20ccb` — `downloadMedia()` polls `chrome.downloads.search({id})` instead of trusting
   `onChanged` deltas; resolve/transfer budgets split 90 s / 180 s.
4. `66b110d` — content script emits `SYNC_STATE` when `uiVerified` flips, so Generate is not
   latched off after a composer swap.
5. `ba8d31d` — the Flow gallery is virtualised to a fixed 8 `<flow-video-tile>`, so a finished
   render *replaces* the oldest tile. `decideVideoTileArrival()` now also accepts an unknown tile
   index, which removes a false `Timed out waiting for generated media` (runs `882a2552`,
   `0d64e93e`) that occurred while Flow had already rendered the video.

Automated state after the fixes: **104/104 tests PASS (15 files)**, `npx tsc --noEmit` clean,
`npm run build` PASS.

**Verdict unchanged and strengthened: READY** for FLOWGRAPH Real Runtime V1. The remaining
caveats above still stand (fresh cold-session login is a manual user step, credit-delta is not
measurable from the UI, retry/cancel exercised only by automated tests).
