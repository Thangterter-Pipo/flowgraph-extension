# BÁO CÁO TIẾN ĐỘ — RUNTIME CAPTURE PHASE 1 HOÀN THÀNH

**Date:** 2026-08-27  
**Document Version:** 2.0.0-RC2 (nâng cấp theo runtime capture)  
**Verification Status:** PARTIALLY_RUNTIME_VERIFIED (runtime completeness tăng từ ~50% lên ~85%)

---

## 🏆 4 PIPELINE VIDEO ĐÃ RUNTIME-VERIFIED VỚI MP4 THẬT TRÊN ĐĨA

| # | Pipeline | Endpoint | HTTP | Credits | MP4 File | Size |
|---|---|---|---|---|---|---|
| 1 | **Image Upload** | `POST /v1/flow/uploadImage` | 200 OK | 0 | Photo on UI | — |
| 2 | **Text-to-Video** | `POST /v1/video:batchAsyncGenerateVideoText` | 200 OK | 12 | `verified_fox_video.mp4` | 7.7 MB |
| 3 | **Image-to-Video** | `POST /v1/video:batchAsyncGenerateVideoStartImage` | 200 OK | 15 | `i2v_verified_cd2ef7e8...mp4` | 5.8 MB |
| 4 | **Interpolation** | `POST /v1/video:batchAsyncGenerateVideoStartAndEndImage` | 200 OK | 20 | `interpolation_verified_d6e527a8...mp4` | 5.9 MB |
| 5 | **Extend/Edit** | `POST /v1/video:batchAsyncGenerateVideoEditVideo` | 200 OK | 20 | `extend_verified_9f714655...mp4` | 5.1 MB |
| 6 | **CDN Download** | `GET /fx/api/trpc/media.getMediaUrlRedirect` | 307 → CDN | 0 | 4 MP4 files | ~24.5 MB |

## 🔑 PHÁT HIỆN FIELD SHAPE CHÍNH XÁC (DISPROVED → VERIFIED)

| Giả định cũ | Phản hồi backend | Field shape verified |
|---|---|---|
| `encodedImage` | 400 Unknown field | ✅ `imageBytes` (raw base64) |
| `startImage: { "name": ... }` | 400 Unknown field | ✅ `startImage: { "mediaId": ... }` |
| `endImage: { "name": ... }` | 400 Unknown field | ✅ `endImage: { "mediaId": ... }` |
| `referenceImages[].name` | 400 Unknown field | ✅ `referenceImages: [{ "mediaId": ... }]` |
| `videoInput.name` | 400 Unknown field | ✅ `videoInput: { "mediaId": ... }` |
| `cancelGeneration` name/projectId | 400 Unknown field | ✅ `{ "mediaId": ... }` |

## 💳 CREDIT SEQUENCE VERIFIED
$1050 \to 1038 \to 1023 \to 1003 \to 983$ (Tổng 67 credits tiêu cho 4 generation thành công — khớp chính xác bảng giá model).

## ✅ AUTOMATION GATE
- `tests/test_flow.py`: **5/5 ENHANCED GUARDRAIL UNIT TESTS PASSED**
- `_ctl/verify_docs.py`: **241/241 checks OK**
- `evidence_manifest.json`: 11 `RUNTIME_VERIFIED` claims, exact set match với `claim_id` trong master.

## 📋 CÒN LẠI (Gate 2, một phần Gate 3 & 4)
- **Transform Image** — field envelope còn `[DISPROVED/UNKNOWN]`
- **Image Upsample 2K/4K** — envelope chưa verified
- **Video Upsample 1080p/4K** — chưa có HTTP 200 success
- **T2I (Text-to-Image)** — chưa bắt được 200 (chỉ 403/400)
- **Cancel Active Job** — chưa thử trên job đang chạy
- **Audio Reference** — chưa capture
