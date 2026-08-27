# CHANGELOG

## 2026-08-27 — Runtime Capture Phase 1 (4 MP4 Artifacts Verified)

### 🏆 Major: Full Video Pipeline Runtime Capture via UI/CDP

Successfully captured **4 complete video/media generation pipelines** with real HTTP 200 OK responses and **4 MP4 artifacts downloaded to disk (~24.5 MB total)**:

| Pipeline | Endpoint | Credits | MP4 Artifact |
|---|---|---|---|
| Text-to-Video (Fox) | `POST /v1/video:batchAsyncGenerateVideoText` | 12 | `verified_fox_video.mp4` (7.7MB) |
| Image-to-Video (Lake) | `POST /v1/video:batchAsyncGenerateVideoStartImage` | 15 | `i2v_verified_*.mp4` (5.8MB) |
| Interpolation (Morph) | `POST /v1/video:batchAsyncGenerateVideoStartAndEndImage` | 20 | `interpolation_verified_*.mp4` (5.9MB) |
| Extend/Edit (Fox forest) | `POST /v1/video:batchAsyncGenerateVideoEditVideo` | 20 | `extend_verified_*.mp4` (5.1MB) |

### 🔑 Verified Payload Field Shapes (Disproving Old Hypotheses)
- `imageBytes` (Image Upload) — **disproves** `encodedImage` (was 400 Unknown field)
- `startImage: { "mediaId": "<uuid>" }` — **disproves** `startImage: { "name": "..." }`
- `endImage: { "mediaId": "<uuid>" }` — **disproves** `endImage: { "name": "..." }`
- `referenceImages: [ { "mediaId": "<uuid>" } ]` — **disproves** `referenceImages[].name`
- `videoInput: { "mediaId": "<uuid>" }` — **disproves** `videoInput.name`
- `cancelGeneration` → `{ "mediaId": "<uuid>" }` — **disproves** `name`/`projectId`

### 📈 Credit Deduction Sequence Verified
$1050 \to 1038 (-12) \to 1023 (-15) \to 1003 (-20) \to 983 (-20)$ — matching exact model pricing tables.

### ✅ Evidence Manifest Updated to 11 RUNTIME_VERIFIED Claims
- Added: `image_upload_bytes`, `text_to_video_t2v`, `image_to_video_i2v`, `start_end_interpolation`, `video_extend_edit`, `download_cdn_redirect`.
- All backed by semantic fixtures + validators.

### 🔒 Gate Status
- **Gate 1 (Ingestion):** Image Upload Verified.
- **Gate 3 (Video Advanced):** T2V, I2V, Interpolation, Extend/Edit 100% Verified.
- **Gate 5 (Lifecycle):** Polling state transition + 307 CDN download Verified.
- **Gate 7 (Automation):** 5/5 Guardrail Unit Tests PASSED.


## 2026-08-27 — Full Test Suite Expansion

- Expanded `tests/test_flow.py` to **76 offline evidence/regression/security/SDK tests**.
- Added `tests/test_live_paid.py` with **12 opt-in live paid E2E tests** covering Auth, Credits, Image Upload, T2V, I2V, Interpolation, Reference Images, Edit/Extend, Download 307/CDN, Cancel Active Generation, and invalid-reCAPTCHA negative control.
- Added MP4 `ftyp` magic-byte checks and exact artifact-size verification.
- Added exact credit-chain assertions: `1050 -> 1038 -> 1023 -> 1003 -> 983`, total spend `67`.
- Added cross-evidence consistency tests and regression checks for legacy `.name` payloads.
- Added PII/secret/signed-CDN sanitization tests; sanitized the remaining signed CDN `Signature` in `evidence/download/response.json`.
- Added `pytest.ini`, `tests/TEST_PLAN.md`, `tests/README.md`, and `tests/requirements-test.txt`.
- Live tests are explicitly opt-in with `FLOW_RUN_LIVE_PAID=1` and require fresh legitimate browser-generated reCAPTCHA tokens; no CAPTCHA bypass/synthesis logic is included.
- Note: suite files were created and statically inspected through the filesystem MCP. Test execution still requires a command-capable shell/runner on `E:\Flow_veo`.
