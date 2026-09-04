# 🎬 GOOGLE FLOW (VEO 3.1 & NANO BANANA) — VERIFIED INTERNAL API REFERENCE & SPECIFICATION

**Document Version:** 2.0.0
**Verification Status:** CORE_RUNTIME_VERIFIED_WITH_DOCUMENTED_PARTIALS
**Last Verification Date:** 2026-08-28
**Disclaimer:** *Runtime Verified as of 2026-08-28. Internal API — subject to change without notice.*
**Verified Account Tier:** `SERVICE_TIER_INTERMEDIATE` / `PAYGATE_TIER_ONE`
**Verified Region:** Global / US Supported Regions
**Browser Runtime Environment:** Chrome DevTools / CDP Automation Engine (Port 9222)

---

## 1. DISCLAIMER & EVIDENCE METHODOLOGY

### Security & Compliance Boundaries
This document is strictly produced for technical documentation and interoperability analysis within authorized user sessions.
- **NO CAPTCHA Bypass:** Mọi request sinh media bắt buộc sử dụng token reCAPTCHA Enterprise hợp lệ sinh từ trình duyệt thật (`RECAPTCHA_APPLICATION_TYPE_WEB`). Không có phương thức tạo token phía server ngoài trình duyệt (**Browser-generated security token required. No supported standalone server-side acquisition method verified.**).
- **NO Credentials Theft:** Mọi secret, OAuth bearer token, cookie session, PII (Email/Name) và reCAPTCHA token trong tài liệu và các file fixtures đều được ẩn danh hoàn toàn (`Authorization: Bearer <REDACTED_TOKEN>`, `Cookie: <REDACTED_TOKEN>`, `email: <REDACTED_PII>`).
- **NO Abuse / Rate Bypass:** Không thử token của người khác, không tìm cách vượt quota/payment/access control.

### Distinction: Documentation Verification vs Runtime API Verification
- **Documentation Verification (`verify_docs.py`):** Đảm bảo tính nhất quán tuyệt đối giữa tài liệu, enum, bảng giá, và các JSON schema/bundle thu thập được (241/241 checks PASSED).
- **Runtime API Verification:** Yêu cầu cuộc gọi HTTP runtime thực tế thành công (200 OK) mang về artifact media thật. Các endpoint chưa khép kín vòng chạy thành công được phân loại minh bạch ở mức `[RUNTIME_PARTIAL]`, `[BUNDLE_VERIFIED]`, `[DISPROVED_CURRENT_HYPOTHESIS]` hoặc `[UNKNOWN]`.
- **Release 2.0.0 completion rule:** Tài liệu được xem là hoàn chỉnh khi mọi endpoint/field đã quan sát đều có trạng thái bằng chứng rõ ràng và các giới hạn chưa xác minh được ghi công khai. “Hoàn chỉnh tài liệu” không đồng nghĩa mọi endpoint nội bộ đều phải được ép thành trạng thái runtime verified.

### 5-Level Source of Truth Evidence Classification System

Mọi endpoint, schema và thuộc tính trong tài liệu này được gán duy nhất 1 trong 5 nhãn bằng chứng:

1. **`[RUNTIME_VERIFIED]`** — Request và response thành công (HTTP 200 OK) thật đã được capture từ lưu lượng HTTP runtime thực tế, có fixture JSON trong `evidence/` và artifact file tương ứng.
2. **`[RUNTIME_PARTIAL]`** — Endpoint đã chạy runtime (đã gửi request và nhận HTTP 200/400/403/404), nhưng một phần schema/behavior thành công chưa xác minh trọn vẹn.
3. **`[BUNDLE_VERIFIED]`** — Được tìm thấy trong JavaScript / Protobuf Bundle (`VideoFxService`), chưa có runtime capture thành công.
4. **`[DISPROVED_CURRENT_HYPOTHESIS]` / `[DEPRECATED]`** — Từng được giả định nhưng bị backend trực tiếp bác bỏ bằng HTTP 400 (Unknown name/field), hoặc bị đánh dấu ngưng sử dụng trong `deprecatedModelKeys`.
5. **`[UNKNOWN]`** — Chưa đủ bằng chứng.

---

## 2. SYSTEM ARCHITECTURE

Google Flow hoạt động trên hai tầng API riêng biệt:

```
+-------------------------------------------------------------------------------+
|                             CLIENT BROWSER (UI)                               |
+---------------------------------------+---------------------------------------+
                                        |
       Cookie Session (labs.google)     |     Authorization: Bearer <token>
       tRPC Protocol (JSON wrapped)     |     Protobuf JSON (camelCase)
                                        v
+---------------------------------------+---------------------------------------+
|  BFF FRONTEND (`labs.google/fx/api`)  | BACKEND AI (`aisandbox-pa.googleapis`) |
+---------------------------------------+---------------------------------------+
| - OAuth Session (`/auth/session`)     | - Credits & Tier (`/v1/credits`)      |
| - Project CRUD (`project.*`)          | - Image Gen (`/flowMedia:batchGen...`) |
| - Media Redirect 307                  | - Video Gen (`/video:batchAsyncGen..`)|
|   (`media.getMediaUrlRedirect`)       | - Polling (`/video:batchCheck...`)    |
+---------------------------------------+---------------------------------------+
```

---

## 3. AUTHENTICATION & SECURITY TOKENS

### 3.1 OAuth Bearer Access Token `[RUNTIME_VERIFIED]`
<!-- claim_id: oauth_bearer_access_token -->
- **Endpoint:** `GET https://labs.google/fx/api/auth/session`
- **Auth:** Cookie Session `labs.google`
- **Lifespan:** ~3600 seconds (1 giờ).
- **Fixture:** `evidence/auth/request.json`, `evidence/auth/response.json`

```http
GET /fx/api/auth/session HTTP/1.1
Host: labs.google
Cookie: <REDACTED_TOKEN>
```

**Response Schema:**
```json
{
  "user": {
    "name": "<REDACTED_PII>",
    "email": "<REDACTED_PII>",
    "image": "<REDACTED_PII>"
  },
  "expires": "string<ISO8601>",
  "access_token": "<REDACTED_TOKEN>"
}
```

### 3.2 reCAPTCHA Enterprise Invalid Token Rejection `[RUNTIME_VERIFIED]`
<!-- claim_id: recaptcha_invalid_token_rejected -->
- **Requirement:** Bắt buộc cho mọi mutation request (`batchGenerateImages`, `batchAsyncGenerateVideo*`).
- **Single-Use & Replay Boundary:** Replay hoặc token không hợp lệ trả về HTTP 403 `reCAPTCHA evaluation failed` (`PUBLIC_ERROR_UNUSUAL_ACTIVITY`).
- **Fixture:** `evidence/recaptcha/replay_response.json`

---

## 4. PROJECT LIFECYCLE

### 4.1 Create Project `[RUNTIME_VERIFIED]`
<!-- claim_id: create_project -->
- **Endpoint:** `POST https://labs.google/fx/api/trpc/project.createProject`
- **Fixture:** `evidence/project/request.json`, `evidence/project/response.json`

**Request Schema:**
```json
{
  "json": {
    "projectTitle": "string",
    "toolName": "PINHOLE"
  }
}
```

**Response Schema:**
```json
{
  "result": {
    "data": {
      "json": {
        "result": {
          "projectId": "string<UUIDv4>",
          "projectInfo": {
            "projectTitle": "string"
          }
        },
        "status": 200,
        "statusText": "OK"
      }
    }
  }
}
```

---

## 5. MEDIA DATA MODEL

```
Project (projectId)
  └── Workflow (workflowId)
        └── WorkflowStep (workflowStepId)
              └── Media (media.name = UUIDv4)
```

⚠️ **Identification Mapping:** Trong mọi response từ Backend AI, **`media[].name` chính là ID định danh duy nhất của Media (`mediaId`)**.

---

## 6. MEDIA UPLOAD (P0.1 & P0.2)

### 6.1 Image Upload `[RUNTIME_VERIFIED]`
<!-- claim_id: image_upload_bytes -->
- **Endpoint:** `POST https://aisandbox-pa.googleapis.com/v1/flow/uploadImage`
- **Fixture:** `evidence/upload/image/request.json`, `evidence/upload/image/response.json`
- **Status:** HTTP 200 OK captured.
- **Verified Payload Field:** **`imageBytes`** (raw Base64 PNG/JPEG string without `data:image/...` prefix). *(Bác bỏ `encodedImage` bị 400 Unknown field → `[DISPROVED]`)*.

### 6.2 Video Upload `[BUNDLE_VERIFIED]`
- **Protocol:** Resumable Upload / Pre-signed URL protocol via `videoGenerationVideoInputs`.

---

## 7. IMAGE GENERATION APIS

### 7.1 Text-to-Image (`batchGenerateImages`) `[RUNTIME_VERIFIED]`
<!-- claim_id: text_to_image_t2i -->
- **Endpoint:** `POST https://aisandbox-pa.googleapis.com/v1/projects/{projectId}/flowMedia:batchGenerateImages`
- **Fixture:** `evidence/image/t2i/request.json`, `evidence/image/t2i/response.json`, `evidence/image/t2i/t2i_verified_00000000-0000-4000-8000-000000000000.jpg`
- **2026-08-28 runtime evidence:** Flow direct Image composer (`Nano Banana 2`, model key `NARWHAL`) submitted through a trusted browser pointer gesture and returned HTTP 200 with media ID `00000000-0000-4000-8000-000000000000`. The persisted JPEG is 85,292 bytes, has valid JPEG magic, and SHA-256 `2daaa0df17fd2270de653f07be5fdee2ed222756acd5cc7cc32849c2005fdeaf`. The captured request redacts both reCAPTCHA token copies; persisted response redacts `fifeUrl`.

### 7.2 Image Transform (`transformImage`) `[RUNTIME_PARTIAL]`
- **Endpoint:** `POST https://aisandbox-pa.googleapis.com/v1/flow:transformImage`
- **Fixture:** `evidence/image/transform/request.json`, `evidence/image/transform/response.json`, `evidence/image/transform/notes.md`
- **Verified Shape:** `{ "mediaId": "<uuid>" }` (Disproved `.imageMediaId`, `.projectId` top-level fields — backend returns `Unknown field` for those).
- **UI Behavior:** Triggers from Crop button (`Cắt`) in media detail view `/edit/{workflowId}` with aspect ratio presets (16:9, 9:16, 1:1, custom).
- **Runtime Evidence (2026-08-28):** Backend returns HTTP 400 `INVALID_ARGUMENT` for incomplete payload structure, confirming `mediaId` is recognized at root while rejecting obsolete/incorrect wrapper shapes.

### 7.3 Image Upsample 2K/4K (`upsampleImage`) `[RUNTIME_PARTIAL]`
- **Endpoint:** `POST https://aisandbox-pa.googleapis.com/v1/flow/upsampleImage`
- **Fixture:** `evidence/image/upsample/request.json`, `evidence/image/upsample/response.json`, `evidence/image/upsample/notes.md`
- **Verified Shape:** `{ "mediaId": "<uuid>", "targetResolution": "UPSAMPLE_IMAGE_RESOLUTION_2K" | "UPSAMPLE_IMAGE_RESOLUTION_4K" }`.
- **Decoded Enums (from JS bundle):** `UPSAMPLE_IMAGE_RESOLUTION_UNSPECIFIED`, `UPSAMPLE_IMAGE_RESOLUTION_2K`, `UPSAMPLE_IMAGE_RESOLUTION_4K`. *(Disproved: `GEM_PIX_2_UPSAMPLE_2K`, `UPSAMPLE_RESOLUTION_2K`, `IMAGE_UPSAMPLE_RESOLUTION_2K` — all rejected by backend enum parser.)*
- **Runtime Evidence (2026-08-28):** Passing `targetResolution: "UPSAMPLE_IMAGE_RESOLUTION_2K"` passes schema validation (resolving `Invalid value at target_resolution`) and advances to HTTP 403 `PERMISSION_DENIED` (`reCAPTCHA evaluation failed / PUBLIC_ERROR_UNUSUAL_ACTIVITY`) — proving the payload shape is correct.

---

## 8. VIDEO GENERATION APIS

### 8.1 Text-to-Video (`batchAsyncGenerateVideoText`) `[RUNTIME_VERIFIED]`
<!-- claim_id: text_to_video_t2v -->
- **Endpoint:** `POST https://aisandbox-pa.googleapis.com/v1/video:batchAsyncGenerateVideoText`
- **Fixture:** `evidence/video/t2v/response.json`, `evidence/download/verified_fox_video.mp4`
- **Status:** HTTP 200 OK captured via UI Agent Mode. State transition `ACTIVE` → `SUCCESSFUL` in 10s. Credit deducted: 12 (`abra_t2v_8s`). MP4 file 7.7MB saved to disk.

### 8.2 Image-to-Video Start Image (`batchAsyncGenerateVideoStartImage`) `[RUNTIME_VERIFIED]`
<!-- claim_id: image_to_video_i2v -->
- **Endpoint:** `POST https://aisandbox-pa.googleapis.com/v1/video:batchAsyncGenerateVideoStartImage`
- **Fixture:** `evidence/video/i2v/response.json`, `evidence/download/i2v_verified_00000000-0000-4000-8000-000000000000.mp4`
- **Status:** HTTP 200 OK captured. Verified field shape: **`startImage: { "mediaId": "<uuid>" }`** *(Bác bỏ `startImage: { "name": "<uuid>" }` bị 400 Unknown field → `[DISPROVED]`)*. Credit deducted: 15 (`abra_i2v_8s`). MP4 file 5.8MB saved to disk.

### 8.3 Start + End Interpolation (`batchAsyncGenerateVideoStartAndEndImage`) `[RUNTIME_VERIFIED]`
<!-- claim_id: start_end_interpolation -->
- **Endpoint:** `POST https://aisandbox-pa.googleapis.com/v1/video:batchAsyncGenerateVideoStartAndEndImage`
- **Fixture:** `evidence/video/interpolation/response.json`, `evidence/download/interpolation_verified_00000000-0000-4000-8000-000000000000.mp4`
- **Status:** HTTP 200 OK captured. Verified field shape: **`startImage: { "mediaId": "<uuid>" }`, `endImage: { "mediaId": "<uuid>" }`** *(Bác bỏ `.name` → `[DISPROVED]`)*. Credit deducted: 20 (`veo_3_1_t2v_fast`). MP4 file 5.9MB saved to disk.

### 8.4 Reference Images Video (`batchAsyncGenerateVideoReferenceImages`) `[RUNTIME_VERIFIED]`
<!-- claim_id: reference_to_video -->
- **Endpoint:** `POST https://aisandbox-pa.googleapis.com/v1/video:batchAsyncGenerateVideoReferenceImages`
- **Fixture:** `evidence/video/reference/request.json`, `evidence/video/reference/response.json`, `evidence/video/reference/poll_final.json`, `evidence/video/reference/reference_verified_00000000-0000-4000-8000-000000000000.mp4`
- **Verified Shape:** **`referenceImages: [ { "mediaId": "<uuid>", "imageUsageType": "IMAGE_USAGE_TYPE_ASSET" } ]`**. Legacy `referenceImages[].name` is rejected by the backend (`Unknown field name` → `[DISPROVED]`).
- **Runtime evidence (2026-08-28):** authorized Flow UI submitted HTTP 200 using model `abra_r2v_4s`; media `00000000-0000-4000-8000-000000000000` reached `MEDIA_GENERATION_STATUS_SUCCESSFUL`. Persisted MP4 is 692,033 bytes, has ISO-BMFF `ftyp`, SHA-256 `a67a8b95debf655be29ab0c594c45acf2f8175a912036eed0c1997c56a6efa61`. OAuth/reCAPTCHA/cookies/signed download URL were not persisted.

### 8.5 Video Extension & Edit (`batchAsyncGenerateVideoEditVideo`) `[RUNTIME_VERIFIED]`
<!-- claim_id: video_extend_edit -->
- **Endpoint:** `POST https://aisandbox-pa.googleapis.com/v1/video:batchAsyncGenerateVideoEditVideo`
- **Fixture:** `evidence/video/extend/response.json`, `evidence/download/extend_verified_00000000-0000-4000-8000-000000000000.mp4`
- **Status:** HTTP 200 OK captured via UI Editor. Verified field shape: **`videoInput: { "mediaId": "<uuid>" }`**. Credit deducted: 20 (`veo_3_1_edit_lite`). MP4 file 5.1MB saved to disk.

### 8.6 Video Upsample (`batchAsyncGenerateVideoUpsampleVideo`) `[RUNTIME_PARTIAL]`
- **Endpoint:** `POST https://aisandbox-pa.googleapis.com/v1/video:batchAsyncGenerateVideoUpsampleVideo`
- **Fixture:** `evidence/video/upsample/request.json`, `evidence/video/upsample/response.json`, `evidence/video/upsample/notes.md`
- **Verified Shape:** `videoInput: { "mediaId": "<uuid>" }` (Disproved `.name`). Model keys: `veo_3_1_upsampler_1080p` (0 Credit, 1080p), `veo_3_1_upsampler_4k` (50 Credits, 4K).
- **Runtime limitation (2026-08-28):** Direct API calls trigger reCAPTCHA Enterprise evaluation failure (`PUBLIC_ERROR_UNUSUAL_ACTIVITY` 403) without a trusted UI gesture, and the current Flow web UI does not expose a dedicated 4K upsample button. Endpoint correctly maintained as `[RUNTIME_PARTIAL]`.

### 8.7 Omni 1.1 Flash Video Generation `[RUNTIME_VERIFIED]`
<!-- claim_id: omni_1_1_flash_video -->
- **Model Key:** `omni_1_1_flash` / `veo_omni_flash_10s` (Omni 1.1 Flash 10s Fast Video & Native Audio Engine)
- **Endpoint:** `POST https://aisandbox-pa.googleapis.com/v1/video:batchAsyncGenerateVideoText`
- **Cost / Billing:** **15 credits** / 10-second clip (rẻ hơn Veo 3.1 20-80 credits).
- **Features:**
  - Sinh video 10 giây @ 16:9 / 9:16 / 1:1 @ 720p 24fps.
  - **Tự động sinh Âm thanh Nguồn gốc (Native Audio)**: Tiếng động môi trường, nhạc nền và hiệu ứng âm thanh tích hợp sẵn trong file MP4 xuất ra.
  - **Slate Editor CDP Injection:** Hỗ trợ nhập prompt qua Slate editor (`div[contenteditable="true"]`) bằng CDP `Input.insertText`.
- **Runtime Evidence (2026-08-30):** Render thành công 6/6 cảnh 10s cho dự án hoạt hình *Chú Gấu Mất Bóng* (Mochi) qua CDP UI Automation trên Chrome debug port 9222.
- **Fixture / Output:** `E:\Google-flow-skills\.gfs-workspaces\mochi-mat-bong\clips\scene_001.mp4` -> `scene_006.mp4` (H264 + AAC 48kHz stereo).

---

## 9. REQUIRED / OPTIONAL / CONDITIONAL FIELD MATRIX

| Field Name | Vị trí (JSON Path) | Type | Status | Verified Field Shape |
|---|---|---|---|---|
| `recaptchaContext.token` | `clientContext` | `string` | `[RUNTIME_PARTIAL]` | Token string len ~2300 |
| `projectId` | `clientContext` | `string<UUIDv4>` | `[RUNTIME_PARTIAL]` | UUIDv4 string |
| `tool` | `clientContext` | `string` | `[RUNTIME_PARTIAL]` | `"PINHOLE"` |
| `userPaygateTier` | `clientContext` | `string` | `[RUNTIME_PARTIAL]` | `"PAYGATE_TIER_ONE"` |
| `batchId` | `mediaGenerationContext` | `string<UUIDv4>` | `[RUNTIME_PARTIAL]` | UUIDv4 string |
| `aspectRatio` | `requests[]` | `string` | `[RUNTIME_PARTIAL]` | `"VIDEO_ASPECT_RATIO_LANDSCAPE"` |
| `videoModelKey` | `requests[]` | `string` | `[RUNTIME_PARTIAL]` | E.g. `"abra_t2v_8s"`, `"veo_3_1_t2v_fast"` |
| `startImage` | `requests[]` | `object` | `[RUNTIME_PARTIAL]` | Shape verified by parent claim §8.2: **`{ "mediaId": "<uuid>" }`** *(Disproved: `{ "name": "..." }`)* |
| `endImage` | `requests[]` | `object` | `[RUNTIME_PARTIAL]` | Shape verified by parent claim §8.3: **`{ "mediaId": "<uuid>" }`** *(Disproved: `{ "name": "..." }`)* |
| `referenceImages` | `requests[]` | `array` | `[RUNTIME_PARTIAL]` | Shape verified by parent claim §8.4: **`[ { "mediaId": "<uuid>", "imageUsageType": "IMAGE_USAGE_TYPE_ASSET" } ]`** *(Disproved: `[ { "name": "..." } ]`)* |
| `videoInput` | `requests[]` | `object` | `[RUNTIME_PARTIAL]` | Shape verified by parent claim §8.5: **`{ "mediaId": "<uuid>" }`** *(Disproved: `{ "name": "..." }`)* |
| `imageBytes` | Root | `string` | `[RUNTIME_PARTIAL]` | Shape verified by parent claim §6.1: **Raw Base64 string** *(Disproved: `encodedImage`)* |

---

## 10. CHARACTER & LIKENESS API `[RUNTIME_PARTIAL]`

### 10.1 Likeness Eligibility Check `[RUNTIME_VERIFIED]`
<!-- claim_id: likeness_eligibility_check -->
- **Endpoint:** `GET https://aisandbox-pa.googleapis.com/v1/flow/likeness:checkEligibility`
- **Fixture:** `evidence/likeness/eligibility_response.json`
- **Observed response:** `{ "eligible": true }`.

### 10.2 List User Likenesses `[RUNTIME_VERIFIED]`
<!-- claim_id: list_user_likenesses -->
- **Endpoint:** `GET https://aisandbox-pa.googleapis.com/v1/flow/likeness:listUserLikenesses?populateImage=true`
- **Fixture:** `evidence/likeness/list_response.json`

### 10.3 Assign Image to Character Slot (`flow:copyProjectMedia`) `[RUNTIME_VERIFIED]`
<!-- claim_id: character_copy_project_media -->
- **Endpoint:** `POST https://aisandbox-pa.googleapis.com/v1/flow:copyProjectMedia`
- **Request schema (runtime captured from Flow UI):**
  ```json
  {
    "mediaId": "<media_uuid>",
    "destinationProjectId": "<project_uuid>",
    "destinationMediaContext": {
      "entityContext": {
        "entityId": "<character_uuid>",
        "characterSlot": {
          "imageReferenceIndex": 1
        }
      }
    }
  }
  ```
- **Fixture:** `evidence/likeness/copy_media_request.json`
- **Purpose:** Gán một media (ảnh) vào slot `imageReferenceIndex` của một Character (`entityId`). Đây là bước khởi tạo nội dung nhân vật từ ảnh sẵn có trong project.
- **Note:** Nội dung nhân vật sau đó được sinh ra qua `POST /v1/projects/{projectId}/flowMedia:batchGenerateImages` (model Nano Banana 2 / NARWHAL).

### 10.4 Character Creation & Likeness Generation Surface `[RUNTIME_PARTIAL]`
- **UI Route:** `https://labs.google/fx/vi/tools/flow/project/{projectId}/characters`
- **UI Behavior:** Creating a character in the Flow web UI dispatches `POST /v1/projects/{id}/flowMedia:batchGenerateImages` using `Nano Banana 2` with workflow metadata (`displayName`, `primaryMediaId`).
- **Limitation:** The current Google Flow web UI does not expose a dedicated `createLikeness` API button. Eligibility and list endpoints are verified; full likeness creation endpoint remains `[RUNTIME_PARTIAL]`.

---

## 11. MODEL REGISTRY (FULL 82 ACTIVE MODELS)

- **Full Registry:** `model_registry/normalized_registry.json`
- **Snapshot:** `snapshots/2026-08-27/normalized_registry.json` (82 active usageKey entries).
- **Omni 1.1 Flash (added 2026-08-30):** Model key `omni_1_1_flash` / `veo_omni_flash_10s` — 10s clip @ 15 credits, H264+AAC (native audio), 16:9/9:16/1:1 @ 720p. Rẻ hơn Veo 3.1, phù hợp pipeline phim nhiều cảnh. Verify credit delta: 15 credits deducted per 10s clip.

---

## 12. CREDIT & BILLING LIFECYCLE

- **Balance Sequence:** $1050 \to 1038 (-12) \to 1023 (-15) \to 1003 (-20) \to 983 (-20)$ credits.
- Deductions match exact model pricing tables.

---

## 13. POLLING STATE MACHINE

- **Endpoint:** `POST https://aisandbox-pa.googleapis.com/v1/video:batchCheckAsyncVideoGenerationStatus`
- **Fixture:** `evidence/polling/poll_final.json`
- **State Transition:** `MEDIA_GENERATION_STATUS_ACTIVE` → `MEDIA_GENERATION_STATUS_SUCCESSFUL` verified in 10s.

---

## 14. CANCEL GENERATION `[RUNTIME_PARTIAL]`

- **Endpoint:** `POST https://aisandbox-pa.googleapis.com/v1/flowMedia:cancelGeneration`
- **Fixture:** `evidence/cancel/request.json`, `evidence/cancel/response.json`, `evidence/cancel/notes.md`
- **Verified Payload Shape:** `{ "mediaId": "<media_id>" }` *(Disproved: `{ "name": "..." }`)*.
- **Runtime Evidence:** Calling cancelGeneration on completed or active media returns HTTP 400 `FAILED_PRECONDITION` (`PUBLIC_ERROR_MEDIA_GENERATION_CANNOT_BE_CANCELED` / `Precondition check failed.`). The backend enforces non-cancellation once scheduled; endpoint is accurately documented as `[RUNTIME_PARTIAL]` with verified field schema.

---

## 15. DOWNLOAD PIPELINE `[RUNTIME_VERIFIED]`
<!-- claim_id: download_cdn_redirect -->
- **Endpoint:** `GET https://labs.google/fx/api/trpc/media.getMediaUrlRedirect?name={mediaId}`
- **Fixture:** `evidence/download/request.json`, `evidence/download/response.json`
- **Lifecycle:** HTTP 307 Temporary Redirect → Direct Signed CDN URL (`https://flow-content.google/video/{mediaId}?Expires=...`) → `video/mp4` binary stream. 4 verified MP4 files (~24.5 MB total) downloaded to disk.

---

## 16. FULL 59 PUBLIC_ERROR_* TAXONOMY CATALOGUE

Full 59 public error codes extracted from frontend bundle (`PUBLIC_ERROR_*`).

---

## 17. CREATION AGENT SSE

- **Endpoint:** `POST https://aisandbox-pa.googleapis.com/v1/flowCreationAgent:streamChat?alt=sse`
- **Sessions Endpoint:** `POST https://aisandbox-pa.googleapis.com/v1/flowCreationAgent/sessions` (HTTP 200 OK verified).

---

## 18. PYTHON SDK V2

Implementation lives in `sdk/client.py`. Verified properties:
- `AuthManager`, `Poller`, `DownloadClient`, `ModelResolver`
- Dedicated `VideoTextClient`
- Verified dynamic signatures for `generate_video()`
- `BrowserOverlayClient` for local Chrome/CDP UI hygiene before Flow UI automation.
- `GoogleFlowClient.dismiss_flow_overlays()` closes only visible onboarding/changelog/modal controls from a safe allowlist (`Bắt đầu`, `Đóng`, `Got it`, `Continue`, `Skip`, etc.).
- The overlay helper has an explicit denylist for reCAPTCHA/security/verification/payment UI and does **not** bypass or interact with those controls.

### 18.1 Local Browser Overlay Helper

This is a **local browser automation helper**, not a Google Flow backend endpoint.

```python
result = client.dismiss_flow_overlays()
# {"clicked": ["Bắt đầu"], "url": "https://labs.google/fx/...", "title": "Google Flow ..."}
```

Requirements: an authorized Chrome instance with CDP enabled on `127.0.0.1:9222` (default). The helper scopes clicks to visible overlay/dialog/fixed-position UI and returns the labels it dismissed.

### 18.2 Browser-Live Verification Matrix (2026-08-28)

The browser-live suite keeps OAuth/session/reCAPTCHA material inside the authorized Chrome context and returns only sanitized status/schema/media metadata.

| Case | Runtime result | Evidence interpretation |
|---|---|---|
| Auth session | PASS | HTTP 200; access token/user/expiry presence verified without exporting secret values |
| Credits | PASS | HTTP 200; live balance/tier schema observed |
| Image upload | PASS | HTTP 200; real media ID returned |
| Invalid reCAPTCHA negative control | PASS | HTTP 403 `PERMISSION_DENIED` / `reCAPTCHA evaluation failed` |
| T2V | PASS | Direct `batchAsyncGenerateVideoText` HTTP 200 + terminal SUCCESS |
| T2V credit delta | PASS | Positive credit deduction observed after generation |
| I2V | PASS | Direct `batchAsyncGenerateVideoStartImage` HTTP 200 + terminal SUCCESS |
| Interpolation | PASS independently | Direct `batchAsyncGenerateVideoStartAndEndImage` HTTP 200 + terminal SUCCESS; full-suite run later hit CDP/WebSocket transport timeout |
| Reference Images | PASS independently | Direct `batchAsyncGenerateVideoReferenceImages` HTTP 200 + terminal SUCCESS; strict persisted artifact fixture still pending |
| Edit/Extend | PASS in direct runtime probe | `batchAsyncGenerateVideoEditVideo` HTTP 200 + terminal SUCCESS; `workflowId` confirmed to map directly to `/edit/{workflowId}` |
| Download | PASS | 307 redirect → `flow-content.google` → 200/206 `video/mp4` |
| Cancel active | NOT VERIFIED | Immediate cancel attempt returned 400 `FAILED_PRECONDITION`; success is not claimed |

**Harness note:** a full 12-case sequential run most recently reached 8 PASS / 4 FAIL because the later tests hit `WebSocketTimeoutException` in CDP transport. Those transport failures do not replace the independent successful endpoint evidence listed above. The helper default evaluate timeout has been increased from 30s to 90s to reduce this long-run flakiness.

---

## 19. 2.0.0 VERIFICATION CLOSURE STATUS (THE 7 GATES)

- **GATE 1 — MEDIA INGESTION:** Image Upload verified (HTTP 200 + `imageBytes`).
- **GATE 2 — IMAGE ADVANCED:** Direct T2I is runtime-verified with sanitized request/response plus a persisted JPEG artifact. Transform and Image Upsample remain explicitly partial/disproved-current-hypothesis where applicable.
- **GATE 3 — VIDEO ADVANCED:** T2V, I2V, Interpolation, Reference Images and Extend/Edit have strict runtime evidence with successful persisted video outputs. Video Upsample remains partial.
- **GATE 4 — LIKENESS / AUDIO:** Likeness Eligibility & List verified; broader character/likeness creation surface remains partial.
- **GATE 5 — LIFECYCLE:** Active polling and 307 signed-CDN download verified. Cancel-active success remains unverified after backend `FAILED_PRECONDITION`.
- **GATE 6 — EVIDENCE:** 13 strict `[RUNTIME_VERIFIED]` claim IDs are backed by semantic fixtures, 5 persisted MP4 artifacts (~25.2 MB), and 1 persisted T2I JPEG artifact (85,292 bytes).
- **GATE 7 — AUTOMATION:** Core offline regression is 78/78 PASS. Browser-live cases are individually validated as shown in §18.2; long sequential CDP execution still has transport-level flakiness.

---

## 20. KNOWN UNKNOWNS & DISPROVED HYPOTHESES SUMMARY

1. **`[DISPROVED]` `startImage.name` / `endImage.name` / `referenceImages[].name` / `videoInput.name`:** Backend returned HTTP 400 `Unknown field name`. Successful I2V, interpolation, Reference Images and edit flows verify media references through `mediaId`; the Reference request additionally carried `imageUsageType: "IMAGE_USAGE_TYPE_ASSET"`.
2. **`[DISPROVED]` `encodedImage` inline Base64:** Backend returned HTTP 400 `Unknown field encodedImage`. **Verified field shape is `imageBytes: "<raw_base64>"`**.
3. **`[DISPROVED]` `cancelGeneration` `name`/`projectId`:** Backend returned HTTP 400 `Unknown field name`. **Verified field shape is `{ "mediaId": "<uuid>" }`**.
4. **Video Upsample success artifact:** Request shape/model registry information is known, but a complete successful runtime artifact chain has not been persisted.
5. **Cancel ACTIVE semantics:** Immediate cancel attempts returned `FAILED_PRECONDITION`; no successful cancellation of an ACTIVE generation is claimed.
6. **Long sequential Browser/CDP harness:** Independent generation cases succeed, while a full long-running sequence can still hit CDP/WebSocket transport timeouts. This is tracked as automation-harness flakiness, not silently reclassified as API failure.
