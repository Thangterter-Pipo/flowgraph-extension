# FLOWGRAPH REAL RUNTIME V1 — CURRENT AUDIT

## 1. Baseline
- Tests: 49 passed (49/49 across 8 test files)
- Build: PASS (`npm run build` succeeded)
- TypeScript: PASS (0 errors via `tsc -b`)
- Bundle: Studio JS: 323.74 kB (gzip: 88.59 kB), Theme CSS: 93.81 kB (gzip: 18.66 kB), Studio CSS: 15.87 kB, Sidepanel JS: 17.22 kB

## 2. M1 Project Ready
- Account: CONTRACT_VERIFIED (Code + unit tests PASS; live evidence file in `flowgraph_v1/account` is MISSING)
- Flow: CONTRACT_VERIFIED (Code + unit tests PASS; live evidence file in `flowgraph_v1/account` is MISSING)
- Credits: CONTRACT_VERIFIED (Code PASS; live evidence file is MISSING)
- List Project: CONTRACT_VERIFIED (Code + unit tests PASS; live evidence file in `flowgraph_v1/projects` is MISSING)
- Create Project: TASKLIST CLAIM WITHOUT CURRENT EVIDENCE (`FLOWGRAPH_REAL_RUNTIME_TASKLIST.md` claims project `9125da34-52c4-4f38-a8cc-7d6e1bb31483` created, but no evidence file exists in `flowgraph_v1/projects`)
- Select Project: CONTRACT_VERIFIED (Code PASS; live evidence file is MISSING)
- Canvas Gate: VERIFIED via CDP UI smoke test, but no live extension run evidence file in `flowgraph_v1`

## 3. M2 Runtime Core
- Validator: PASS (`GraphValidator.test.ts` 7 tests pass)
- Planner: PASS (`GraphPlanner.test.ts` 5 tests pass)
- Runtime: PASS (`WorkflowRuntime.test.ts` 8 tests pass)
- Retry: PASS (`WorkflowRuntime.test.ts` retry tests pass)
- Cancel: PASS (`WorkflowRuntime.test.ts` & `PollManager.test.ts` cancel tests pass)
- Cache: PASS (`CacheStore.test.ts` 5 tests pass)
- Concurrency: PASS (`WorkflowRuntime.test.ts` concurrency=2 tests pass)
- Polling: PASS (`PollManager.test.ts` 4 tests pass)
- Error mapping: PASS (`RuntimeError.test.ts` 4 tests pass)

## 4. M3 T2I Live
- Live success: NO
- Latest evidence: `evidence/flowgraph_v1/t2i/t2i_recaptcha_failure_evidence.json` (2026-09-01T14:11:57.175Z)
- Latest error: `PROVIDER_ERROR` — `reCAPTCHA evaluation failed` (HTTP 403 `PUBLIC_ERROR_UNUSUAL_ACTIVITY`)
- Root cause: Token reCAPTCHA Enterprise sinh từ `grecaptcha.enterprise.execute` trong `MAIN` world bị backend Google AI Sandbox (`aisandbox-pa.googleapis.com`) từ chối khi gọi API `batchGenerateImages` trực tiếp từ Extension Service Worker. Fake success KHÔNG xảy ra (`fakeSuccessEmitted: false`), downstream nodes bị skip đúng logic (`downstreamNodesSkipped: ["3", "4"]`).

## 5. M4 I2V Live
- Live success: NO
- Blocker: BLOCKED BY T2I (T2I chưa PASS live trong Extension Runtime)

## 6. M5 Download / E2E
- Download success: NO (Code bridge + unit tests pass, nhưng chưa có live media download từ runtime success run)
- Full pipeline: NO
- Number of successful E2E runs: 0

## 7. reCAPTCHA
- MAIN world patch: YES (`world: 'MAIN'` is present in `service-worker.ts` line 245 for `chrome.scripting.executeScript`)
- grecaptcha available: YES (executes `grecaptcha.enterprise.execute` on the Google Flow page)
- current action: `FLOW_GENERATE`
- action runtime verified: RECAPTCHA ACTION NOT RUNTIME VERIFIED (Chưa có bằng chứng live chứng minh action `FLOW_GENERATE` vượt được backend evaluation 403 khi gọi API trực tiếp)
- backend status: HTTP 403 `reCAPTCHA evaluation failed` (`PUBLIC_ERROR_UNUSUAL_ACTIVITY`)

## 8. Session / Chrome
- Active test profile: None active (CDP port 9222 is closed)
- Authenticated: false (no active browser session connected right now)
- Flow project opened: false
- Extension SW active: false

## 9. Evidence
- In `flowgraph-extension/evidence/flowgraph_v1/`:
  - `t2i/t2i_recaptcha_failure_evidence.json` (FAILURE EVIDENCE)
  - `account/` (EMPTY)
  - `projects/` (EMPTY)
  - `i2v/` (EMPTY)
  - `download/` (EMPTY)
  - `e2e/` (EMPTY)
- Historical SDK/CDP Fixtures in root `evidence/` (from Aug 2026 CDP Automation, not extension runtime):
  - `image/t2i/t2i_verified_b5cbf3fc-f059-4f58-9c6f-64294a2c64e4.jpg` (SUCCESS - CDP Automation)
  - `download/verified_fox_video.mp4` (SUCCESS - CDP Automation)
  - `download/i2v_verified_cd2ef7e8-606b-47a7-89b2-681117c0451d.mp4` (SUCCESS - CDP Automation)
  - `download/interpolation_verified_d6e527a8-2089-4b2c-8e88-c7a26bd4a764.mp4` (SUCCESS - CDP Automation)
  - `download/extend_verified_9f714655-adcc-4c67-adb6-ad7847c4d49b.mp4` (SUCCESS - CDP Automation)
  - `video/reference/reference_verified_1d2d1e90-a4be-4b6a-82b3-f691e787632e.mp4` (SUCCESS - CDP Automation)

## 10. Capability Mismatches
- `t2i`: MATRIX says `CONTRACT_VERIFIED`, Evidence in `flowgraph_v1/t2i` says `LIVE FAIL` (`reCAPTCHA evaluation failed`).
- `i2v`: MATRIX says `CONTRACT_VERIFIED`, Evidence in `flowgraph_v1/i2v` is `EMPTY`.
- `download`: MATRIX says `CONTRACT_VERIFIED`, Evidence in `flowgraph_v1/download` is `EMPTY`.
- `createProject`: TASKLIST claim `[x]` with project ID `9125da34-52c4-4f38-a8cc-7d6e1bb31483`, but no evidence JSON file exists in `flowgraph_v1/projects/`.

## 11. Remaining Blockers
1. **reCAPTCHA Enterprise Evaluation Error (HTTP 403)**: Token sinh từ `grecaptcha.enterprise.execute` trong `MAIN` world bị backend `aisandbox-pa.googleapis.com` từ chối với lỗi `PUBLIC_ERROR_UNUSUAL_ACTIVITY` khi Extension Service Worker gửi request API `flowMedia:batchGenerateImages`.
2. **Thiếu Live Success Evidence cho Extension Runtime V1**: Chưa có file evidence thành công nào lưu trong `flowgraph-extension/evidence/flowgraph_v1/` cho các bước Account, Project, T2I, I2V, Download.

## 12. Progress Estimate
- M1: 70% (Code & contract tests PASS, CDP smoke PASS, thiếu live evidence JSON files)
- M2: 100% (Core engine, validator, planner, runtime, retry, cancel, cache, concurrency, error mapping fully tested & 49/49 unit tests PASS)
- M3: 30% (Executor code & contract tests PASS, nhưng Live T2I FAIL do 403 reCAPTCHA)
- M4: 10% (BLOCKED BY T2I)
- M5: 10% (BLOCKED BY T2I & I2V)
- Real Runtime V1 overall: ~40%

## 13. Final Verdict
**BLOCKED**

1. Backend reCAPTCHA evaluation failed (HTTP 403 `PUBLIC_ERROR_UNUSUAL_ACTIVITY`) trên endpoint `flowMedia:batchGenerateImages` khi Extension Service Worker gọi API trực tiếp.
2. Chưa có bất kỳ Live Success Evidence nào cho T2I, I2V hay Download trong `flowgraph-extension/evidence/flowgraph_v1`.
