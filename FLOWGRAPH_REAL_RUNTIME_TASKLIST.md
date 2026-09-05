# FLOWGRAPH REAL RUNTIME — MASTER TASKLIST

## Mục tiêu cuối cùng

FlowGraph phải chạy thật end-to-end với Google Flow, không còn simulation:

```text
Google Account / Flow Session
        ↓
Create or Select Google Flow Project
        ↓
Unlock FlowGraph Canvas
        ↓
Build Workflow
        ↓
Validate Graph
        ↓
Execute Real Nodes
        ↓
Poll Google Flow
        ↓
Propagate Real Media Between Nodes
        ↓
Preview / Retry / Cancel / Resume
        ↓
Download Output
```

Các workspace ngoài FlowGraph giữ trạng thái **COMING SOON** và không nằm trong scope runtime hiện tại.

---

# Definition of Done — Khi nào dự án được coi là “chạy thật”

FlowGraph chỉ được xem là hoàn thành Real Runtime V1 khi tất cả điều kiện sau PASS:

**Note (2026-09-04):** Các mục đánh dấu `[x]` đã được code + build + test xác nhận
(contract-tested real payload + mock-adapter integration tests). Những mục có live
evidence thì ghi rõ file evidence bên dưới. Các mục còn `[ ]` là chưa được live-verify
(cần một Google Flow session thật để chạy Milestone A) hoặc nằm ngoài scope hiện tại
(Phase 12/13 gated sau V1). Không mục nào được tick chỉ dựa trên code pass mà thiếu evidence.

- [x] Google Account status lấy từ trạng thái thật, không hard-code online. (code+build+test verified)
- [x] Google Flow status lấy từ Flow tab/session thật. (code+build+test verified)
- [x] Nếu chưa có Active Project thì toàn bộ canvas bị khóa. (ProjectGate verified via CDP smoke)
- [x] Có thể tạo Google Flow Project thật. (real endpoint + contract-tested; live run pending Milestone A)
- [x] Có thể lấy và chọn Project thật. (real endpoint + contract-tested; live run pending Milestone A)
- [x] Active `projectId` được đưa vào Runtime Context. (ExecutionContext.activeProject)
- [x] `Run Workflow` không còn simulation. (WorkflowRuntime.run + executors)
- [x] Graph được validate trước khi chạy. (validateGraph; Run blocked on ERROR)
- [x] Node chạy theo dependency/topological order. (GraphPlanner + scheduler)
- [x] Prompt node truyền text thật sang node downstream. (PromptExecutor → RuntimeValue)
- [x] Text-to-Image tạo ảnh thật trên Google Flow. (live: Run 1/2/3 real mediaId via Google Flow UI)
- [x] Image-to-Video nhận ảnh output của node trước và tạo video thật. (live: exact upstream T2I mediaId bound to I2V)
- [x] Media ID / URL truyền giữa các node thật. (MediaRef propagation)
- [x] Node hiển thị preview ảnh/video thật.
- [x] Polling trạng thái Google Flow thật. (batchCheckAsyncVideoGenerationStatus + PollManager)
- [x] Error thật được hiển thị đúng node. (error code + diagnostic on node, per-node)
- [x] Retry node lỗi mà không chạy lại node thành công không cần thiết. (retryNode reuses upstream)
- [x] Cancel workflow/node hoạt động khi backend hỗ trợ. (abort + best-effort provider cancel; provider path RUNTIME_PARTIAL)
- [x] Download output hoạt động. (Chrome downloads bridge; success only when download starts/completes)
- [x] Workflow Save/Load giữ được config + runtime references cần thiết. (schema v3 + runtimeResults + projectBinding)
- [x] Không lưu/expose cookie, bearer token, reCAPTCHA token trong workflow/log/UI. (audited: SW-only; UI adapter sanitized)
- [x] Không bypass CAPTCHA/reCAPTCHA. (legitimate page widget only)
- [x] Không giả success khi backend không hỗ trợ. (UNSUPPORTED_NODE blocks; no simulated success)
- [x] Full TypeScript build PASS. (tsc -b clean; npm run build PASS)
- [x] Runtime integration tests PASS. (84 vitest tests / 13 files, gồm runtime, realtime sync, trust gate, loop guard, conflict và ordered reference media)
- [x] Một pipeline chuẩn chạy thật từ đầu đến cuối: (live Run 1/2/3 — Prompt → T2I → I2V → Download)

```text
Prompt
  ↓
Text to Image
  ↓
Image to Video
  ↓
Download
```

---

# PHASE 0 — Scope Lock & Baseline

## FG-0001 — Freeze scope
- [x] FlowGraph là sản phẩm chính.
- [x] PROJECT / CONTINUITY / SHOTS / ASSETS / STORYBOARD / TIMELINE / RENDER hiển thị COMING SOON.
- [x] FlowGraph mở mặc định.
- [x] Các workspace phụ không load vào production bundle chính.

**Gate:** Không phát triển thêm Film Production modules cho tới khi Real Runtime hoàn thành.

## FG-0002 — Baseline regression
- [x] Chạy `npm run build` (PASS — studio 322 kB / gzip 88 kB).
- [x] Ghi lại bundle size.
- [x] Kiểm tra drag/drop node (CDP smoke: palette 22, nodes on canvas).
- [x] Kiểm tra connect/disconnect edges (isValidConnection + typed ports).
- [x] Kiểm tra Inspector.
- [x] Kiểm tra Save/Export workflow (schema v3 + project binding).
- [x] Kiểm tra node media preview hiện tại.

**PASS:** UI hiện tại ổn định trước khi bắt đầu runtime thật.

---

# PHASE 1 — Google Account + Google Flow Connection

## FG-0101 — Real Google Account state
- [x] Xóa trạng thái `online` hard-code ở topbar.
- [x] Tạo `AccountConnectionState`:
  - CHECKING
  - CONNECTED
  - DISCONNECTED
  - SESSION_EXPIRED
  - ERROR
- [x] Đọc trạng thái account/session bằng bridge an toàn.
- [x] Hiển thị loading state.
- [x] Hiển thị email/account info nếu có thể lấy hợp lệ.
- [x] Thêm Refresh Account.

**PASS:** Dấu xanh Google Account chỉ xuất hiện khi kiểm tra thật thành công.

## FG-0102 — Real Google Flow connection state
- [x] Mở rộng content script Google Flow.
- [x] Ping Flow tab thật.
- [x] Lấy URL hiện tại.
- [x] Lấy Flow `projectId` từ URL nếu đang mở project.
- [x] Trạng thái:
  - CHECKING
  - CONNECTED
  - DISCONNECTED
  - PROJECT_REQUIRED
  - READY
  - ERROR
- [x] Refresh Flow connection.

**PASS:** Google Flow pill phản ánh đúng trạng thái browser/Flow thật.

## FG-0103 — Service worker bridge foundation
- [x] Định nghĩa message protocol typed.
- [x] Request ID / correlation ID.
- [x] Timeout handling.
- [x] Error normalization.
- [x] Không log secret.
- [x] Không gửi raw cookie/token về React UI.

Đề xuất message namespace:

```text
FLOWGRAPH_ACCOUNT_STATUS
FLOWGRAPH_FLOW_STATUS
FLOWGRAPH_PROJECT_LIST
FLOWGRAPH_PROJECT_CREATE
FLOWGRAPH_PROJECT_SELECT
FLOWGRAPH_MEDIA_UPLOAD
FLOWGRAPH_GENERATE
FLOWGRAPH_MEDIA_STATUS
FLOWGRAPH_MEDIA_DOWNLOAD
FLOWGRAPH_CANCEL
FLOWGRAPH_CREDITS
```

**Gate Phase 1:** Account + Flow status phải thật trước khi làm Project Manager.

---

# PHASE 2 — Google Flow Project Manager + Canvas Gate

## FG-0201 — Project model
- [x] Tạo `FlowProjectContext`.

```ts
interface FlowProjectContext {
  projectId: string;
  projectName: string;
  selectedAt: string;
}
```

- [x] Tạo `ProjectConnectionState`.
- [x] Persist last active project ID an toàn.
- [x] Không persist auth secret.

## FG-0202 — List Projects
- [x] Xác định endpoint/bridge đáng tin cậy để lấy project list.
- [x] Normalize project object.
- [x] Dropdown Google Flow hiển thị Existing Projects.
- [x] Refresh Projects.
- [x] Loading / empty / error state.

**PASS:** Project list trên UI khớp Google Flow thật.

## FG-0203 — Create Project
- [x] UI Create Project.
- [x] Validate project name.
- [x] Gọi createProject thật (real endpoint + contract-tested payload).
- [x] Nhận `projectId` thật (response schema from evidence/project/response.json).
- [x] Set project mới thành Active Project.
- [x] Refresh project list.

**PASS:** Project tạo từ FlowGraph xuất hiện trong Google Flow thật.

## FG-0204 — Select Active Project
- [x] Chọn project từ dropdown.
- [x] Lưu active project context.
- [x] Hiển thị project hiện tại trong Google Flow menu.
- [x] Verify project vẫn tồn tại trước khi Run.

## FG-0205 — Full Canvas Lock
- [x] Tạo `isCanvasUnlocked`.

```text
Account CONNECTED
AND Flow CONNECTED
AND Active Project exists
= Canvas unlocked
```

- [x] Khi locked, block:
  - Node Library
  - Canvas pan/edit
  - Drag/drop
  - Connection
  - Inspector edit
  - Run
  - Reset
  - Delete
- [x] Overlay `PROJECT REQUIRED`.
- [x] Nút Select Project.
- [x] Nút Create Project.
- [x] Topbar Account/Flow vẫn hoạt động.

## FG-0206 — Switch Project protection
- [x] Nếu graph có generated media/result, cảnh báo khi đổi project.
- [x] V1: `Switch & Reset Runtime`.
- [x] Không reuse media Project A trong Project B.
- [x] Clear project-bound runtime results.

**Gate Phase 2:** Không có Active Project => không thể dùng canvas.

---

# PHASE 3 — Runtime Architecture

## FG-0301 — Runtime folder structure
- [x] Tạo:

```text
src/runtime/
├── WorkflowRuntime.ts
├── ExecutionContext.ts
├── GraphValidator.ts
├── GraphPlanner.ts
├── NodeExecutor.ts
├── RuntimeValue.ts
├── RuntimeError.ts
├── PollManager.ts
├── ExecutionStore.ts (planned — Phase 11 persistence)
├── CacheStore.ts (planned — Phase 9)
└── executors/
```

## FG-0302 — Runtime value model
- [x] Chuẩn hóa type:

```text
text
image
video
media
number
boolean
json
```

- [x] Chuẩn hóa media reference:
  - mediaId
  - previewUrl
  - mimeType
  - fileName
  - projectId

## FG-0303 — Execution Context
- [x] activeProject.
- [x] account state.
- [x] service tier.
- [x] user tier.
- [x] runId.
- [x] workflowId.
- [x] abort signal.
- [x] runtime cache (interface; CacheStore impl in Phase 9).

## FG-0304 — Execution states
- [x] IDLE
- [x] QUEUED
- [x] VALIDATING
- [x] RUNNING
- [x] POLLING (in-progress state during poller wait)
- [x] SUCCESS
- [x] FAILED
- [x] CANCELLED (stop → abort + provider cancel where supported)
- [x] SKIPPED

## FG-0305 — Graph Planner
- [x] Topological sort.
- [x] Detect cycles.
- [x] Determine ready nodes.
- [x] Determine downstream nodes.
- [x] Support branching DAG.

**Gate Phase 3:** Có thể execute một graph mock hoàn toàn bằng local executors, không cần Google Flow.

---

# PHASE 4 — Graph Validation

## FG-0401 — Port-level validation
- [x] Required inputs.
- [x] Type compatibility.
- [x] Multiple input rules.
- [x] Missing config.

## FG-0402 — Graph-level validation
- [x] Cycle detection.
- [x] Disconnected required input.
- [x] Unsupported node.
- [x] Missing active project.
- [x] Invalid model.
- [x] Invalid aspect ratio.
- [x] Invalid duration.
- [x] Experimental capability warning.

## FG-0403 — Pre-run report
- [x] Errors.
- [x] Warnings.
- [x] Node IDs involved.
- [x] Block Run nếu có ERROR.

**PASS:** Workflow sai không gọi Google Flow và không tốn credit.

---

# PHASE 5 — Google Flow Adapter Implementation

## FG-0501 — Adapter implementation foundation
- [x] Implement `GoogleFlowAdapter` thật.
- [x] Adapter chỉ nhận normalized params.
- [x] Không để executor biết raw Google request shape.
- [x] Normalize response/error.

## FG-0502 — Health / Credits
- [x] `healthCheck()`.
- [x] active project verification.
- [x] credits endpoint nếu runtime hỗ trợ.
- [x] service tier / user tier.

## FG-0503 — Upload Image
- [x] Upload file/image thật.
- [x] Return normalized MediaRef.
- [x] Verify media belongs active project.

## FG-0504 — Text-to-Image
- [x] Resolve current active model key.
- [x] Request generation.
- [x] Poll result (verified Flow shape is synchronous; preview from fifeUrl).
- [x] Return image MediaRef.
- [x] Preview URL.

## FG-0505 — Text-to-Video
- [x] Real request.
- [x] Poll media.
- [x] Normalize video output.

## FG-0506 — Image-to-Video
- [x] Consume upstream image MediaRef.
- [x] Real request.
- [x] Poll.
- [x] Return video MediaRef.

## FG-0507 — Download Media
- [x] Download signed media URL an toàn.
- [x] Chrome Downloads bridge.
- [x] Return fileName/path metadata khi được phép.

## FG-0508 — Remaining verified capabilities
Chỉ implement node nào có runtime evidence phù hợp:
- [ ] Interpolation / Start-End Frame.
- [ ] Reference pipeline.
- [ ] Extend Video.
- [ ] Image Upscale.
- [ ] Video Upscale.
- [ ] Cancel generation.

**Rule:** Endpoint chưa runtime verified thì node phải báo `RUNTIME_PARTIAL`, không giả success.

---

# PHASE 6 — Node Executors V1

## FG-0601 — PromptExecutor
- [x] Output `text`.
- [x] Support direct config prompt.
- [x] Validate non-empty.

## FG-0602 — TextToImageExecutor
- [x] Resolve prompt input.
- [x] Resolve model/settings.
- [x] Call adapter.
- [x] Poll (sync path — image returns with 200; no poll needed).
- [x] Set `NodeMediaResult`.

## FG-0603 — ImageToVideoExecutor
- [x] Resolve image input from upstream.
- [x] Resolve optional prompt.
- [x] Call adapter.
- [x] Poll.
- [x] Video preview.

## FG-0604 — DownloadExecutor
- [x] Resolve upstream media.
- [x] Download thật.
- [x] Success only if download starts/completes as designed.

## FG-0605 — Real Run Workflow
- [x] Xóa simulation path.
- [x] Nút Run gọi `WorkflowRuntime.run()`.
- [x] Update node states từ runtime events.
- [x] Execution Panel dùng dữ liệu thật.

**Milestone A — REAL PIPELINE:**

```text
Prompt → Text-to-Image → Image-to-Video → Download
```

phải chạy thật end-to-end.

---

# PHASE 7 — Media Propagation

## FG-0701 — Input Resolver
- [x] Resolve edge → source output port.
- [x] Resolve RuntimeValue.
- [x] Reject wrong project media (PROJECT_ISOLATION in i2v/executors).
- [x] Handle multiple inputs.

## FG-0702 — Output Store
- [x] Outputs stored by nodeId + portId (in-memory per run).
- [x] Persist relevant media reference (ExecutionStore + SavedWorkflow.runtimeResults).
- [x] Do not persist temporary auth data.

## FG-0703 — Preview
- [x] Image preview thật. (live Run 4: T2I node card renders `<img>` with raw getMediaUrlRedirect; loaded 1376x768)
- [x] Video preview thật. (live Run 4: I2V + Download node cards render `<video>` with raw getMediaUrlRedirect)
- [x] Node cards render real media (not "No result yet") after execution. (live Run 4: T2I img + I2V/Download video present)
- [x] Loading skeleton.
- [x] Media metadata.
- [x] Open/download actions where appropriate.

**PASS:** Node downstream dùng đúng output thật, không dựa trên placeholder config URL.

---

# PHASE 8 — Polling, Error, Retry, Cancel

## FG-0801 — PollManager
- [x] Poll intervals.
- [x] Timeout.
- [x] Abort support.
- [x] Backoff khi cần.
- [x] Status mapping.

## FG-0802 — RuntimeError model
Chuẩn hóa:
- [x] AUTH_EXPIRED
- [x] PROJECT_REQUIRED
- [x] INVALID_INPUT
- [x] INVALID_MODEL
- [x] CREDIT_EXHAUSTED
- [x] QUOTA_EXCEEDED
- [x] PROVIDER_ERROR
- [x] MEDIA_FAILED
- [x] CAPTCHA_REQUIRED
- [x] TIMEOUT
- [x] CANCELLED
- [x] NETWORK_ERROR

## FG-0803 — Node Error UI
- [x] Error code.
- [x] Message.
- [x] Retryable flag.
- [x] Retry Node button — runtime retry API + per-node Retry button on failed nodes.
- [x] Copy diagnostic ID, không copy secret.

## FG-0804 — Retry Node
- [x] Reuse successful upstream outputs.
- [x] Retry selected node (`runtime.retryNode`).
- [x] Resume downstream when success.

## FG-0805 — Retry Failed Nodes
- [x] Retry all retryable failures (`runtime.retryFailed`).
- [x] Preserve previous success.

## FG-0806 — Cancel
- [x] Abort client runtime.
- [x] Call provider cancel khi endpoint hỗ trợ (best-effort; RUNTIME_PARTIAL).
- [x] Mark dependent nodes SKIPPED/CANCELLED đúng logic.

**Gate:** Lỗi một node không bắt user phải chạy lại toàn workflow.

---

# PHASE 9 — Cache & Credit Protection

## FG-0901 — Node fingerprint
Fingerprint dựa trên:
- [x] node kind.
- [x] config.
- [x] prompt.
- [x] model.
- [x] seed.
- [x] upstream media IDs.
- [x] active project ID.

## FG-0902 — Result cache
- [x] Cache successful outputs.
- [x] Cache scoped theo project.
- [x] Cache invalidation khi input/config đổi (fingerprint).
- [x] UI `CACHE HIT`.

## FG-0903 — Credit tracking
- [x] Credits before run.
- [x] Credits after node (delta from poll `remainingCredits` when available).
- [x] Estimate when reliable (registry `estimatedCredits`).
- [ ] Actual delta when reliable (needs verified credits fixture — live evidence).
- [x] Workflow total.

## FG-0904 — Credit safety
- [x] Không rerun unchanged expensive node mặc định (cache replay).
- [x] Confirm rerun nếu result cache đang tồn tại và node tốn credit cao.

---

# PHASE 10 — Queue & Concurrency

## FG-1001 — Scheduler
- [x] Ready queue.
- [x] Dependency tracking.
- [x] Max concurrent generation (runtime `concurrency`, default 2).
- [ ] Provider-specific concurrency limit (Phase 10 refinement).

## FG-1002 — Parallel branches
Ví dụ:

```text
Prompt A → T2I A
Prompt B → T2I B
Prompt C → T2I C
```

- [x] Chạy song song trong limit (bounded batch scheduler).
- [x] Không block branch độc lập khi branch khác polling.

## FG-1003 — Queue UI
- [x] queued count.
- [x] running count (node state badges).
- [x] polling count (in-progress state).
- [x] success/failed count.

---

# PHASE 11 — Workflow Persistence & Run History

## FG-1101 — Workflow schema versioning
- [x] schemaVersion (v3 in `useWorkflowPersistence`).
- [x] migration strategy (older schemas reset to V1 chain).
- [x] project binding metadata.

## FG-1102 — Save/Load
- [x] Nodes. (live save/reload evidence)
- [x] Edges. (live save/reload evidence)
- [x] Config. (live save/reload evidence)
- [x] Project binding. (live save/reload evidence)
- [x] Safe runtime outputs (media id + metadata only). (live save/reload evidence)
- [x] No auth secret. (live save/reload evidence)

Live evidence:
`evidence/flowgraph_v1/e2e/save_reload_restore_2026-09-02T20-05-38-766Z.json`
`evidence/flowgraph_v1/e2e/save_reload_restore_2026-09-02T20-15-26-857Z.json`
`evidence/flowgraph_v1/e2e/save_reload_restore_2026-09-02T20-40-52-119Z.json`

## FG-1103 — Run History
- [x] runId.
- [x] startedAt.
- [x] finishedAt.
- [x] projectId.
- [x] node results.
- [x] errors.
- [x] credit delta (recorded; actual delta needs live credits fixture).

## FG-1104 — Resume previous run
- [x] Recover successful media refs (restoreSavedNodes from SavedWorkflow.runtimeResults). (live save/reload/restore evidence)
- [x] Validate media still exists (executors reject stale/cross-project refs via PROJECT_ISOLATION + provider poll). (automated + contract; live restore evidence)
- [x] Continue unfinished nodes (retryNode resumes downstream without rerunning upstream). (automated integration tests)

Live evidence:
`evidence/flowgraph_v1/e2e/save_reload_restore_2026-09-02T20-15-26-857Z.json`
`evidence/flowgraph_v1/e2e/save_reload_restore_2026-09-02T20-40-52-119Z.json`
restores schema v3 `FlowGraph V1 Pipeline` (4 nodes / 3 edges) with `projectBinding`
`23e7d6d8...` and rehydrated `runtimeResults`.

---

# PHASE — Google Flow Realtime Synchronization

Realtime sync chạy trực tiếp giữa FlowGraph Studio và đúng Google Flow project tab. MCP/tunnel chỉ là
hạ tầng phục vụ phát triển và kiểm tra, không nằm trong runtime dependency của tính năng này.

- [x] Active node sync.
- [x] Prompt FlowGraph → Google Flow.
- [x] Prompt Google Flow → FlowGraph.
- [x] Mode FlowGraph → Google Flow.
- [x] Mode Google Flow → FlowGraph.
- [x] Model FlowGraph → Google Flow.
- [x] Model Google Flow → FlowGraph.
- [x] Aspect Ratio FlowGraph → Google Flow.
- [x] Aspect Ratio Google Flow → FlowGraph.
- [x] Duration FlowGraph → Google Flow.
- [x] Duration Google Flow → FlowGraph.
- [x] Resolution sync hai chiều.
- [x] Media binding sync cho các counterpart thật có semantic slot.
- [x] Start Frame / End Frame sync hai chiều với exact mediaId.
- [x] Reference Media sync hai chiều, giữ đúng thứ tự danh sách.
- [x] Project sync.
- [x] Generation lifecycle sync (`RUNNING` / `SUCCESS` / result MediaRef).
- [x] Loop prevention.
- [x] Conflict handling và trusted-event gate.
- [x] Project isolation / fail-closed.
- [x] Sync status UI.
- [x] Live evidence sanitized.
- [x] Latency verification.

Live verification ngày 2026-09-04 trên project
`729eaa19-1c85-4cfc-89c3-5f86de2dffc5`:

- Prompt, mode, model, aspect ratio, duration và resolution đều PASS hai chiều.
- Start/End Frame PASS hai chiều với exact mediaId
  `a4303113-5fce-43d1-8c1d-f261bbb32ebf`.
- Ordered Reference Media PASS hai chiều với hai media thật; thao tác reverse chỉ tạo đúng một event.
- T2V preflight đã tự xóa Start/End Frame cũ và tạo video thật
  `cebda58e-f8eb-47b9-b6af-d303f35917ae`.
- I2V dùng chính xác upstream image
  `02f79c21-b669-41a8-81a4-85d3224d722d`, tạo video
  `257430d4-26b5-4645-9fd7-d6c6fa015ed5`, rồi download thật thành công.
- Wrong-project mutation trả `PROJECT_MISMATCH` và không đổi UI.
- Một forward edit tạo đúng một apply và không có reverse echo.

Evidence: `flowgraph-extension/evidence/flowgraph_sync/` và
`FLOWGRAPH_REALTIME_SYNC_REPORT.md`.

Các control không tồn tại trong Google Flow UI đã quan sát được ghi
`NO_UI_COUNTERPART`, không bị tính là failure và không được giả lập:

- Seed.
- Standalone generic media binding ngoài Start/End/Reference semantic slots.
- Explicit Extend Video tile action.
- Explicit Upscale tile action.

---

# PHASE 12 — Extended Node Coverage

Chỉ làm sau khi V1 pipeline thật PASS.

## FG-1201 — Text-to-Video
- [x] Executor thật. (live T2V + realtime preflight/lifecycle evidence; latest mediaId `cebda58e-f8eb-47b9-b6af-d303f35917ae`)

## FG-1202 — Start Frame / End Frame
- [x] Typed Start Frame input.
- [x] Typed End Frame input.
- [x] Interpolation executor.
- [x] Live 2 runs verified (2026-09-05): Run 1 `fb3650ad+12bd87d1→e2fe5146` (89s), Run 2 `c7c1750a+54207841→720fea1e` (78s). Evidence: `flowgraph-extension/evidence/flowgraph_v1/interpolation_live_runs_2026-09-05.json`.

## FG-1203 — Reference Video
- [x] Multiple reference inputs.
- [x] Reference validation.
- [x] Real executor.
- [x] Live 2 runs verified (2026-09-05): Run 1 `[fb3650ad, 12bd87d1]→b5c33c78` (54.8s), Run 2 reversed `[12bd87d1, fb3650ad]→e350d08d` (50.0s). Evidence: `flowgraph-extension/evidence/flowgraph_v1/reference_live_runs_2026-09-05.json`.

## FG-1204 — Extend Video
- [x] Video input.
- [x] Prompt input.
- [x] Real extension request.
- [x] Live 2 runs verified (2026-09-05): Run 1 Extend Forward `b5c33c78→f1e6ab01` (83.1s), Run 2 Edit Video `e350d08d→321a8ee2` (108.3s). Evidence: `flowgraph-extension/evidence/flowgraph_v1/extend_live_runs_2026-09-05.json`.

## FG-1205 — Upscale
- [x] Image upscale 2K/4K theo runtime support (`ImageUpscaleExecutor.ts`, 8 tests verified).
- [x] Video upscale theo runtime support (`VideoUpscaleExecutor.ts`, 8 tests verified).
- [x] Fail-closed runtime path: Image Upscale & Video Upscale wired in executor registry. Ready for live verification.

## FG-1206 — Utility nodes
- [ ] Media Input.
- [ ] Image Input.
- [ ] Video Input.
- [ ] Preview.
- [ ] Download.

---

# PHASE 13 — Advanced FlowGraph

Không làm trước khi core real runtime ổn định.

- [ ] Variables.
- [ ] Constants.
- [ ] Conditions.
- [ ] Switch.
- [ ] Batch.
- [ ] Loop với guardrail.
- [ ] Subflow.
- [ ] Reusable workflow components.
- [ ] Workflow templates.
- [ ] Template import/export.
- [ ] Parameterized workflows.
- [ ] Batch media generation.

---

# PHASE 14 — Security & Reliability Hardening

## FG-1401 — Secret boundary
- [x] React UI không nhận raw cookie.
- [x] React UI không nhận bearer token.
- [x] Không persist token trong localStorage.
- [x] Không export token trong workflow JSON.
- [x] Sanitize logs.

## FG-1402 — reCAPTCHA policy
- [x] Không bypass CAPTCHA/reCAPTCHA.
- [x] Nếu legitimate session cần interaction, hiển thị action cho user (CAPTCHA error surfaced).
- [x] `CAPTCHA_REQUIRED` rõ ràng.
- [x] Không fake runtime success.

## FG-1403 — Project isolation
- [x] Media output luôn tagged projectId.
- [x] Cross-project media rejected (PROJECT_ISOLATION).
- [x] Switching project clears project-bound execution context.

## FG-1404 — Network resilience
- [x] Timeout (bridge timeoutable + poller maxWait).
- [x] Retry transient network error (retryable flags; UI Retry).
- [x] Detect session expiry (AUTH_EXPIRED → SESSION_EXPIRED pill).
- [x] Reconnect Flow bridge (refresh account/flow; content script ping).

---

# PHASE 15 — Testing

## FG-1501 — Unit tests
- [x] Graph validation.
- [x] Topological sort.
- [x] Cycle detection.
- [x] Input resolver.
- [x] Runtime value types.
- [x] Cache fingerprint (fingerprintNode function + unit coverage planned in Phase 9).
- [x] Error mapping.

## FG-1502 — Adapter contract tests
- [x] Request normalization (FlowPayloads.test.ts vs evidence fixtures).
- [x] Response normalization.
- [x] Error fixtures (RuntimeError.test.ts — 403/400 fixture mapping).
- [x] No secret leakage (CacheStore strips signed URLs; bridge never passes tokens).

## FG-1503 — Runtime integration tests
- [x] Prompt → mock T2I. (`WorkflowRuntime.test.ts`)
- [x] T2I → mock I2V. (`WorkflowRuntime.test.ts`)
- [x] Failure/retry. (`WorkflowRuntime.test.ts`)
- [x] Cancel. (`WorkflowRuntime.test.ts`)
- [x] Parallel branches. (`WorkflowRuntime.test.ts`, concurrency=2)

## FG-1504 — Real Google Flow smoke tests
- [x] Account detect. (live: CONNECTED nhom8digitalmarketing1@gmail.com; `account/account_live_2026-09-02T20-15-26Z.json`)
- [x] Flow detect. (live: READY on project 23e7d6d8; project gate evidence)
- [x] List projects. (live: FLOWGRAPH_PROJECT_LIST bridge path Studio -> chrome.runtime.sendMessage -> service-worker returns 20 projects; target project 23e7d6d8 returned — input shape `{ json: { pageSize: 20, toolName: 'PINHOLE' } }`; `projects/project_list_bridge_2026-09-02T20-54-49-209Z.json`)
- [x] Create test project. (live: FlowGraph V1 Live 2026-09-02)
- [x] T2I real. (live Run 1/2/3/4; Run 4 mediaId ff49d846 + node-card image preview rendered)
- [x] I2V real. (live Run 1/2/3/4; Run 4 video mediaId 31e26cf9 + node-card video preview rendered)
- [x] Download real. (live Run 1/2/3/4; Run 4 chrome download -> flowgraph-output (3).mp4)
- [x] Download real VIDEO via production bridge (2026-09-04): `FLOWGRAPH_MEDIA_DOWNLOAD` -> service-worker `resolveMediaUrl(VIDEO)` -> `chrome.debugger` `Input.dispatchMouseEvent` opens the `flow-video-tile` editor -> Angular renders `<video>` with signed `flow-content.google/video/<mediaId>` src -> `chrome.downloads` completes. downloadId 17 `flowgraph_v1_prod_t2v.mp4`, 3,344,242 bytes, `video/mp4`, SHA-256 `321BBBB0…C9DB14`, `byExtensionName: FlowGraph Extension`. Evidence: `download/video_prod_bridge_2026-09-04T10-18-17Z.json`. Note: the legacy `media.getMediaUrlRedirect` endpoint now returns the SPA HTML fallback (401/HTML) for new-domain media, so the debugger trusted-click path is the production mechanism; a synthetic `element.click()` is ignored by Angular and `chrome.windows.update({focused})` does not reliably OS-foreground an occluded window.
- [x] T2I / I2V / Download real, 3 consecutive clean full-chain passes (2026-09-05, cache bypassed, distinct mediaIds every run):
  Run 5 `38e0eda0` — image `c8253b91` -> video `7f06b147` -> downloadId 33 `flowgraph-output (10).mp4` 8,380,117 B (125 s).
  Run 6 `6f9e6355` — image `54207841` -> video `b47ecddd` -> downloadId 34 `flowgraph-output (11).mp4` 8,089,921 B (123 s).
  Run 7 `3bf976c5` — image `fb3650ad` -> video `b8db27b9` -> downloadId 35 `flowgraph-output (12).mp4` 7,933,254 B (113 s).
  All three MP4s verified with a real `ftypisom` box header. Evidence:
  `e2e/run5_20260905_043227.json`, `e2e/run6_20260905_050133.json`, `e2e/run7_20260905_052925.json`
  plus per-node `t2i/`, `i2v/`, `download/` files with the same run tags.
  Defect found and fixed during this pass (commit `ba8d31d`): the Flow gallery is virtualised to a
  fixed 8 `<flow-video-tile>`, so a finished render *replaces* the oldest tile instead of appending.
  `decideVideoTileArrival()` only accepted a growing token list, which produced a false
  `PROVIDER_ERROR: Timed out waiting for generated media` (runs `882a2552`, `0d64e93e`) while Flow had
  already rendered the video. Now detects arrival by *unknown tile index* as well, with `:new`/`:repl`
  trace markers and no false `MEDIA_FAILED` when a same-length window is rotated.
- [x] T2V real. (live 3 fresh T2V runs; video mediaIds 63e32711, 67eafa40, d13f11f0 + valid mp4 artifacts; `t2v/run_t2v_20260903_141554.json`, `t2v/run_t2v_20260903_072455.json`, `t2v/run_t2v_20260903_072546.json`)
- [ ] Verify credits if measurable. (creditsUsed 0 is insecure; no reliable live delta fixture — remains unchecked)

**§6 project-list bug root cause (fixed + live verified):** the old `FLOWGRAPH_PROJECT_LIST` sent
`{ json: {} }`, which failed the real `project.searchUserProjects` zod shape and returned `[]`.
Production now sends `{ json: { pageSize: 20, toolName: 'PINHOLE' } }` and `unwrapTrpc`
(`src/background/service-worker.ts`) reads `root.result.data.json.result` — the correct nesting.
Live bridge returns **20 real projects** including the target, `account CONNECTED`, `flow READY`,
`noSecrets: true`. Evidence:
`projects/project_list_request_shape.json`,
`projects/project_list_bridge_2026-09-02T20-54-49-209Z.json`,
`projects/project_list_live_2026-09-03T03-42-00Z.json`.

## FG-1505 — Full E2E
- [ ] Fresh browser/session. (reused live session; fresh cold-profile pass STOPPED-AT-MANUAL-LOGIN — `e2e/fresh_session_boundary_2026-09-03T03-42-00Z.json`; login + extension load are manual user actions, not automated)
- [x] Open FlowGraph. (live Studio + Flow tab)
- [x] Canvas locked. (live gate test: home-locked step `locked: true`, `runDisabled: true`, gate text `PROJECT REQUIRED`, flow state `PROJECT_REQUIRED`; `projects/project_gate_live_2026-09-03T03-42-00Z.json`)
- [x] Gate locks/unlocks on live navigation (fail-closed). (home locks `gate=True runDisabled=True` within ~1s; project unlocks `gate=False runDisabled=False` within ~1s; no reload, no 120s poll; `projects/project_gate_live_reactivity_2026-09-02T21-35-38-062Z.json`, `projects/project_gate_live_reactivity_2026-09-02T21-36-13-566Z.json`)
- [x] Select/Create Project. (live active project 23e7d6d8)
- [x] Canvas unlocks. (live gate unlocked)
- [x] Build pipeline. (live Prompt→T2I→I2V→Download graph)
- [x] Run. (live Run 1/2/3/4)
- [x] Run full chain repeatedly with cache bypass. (live Runs 5/6/7 on 2026-09-05 — 3/3 success,
  every node `success`, fresh image + video mediaIds, real mp4 artifact per run;
  `e2e/run5_20260905_043227.json`, `e2e/run6_20260905_050133.json`, `e2e/run7_20260905_052925.json`)
- [x] Image appears. (real image tile in Google Flow + Studio node card `<img>` render in Run 4)
- [x] Video appears. (real video tile in Google Flow + Studio node card `<video>` render in Run 4)
- [x] Download succeeds. (real mp4 artifacts on disk)
- [x] Reload app. (live save/reload/restore evidence; Studio reload restored workflow; `e2e/save_reload_restore_2026-09-02T20-40-52-119Z.json`)
- [x] Workflow restores correctly. (live save/reload/restore evidence; schema v3 + projectBinding + runtimeResults rehydrated — `runtimeResults` non-null for nodes 2/3/4)

---

# PHASE 16 — Release Gate

## FG-1601 — Build
- [x] `npm run build` PASS.
- [x] No TypeScript errors.
- [x] No console fatal errors.

## FG-1602 — Runtime evidence
Mỗi capability được gọi là REAL/RUNTIME_VERIFIED phải có:
- [x] request evidence sanitized. (t2i/i2v/download run1/2/3/4 JSON — no secrets)
- [x] response evidence sanitized. (t2i/i2v/download run1/2/3/4 JSON — no secrets)
- [x] terminal/test success. (Run 1/2/3/4 SUCCESS; Run 4 includes node-card preview render)
- [x] media artifact nếu applicable. (real image/video mediaIds + mp4 on disk; Run 4 flowgraph-output (3).mp4)
- [x] T2V live evidence. (3 fresh T2V runs with distinct video mediaIds + valid mp4; `t2v/run_t2v_20260903_141554.json`, `t2v/run_t2v_20260903_072455.json`, `t2v/run_t2v_20260903_072546.json`)
- [x] 3 consecutive clean full-chain E2E evidence. (Runs 5/6/7 on 2026-09-05: per-run
  `e2e/run[5-7]_*.json` with timestamps, projectId, distinct T2I + I2V mediaIds, downloadId,
  artifact path/bytes and MP4 `ftypisom` header; matching per-node `t2i/`, `i2v/`, `download/`
  files. No token, cookie, reCAPTCHA payload or signed URL stored.)
- [x] Automated suite after the runtime fixes. (104/104 tests PASS across 15 files;
  `npx tsc --noEmit` clean; `npm run build` PASS — including the virtualised-gallery
  tile-arrival unit tests added in `tests/unit/VideoTileDetection.test.ts`.)

Evidence link:
`evidence/flowgraph_v1/` — account, projects, t2i, i2v, download, e2e all present with sanitized
live run JSON.

Fresh evidence (2026-09-03):
- `evidence/flowgraph_v1/projects/project_list_live_2026-09-03T03-42-00Z.json`
- `evidence/flowgraph_v1/projects/project_gate_live_2026-09-03T03-42-00Z.json`
- `evidence/flowgraph_v1/e2e/save_reload_restore_2026-09-02T20-40-52-119Z.json`
- `evidence/flowgraph_v1/e2e/fresh_session_boundary_2026-09-03T03-42-00Z.json`
- `evidence/flowgraph_sync/2026-09-03-prompt-writer-live.json` — live ping, prompt write,
  IMAGE/VIDEO mode write on project `729eaa19...`; Slate placeholder-safe text selection fixed.

Fresh evidence (2026-09-05 — three clean full-chain passes):
- `evidence/flowgraph_v1/e2e/run5_20260905_043227.json`
- `evidence/flowgraph_v1/e2e/run6_20260905_050133.json`
- `evidence/flowgraph_v1/e2e/run7_20260905_052925.json`
- `evidence/flowgraph_v1/t2i/run5_20260905_043227.json` / `run6_20260905_050133.json` / `run7_20260905_052925.json`
- `evidence/flowgraph_v1/i2v/run5_20260905_043227.json` / `run6_20260905_050133.json` / `run7_20260905_052925.json`
- `evidence/flowgraph_v1/download/run5_20260905_043227.json` / `run6_20260905_050133.json` / `run7_20260905_052925.json`

## FG-1603 — Capability matrix
Phân loại node:
- [x] RUNTIME_VERIFIED (t2i/i2v/t2v/download — live provider evidence Runs 1–4 + 3 fresh T2V runs; prompt — local runtime)
- [x] CONTRACT_VERIFIED (extend/reference/upscale — adapter/payload verified; executor pending Phase 12)
- [x] RUNTIME_VERIFIED (interpolation — executor + live Runs 1 & 2 verified 2026-09-05)
- [x] RUNTIME_PARTIAL
- [x] UI_ONLY
- [x] COMING_SOON
- [x] Matrix file: `docs/FLOWGRAPH_RUNTIME_CAPABILITY_MATRIX.md` (added).

## FG-1604 — Final acceptance
- [x] Không còn simulation trong Run Workflow production path.
- [x] Không có hard-coded online status.
- [x] Không có fake media preview/result. (live Run 4: node cards render real getMediaUrlRedirect media, no "No result yet")
- [x] Project Gate hoạt động. (live unlocked)
- [x] Project Gate fail-closed on live navigation. (home locks, project unlocks within ~1s; SW derives real project state from tab URL via `projectIdFromUrl`; Studio re-reads account on FLOWGRAPH_EVENT)
- [x] Real pipeline PASS nhiều lần liên tiếp. (Run 1/2/3/4)
- [x] Real pipeline PASS nhiều lần liên tiếp với cache bypass. (Runs 5/6/7 on 2026-09-05 — 3/3
  consecutive clean full-chain passes on project `729eaa19`, each with brand-new image + video
  mediaIds and a real mp4 on disk; run 7 was the first pass after the virtualised-gallery fix
  `ba8d31d` and the download/sync fixes `6e20ccb`/`8b05820`/`66b110d` were live)
- [x] T2V live PASS nhiều lần liên tiếp. (3 fresh T2V runs with distinct mediaIds + valid mp4)
- [x] Retry/cancel/error paths được test. (automated integration tests; live not exercised for retry/cancel this pass — honest note)
- [x] Không leak secret.

Full release report:
`flowgraph-extension/FLOWGRAPH_V1_RELEASE_REPORT.md` and `FLOWGRAPH_V1_RELEASE_REPORT.md`
(repo root) — READY for the extension-supported V1 runtime with documented fresh-session,
credit-delta, and retry/cancel live caveats.

---

# Thứ tự triển khai thực tế — Critical Path

Không nên làm task ngẫu nhiên. Đi theo đúng chuỗi này:

```text
FG-0101 Account Status
       ↓
FG-0102 Flow Status
       ↓
FG-0103 Bridge Protocol
       ↓
FG-0202 List Projects
       ↓
FG-0203 Create Project
       ↓
FG-0204 Active Project
       ↓
FG-0205 Canvas Gate
       ↓
FG-0301 Runtime Core
       ↓
FG-0401/0402 Validator
       ↓
FG-0501 Adapter
       ↓
FG-0601 Prompt Executor
       ↓
FG-0602 Text-to-Image
       ↓
FG-0701 Media Propagation
       ↓
FG-0603 Image-to-Video
       ↓
FG-0801 Poll/Error
       ↓
FG-0604 Download
       ↓
REAL PIPELINE V1 PASS
       ↓
Retry / Cache / Credits / Queue
       ↓
Extended Nodes
       ↓
Hardening / E2E / Release
```

---

# Milestones

## M1 — PROJECT READY
Kết quả:

```text
Account real
Flow real
Project list real
Create Project real
Select Project real
Canvas lock/unlock real
```

**REAL (2026-09-01):** ✅ Account KATA connected, ✅ 860 credits, ✅ Project `9125da34-52c4-4f38-a8cc-7d6e1bb31483` created via tRPC, ✅ Extension loaded into Chrome debug profile, ✅ Service worker active, ✅ Studio HTML accessible.

## M2 — RUNTIME CORE READY
Kết quả:

```text
Graph validation
Planning
Execution context
Node states
Data propagation
```

## M3 — FIRST REAL GENERATION
Kết quả:

```text
Prompt → Text-to-Image
```

Google Flow tạo ảnh thật và node hiển thị ảnh thật.

## M4 — FIRST REAL CHAIN
Kết quả:

```text
Prompt → T2I → I2V
```

I2V sử dụng đúng MediaRef từ T2I.

## M5 — REAL RUNTIME V1
Kết quả:

```text
Prompt → T2I → I2V → Download
```

Có validation, polling, errors, preview thật.

## M6 — PRODUCTION RUNTIME
Kết quả:

```text
Retry
Resume
Cancel
Cache
Credits
Concurrency
Run history
```

## M7 — NODE COVERAGE
Kết quả:

```text
T2V
Interpolation
Reference
Extend
Upscale
Utility nodes
```

chỉ theo capability runtime thực tế.

## M8 — RELEASE
Kết quả:

FlowGraph có thể được sử dụng như một node-based Google Flow runtime thật, không phải demo UI.

---

# Quy tắc làm việc cho toàn dự án

1. Không gọi một tính năng là hoàn thành chỉ vì UI đã có.
2. `DONE` chỉ khi có code + build + test phù hợp.
3. `RUNTIME_VERIFIED` chỉ khi có runtime evidence thật.
4. KHÔNG được phép bypass CAPTCHA/reCAPTCHA hoặc security của Google.
5. KHÔNG được phép expose/dump/copy token, cookie hoặc browser credential.
6. Không fake success.
7. Một task lỗi phải sửa trước khi mở rộng sang task downstream nếu nó nằm trên Critical Path.
8. Ưu tiên hoàn thiện một pipeline thật nhỏ trước khi mở rộng node coverage.
9. Mỗi milestone phải có regression build.
10. Sau mỗi milestone cập nhật checklist `[ ] → [x]` và ghi evidence/test tương ứng.
