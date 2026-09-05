# FLOWGRAPH REAL RUNTIME V1 — RELEASE REPORT

Status as of 2026-09-03 04:39 (+07:00).

This report is evidence-backed: every "live" line cites a captured, sanitized file in
`flowgraph-extension/evidence/flowgraph_v1/`. No claim here is based on mock-only
passes, and no success is reported without a real artifact.

---

## Automated

- Tests: **49 / 49 PASS** (8 / 8 files) — `vitest run --run`
  - `FlowPayloads` 12, `GraphValidator` 7, `GraphPlanner` 5, `CacheStore` 5,
    `WorkflowRuntime` 8, `PollManager` 4, `RuntimeError` 4, `RuntimeValue` 4.
- TypeScript: **0 errors** (`tsc -b` clean, part of production build).
- Build: **PASS** (`npm run build`).
  - `dist/assets/studio-CsIUHJAG.js` = **324.84 kB** (gzip **88.97 kB**)
  - `service-worker.js` + `flow-content-script.js` rebuilt via `build:bridge`.

---

## Account / Flow

- Account: **CONNECTED** — `<REDACTED_EMAIL>` (display name "Môn Digital Qua"),
  session expires `2026-09-03T13:42:22.000Z`.
  - Evidence: `evidence/flowgraph_v1/account/account_live_2026-09-02T20-15-26Z.json`
    (`sanitized: true`, `secretsPresent: false`).
- Flow: **READY** — tab `https://labs.google/fx/vi/tools/flow/project/23e7d6d8-d0bc-441b-b720-e63b0ffa9d32`,
  title "Google Flow - FlowGraph V1 Live 2026-09-02".
- Project: **23e7d6d8-d0bc-441b-b720-e63b0ffa9d32** ("FlowGraph V1 Live 2026-09-02"),
  created via the live bridge and selectable in the real project list.
  - Evidence: `evidence/flowgraph_v1/projects/project_list_bridge_2026-09-02T20-54-49-209Z.json`
    (production transport Studio -> `chrome.runtime.sendMessage` -> service-worker; HTTP 200,
    20 projects, target project present, `noSecrets: true`).
    Earlier request-shape capture: `evidence/flowgraph_v1/projects/project_list_request_shape.json`.
- Canvas Gate: **UNLOCK** (live) — `locked: false`, `gateText: null`, `runDisabled: false`,
  with `activeProject` synced to the Flow tab's `projectId`.
  - Evidence: `evidence/flowgraph_v1/projects/project_gate_live_2026-09-02T20-01-03-955Z.json`
    and reload variant `project_gate_live_reload_2026-09-02T20-02-16-550Z.json`.
  - Note: project-gate fix lives in `src/ui/studio/useStudioConnection.ts`
    (`refreshAccount()` syncs `activeProject` from `liveFlow.projectId`). Do not revert.
- **Live reactivity (fail-closed) verified.** The service worker now derives a definitive gate
  state from the real tab URL (`projectIdFromUrl`) when the content-script relay is still warming
  up after a navigation, and the Studio `FLOWGRAPH_EVENT` listener re-reads the live account state
  so a stale `ERROR` pill clears as soon as the bridge recovers. Navigating the Flow tab to home
  locks the canvas (`gate=True`, `runDisabled=True`, pill `warn`) within ~1s and navigating back to
  the project unlocks it (`gate=False`, `runDisabled=False`, pill `online`) within ~1s — no reload,
  no 120s poll, no forced unlock.
  - Evidence: `evidence/flowgraph_v1/projects/project_gate_live_reactivity_2026-09-02T21-35-38-062Z.json`,
    `project_gate_live_reactivity_2026-09-02T21-36-13-566Z.json`,
    `project_gate_live_reactivity_2026-09-02T21-52-54-889Z.json` (fresh re-probe after rebuild).
  - Fix files: `src/background/service-worker.ts` (`projectIdFromUrl`, `pingFlowTab` catch
    fallback) and `src/ui/studio/useStudioConnection.ts` (`FLOWGRAPH_EVENT` listener calls
    `refreshAccount()`).

---

## T2I

- Prompt inserted: **YES** — `Input.insertText` into the Slate `[contenteditable]` editor; a real
  generation cannot occur without the prompt landing in the editor.
- Generate clicked: **YES** — the production path sends `Input.dispatchMouseEvent`
  (pressed + released) at the center of the `button > i.google-symbols[textContent="arrow_forward"]`
  (generate arrow) and never force-enables or un-disables the button. Runs 1–4 producing real
  media is the proof the click landed. The earlier bug (prompt typed, generate arrow never clicked)
  was fixed and is not reverted.
- Live mediaId (Run 4): **`ff49d846-c300-404f-a2d2-adddc9c31b83`** (`image/jpeg`).
- Preview: **rendered `<img>`** via `media.getMediaUrlRedirect?...=ff49d846...`
  (`naturalWidth 1376`, `naturalHeight 768`).
- Result: **SUCCESS** — T2I node status `success`, downstream continued.
  - Evidence: `t2i/run1_20260903_012408.json`, `t2i/run2_20260903_013803.json`,
    `t2i/run3_20260903_013938.json`, `t2i/run4_20260903_021704.json`.
  - Historical 403 `PUBLIC_ERROR_UNUSUAL_ACTIVITY` / `reCAPTCHA evaluation failed` is preserved as
    `t2i/t2i_recaptcha_failure_evidence.json` (`fakeSuccessEmitted: false`) — it documents why the
    direct provider path is not the production path; it is not a success claim.

---

## I2V

- Upstream T2I mediaId: **exact match** — I2V is fail-closed on the upstream `startImage.mediaId`.
  - Run 4 upstream = `ff49d846-c300-404f-a2d2-adddc9c31b83` (the exact T2I output).
- Selected exact upstream media: **YES** — the UI automation locates the media element whose
  URL / `data-media-id` contains exactly the upstream ID, selects it, then generates. If the exact
  ID is not found it returns an error (no "last image" fallback, no random state selection).
- Video mediaId (Run 4): **`31e26cf9-dbf3-4538-ad96-acb39a8f4f94`** (`video/mp4`),
  upstream = `ff49d846...`.
- Preview: **rendered `<video>`** via `media.getMediaUrlRedirect?...=31e26cf9...`.
- Result: **SUCCESS** — I2V node status `success`.
  - Evidence: `i2v/run1_20260903_012408.json`, `i2v/run2_20260903_013803.json`,
    `i2v/run3_20260903_013938.json`, `i2v/run4_20260903_021704.json`.

---

## Download

- Download ID: **2** (Run 1), **3** (Run 2), **4** (Run 3); Run 4 uses the same Chrome download bridge.
- Artifact: `flowgraph-output (3).mp4` (Run 4), **2,355,932** bytes, `video/mp4`.
  - Referenced from `~\Downloads\flowgraph-output (3).mp4`.
- Result: **SUCCESS** — download node resolves the exact I2V `mediaId` and only reports success
  once the download starts/completes.
  - Evidence: `download/run1_20260903_012408.json`, `download/run2_20260903_013803.json`,
    `download/run3_20260903_013938.json`, `download/run4_20260903_021704.json`.

---

## E2E

Real chain `Prompt -> T2I -> I2V -> Download`, on the live Google Flow session (project
`23e7d6d8...`):

- **Run 1** — SUCCESS. T2I `169262ae...` -> I2V `d7037bf3...` (upstream exact) -> download
  `flowgraph-output.mp4` (2,480,531 B, downloadId 2).
  `e2e/run1_20260903_012359.json`
- **Run 2** — SUCCESS. T2I `ad357851...` -> I2V `de94329e...` (upstream exact) -> download
  `flowgraph-output (1).mp4` (2,045,762 B, downloadId 3).
  `e2e/run2_20260903_013803.json`
- **Run 3** — SUCCESS. T2I `fa406712...` -> I2V `290f881c...` (upstream exact) -> download
  `flowgraph-output (2).mp4` (2,868,029 B, downloadId 4).
  `e2e/run3_20260903_013938.json`
- **Run 4** — SUCCESS (includes node-card preview render proof). T2I `ff49d846...` -> I2V
  `31e26cf9...` (upstream exact) -> download `flowgraph-output (3).mp4` (2,355,932 B).
  `e2e/run4_20260903_021704.json`, `e2e/run4_preview_render.png`
- **Save / Reload / Restore** — SUCCESS (two passes):
  `e2e/save_reload_restore_2026-09-02T20-05-38-766Z.json`,
  `e2e/save_reload_restore_2026-09-02T20-15-26-857Z.json`,
  `e2e/save_reload_restore_2026-09-02T20-40-52-119Z.json` (three passes; latest with non-null
  `runtimeResults`).
  After `Save`, schema v3 workflow `FlowGraph V1 Pipeline` persists 4 nodes / 3 edges,
  `projectBinding` `23e7d6d8...`, and the restored Studio reload rehydrates `runtimeResults`
  (media ID + metadata only; no signed URLs, no secrets).

Run count: **4 consecutive live successes**, exceeding the "2–3 successful runs" release bar.

---

## Security

- No CAPTCHA bypass: **TRUE** — no spoofed user activation, no injected/faked reCAPTCHA token,
  no anti-bot override. CAPTCHA/security challenge surfaces as `CAPTCHA_REQUIRED` / provider error
  (see `t2i_recaptcha_failure_evidence.json`).
- No token leak: **TRUE** — no `Authorization`, `access_token`, or reCAPTCHA token is written to
  evidence; account evidence has `secretsPresent: false`; project list has `noSecrets: true`.
- No cookie leak: **TRUE** — no cookie is copied to evidence or UI; the UI adapter is sanitized
  and the service worker never forwards raw credentials to React.
- No fake success: **TRUE** — the historical reCAPTCHA rejection was recorded as a real
  `PROVIDER_ERROR` (`fakeSuccessEmitted: false`); the capability matrix has no fake-success entry;
  `UNSUPPORTED_NODE` blocks unsupported kinds before any provider call.

---

## Evidence

All under `flowgraph-extension/evidence/flowgraph_v1/`:

- `account/account_live_2026-09-02T20-15-26Z.json`
- `projects/project_gate_live_2026-09-02T20-01-03-955Z.json`
- `projects/project_gate_live_reload_2026-09-02T20-02-16-550Z.json`
- `projects/project_gate_live_reactivity_2026-09-02T21-35-38-062Z.json`
- `projects/project_gate_live_reactivity_2026-09-02T21-36-13-566Z.json`
- `projects/project_gate_live_reactivity_2026-09-02T21-52-54-889Z.json`
- `projects/project_list_live.json`
- `projects/project_list_request_shape.json`
- `projects/project_list_bridge_2026-09-02T20-54-49-209Z.json`
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

---

## Remaining blockers / honest limits

- **Fresh cold-session E2E is NOT fully verified.** A truly cold profile was launched (port 9226)
  and probed: no auth token (`hasAccessToken: false`, `user: null`) and the extension did not load
  (only the built-in extension appeared); the content script was not injected. A first-run cold E2E
  legitimately stops at manual login + extension load. This boundary is not automated, and token /
  cookie / password automation is out of scope by policy.
- **Credit actual delta is NOT live-verified.** `creditsUsed 0` is not a trustworthy credit metric;
  there is no reliable live credits fixture. FG-1504 `Verify credits if measurable` remains
  unchecked.
- **Retry / cancel / error live paths were not re-exercised this pass.** They are covered by
  automated integration tests only; live retry/cancel/error runs were not performed on the live
  session during this pass.
- **Live bridge was re-verified healthy at the end of this pass.** A non-invasive
  `probe_project_list_live.mjs` (Studio page -> `chrome.runtime.sendMessage` -> service-worker)
  returned `FLOWGRAPH_PROJECT_LIST` HTTP 200 with 20 projects, `FLOWGRAPH_ACCOUNT_STATUS`
  CONNECTED, and `FLOWGRAPH_FLOW_STATUS` READY on project `23e7d6d8...`. This supersedes the earlier
  transient SW/Flow-tab disconnect note; no evidence is invalidated.

These items are follow-up / hardening work, not failures of the core `Prompt -> T2I -> I2V ->
Download` runtime, which has four consecutive live successes.

---

## Final Verdict

**READY** for FLOWGRAPH Real Runtime V1.

The core real pipeline (`Prompt -> Text-to-Image -> Image-to-Video -> Download`) has **4 consecutive
live successes** on a real Google Flow session, with:

- real account / flow / project / canvas gate (project gate unlocked);
- real up-to-`arrow_forward` click and inserted prompt (no force-enable, no direct provider path);
- exact upstream T2I → I2V media binding (fail-closed), real video `mediaId`;
- real Chrome download artifact with bytes;
- save / reload / restore rehydrating `runtimeResults` on a schema-v3 workflow;
- no CAPTCHA bypass, no token/cookie leak, no fake success.

Release caveats carried forward (documented above, not blocking the V1 gate): fresh cold-session
full E2E, live credit-delta verification, and live retry/cancel/error runs.
