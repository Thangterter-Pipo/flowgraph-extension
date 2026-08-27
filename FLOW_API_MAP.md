# Google Flow (Veo) — Bản đồ API nội bộ

> **Tài liệu đầy đủ đã chuyển sang [docs/](docs/README.md).**
> File này giữ lại như bản ghi khảo sát ban đầu và ghi chú tự động hoá UI.
> Khi cần chi tiết endpoint, enum, bảng giá hoặc luồng gọi, đọc `docs/`:
>
> | Nội dung | File |
> |----------|------|
> | Kiến trúc, 2 host, 2 lớp API | [docs/01-overview.md](docs/01-overview.md) |
> | Xác thực, reCAPTCHA, CORS | [docs/02-auth.md](docs/02-auth.md) |
> | Toàn bộ endpoint backend | [docs/03-endpoints-aisandbox.md](docs/03-endpoints-aisandbox.md) |
> | Toàn bộ endpoint tRPC | [docs/04-endpoints-trpc.md](docs/04-endpoints-trpc.md) |
> | Luồng sinh media + code mẫu | [docs/05-generation-flows.md](docs/05-generation-flows.md) |
> | 82 usage key + bảng giá credit | [docs/06-models-pricing.md](docs/06-models-pricing.md) |
> | Enum thật | [docs/07-enums.md](docs/07-enums.md) |
> | 59 mã lỗi + cách xử lý | [docs/08-errors.md](docs/08-errors.md) |
> | Tải media | [docs/09-media-delivery.md](docs/09-media-delivery.md) |
> | Tự động hoá UI | [docs/10-ui-automation.md](docs/10-ui-automation.md) |
> | Nguồn bằng chứng | [docs/11-evidence.md](docs/11-evidence.md) |

## ĐÍNH CHÍNH quan trọng

Bản đầu của file này kết luận rằng "Flow ép mọi generation qua AGENT AI + reCAPTCHA
→ KHÔNG có API sạch". **Kết luận đó sai.** Bằng chứng đã bắt được cho thấy có
endpoint tạo video trực tiếp, không qua agent:

```text
POST /v1/video:batchAsyncGenerateVideoText   (và 10 biến thể cho i2v/r2v/extend/upsample)
POST /v1/video:batchCheckAsyncVideoGenerationStatus
POST /v1/projects/<projectId>/flowMedia:batchGenerateImages
```

Rào cản duy nhất còn lại là `recaptchaContext.token` (phải sinh trong trang), chứ
không phải agent. Số video sinh ra bằng số phần tử `requests[]`, nên đường trực
tiếp kiểm soát chi phí tốt hơn agent (agent mặc định tạo 4 video/lần).

Chi tiết ở [docs/05-generation-flows.md](docs/05-generation-flows.md).

---

> Thu thập qua CDP từ tài khoản Gemini Pro (KATA), profile debug `C:/Users/thang/chrome-gemini-cdp`.
> Ghi chú gốc bên dưới giữ nguyên; chỗ nào lệch với `docs/` thì `docs/` đúng.

## Backend
- Host: `https://aisandbox-pa.googleapis.com`
- Service thật: `google.internal.labs.aisandbox.proto.videofx.v1.VideoFxService`
- Tool nội bộ: `PINHOLE`
- Frontend: `https://labs.google/fx/vi/tools/flow/project/<projectId>`
- projectId hiện tại: `22165356-9e7d-4f1c-b5dc-6f6be0bbd8ee`

## Xác thực (auth)
- BẮT BUỘC header `Authorization: Bearer ya29....` (OAuth access token, hết hạn ~1 giờ).
- Chỉ `key=` trong URL là KHÔNG đủ → trả 401 UNAUTHENTICATED (CREDENTIALS_MISSING).
- Gọi từ ngoài page bị CORS ("Failed to fetch") → phải gọi qua backend riêng (curl/python) với header đầy đủ, KHÔNG gọi từ JS trong tab labs.google.
- Mỗi request tạo còn kèm `recaptchaContext.token` (reCAPTCHA sinh động mỗi lần) → đây là rào cản lớn nhất cho tự động hoá thuần API.

## Endpoint đã xác nhận

### 1. GET /v1/credits  (đã chạy thật, 200)
Header: `Authorization: Bearer ...`
```
GET https://aisandbox-pa.googleapis.com/v1/credits
→ {"credits":1000,"userPaygateTier":"PAYGATE_TIER_ONE","sku":"G1_TIER1",
   "serviceTier":"SERVICE_TIER_INTERMEDIATE","subscriptionCredits":1000}
```

### 2. POST /v1/flowCreationAgent:streamChat?alt=sse  (agent AI, SSE, đã chạy 200)
Đây là cửa CHÍNH để tạo video trên Flow — đi qua AGENT AI trung gian (không phải gọi Veo thẳng).
Payload:
```json
{
  "agentSessionId": "<uuid>",
  "agentClientContext": {
    "projectId": "projects/<projectId>",
    "clientSessionId": ";<timestamp>",
    "recaptchaContext": {"token":"<recaptcha>","applicationType":"RECAPTCHA_APPLICATION_TYPE_WEB"},
    "turnNumber": 1
  },
  "userMessage": {"userPrompt": {"parts": [{"text": "<PROMPT>"}]}}
}
```
Response: SSE stream các `agentMessage`:
- `thinkingEvent.thought` — agent suy luận (chọn model, aspect, số lượng)
- `response.text` — câu trả lời + hỏi xác nhận credit
- Sau khi user "Phê duyệt": trả UI component `MultipleChoice` chứa các option video:
  - `video`: "<mediaId uuid>"
  - `modelUsageKey`: "veo_3_1_t2v_fast"
  - `aspectRatio`: "9:16"

### 3. POST /v1/flow:batchLogFrontendEvents  (telemetry, 200)
Log sự kiện UI: `PROMPT_BOX_SUBMISSION`, `CREATION_AGENT_PERMISSION_RESPONSE`
(value `PERMISSION_ACTION_APPROVED`), v.v. — không cần cho việc tạo video.

### 4. PATCH /v1/projects/<projectId>/agentInfo  (200)
Cập nhật state phiên agent.

## Model video (bảng suy đoán cũ — đã thay bằng dữ liệu thật)

Bảng suy đoán ở đây đã được thay bằng danh mục thật 82 usage key kèm giá credit
theo từng service tier: [docs/06-models-pricing.md](docs/06-models-pricing.md).

Tóm tắt các họ model (`familyId`) đang hiệu lực:

| Tên hiển thị | familyId | Số usage key |
|--------------|----------|--------------|
| Omni Flash | `abra` | 13 |
| Veo 3.1 - Lite | `veo_3_1_lite` | 11 |
| Veo 3.1 - Fast | `veo_3_1_fast` | 26 |
| Veo 3.1 - Quality | `veo_3_1_quality` | 14 |
| Veo 3.1 - Lite [Lower Priority] | `veo_3_1_lite_low_priority` | 11 |
| Veo 3.1 - Upsampler 1080P / 4K | `veo_3_1_upsampler_1080p` / `_4k` | 1 + 1 |
| 🍌 Nano Banana Pro / 2 / 2 Lite | `nano_banana_pro` / `narwhal_display` / `harbor_seal` | 1 mỗi họ |

## Tham số tạo (panel Cài đặt / tune)
- Video aspect: 16:9, 9:16 (`VIDEO_ASPECT_RATIO_LANDSCAPE` / `_PORTRAIT`)
- Video số lượng: 1x / 2x / 3x / 4x — qua API là số phần tử `requests[]`
- Ảnh aspect: 16:9, 4:3, 1:1, 3:4, 9:16 (xem `IMAGE_ASPECT_RATIO_*`)
- Độ dài video: 4 / 6 / 8 giây — nằm trong tên usage key, không phải tham số riêng
- Giá: `veo_3_1_t2v_fast` = 20 credit/8s ở `SERVICE_TIER_INTERMEDIATE`.
  Giá thay đổi theo `serviceTier`, từ 0 (lite low-priority ở ADVANCED) đến 100
  (Veo 3.1 Quality). Bảng đầy đủ ở [docs/06-models-pricing.md](docs/06-models-pricing.md).

## LUỒNG DOWNLOAD (ĐÃ BẮT ĐƯỢC, tải file thật thành công ✓)

Sau khi video render xong, thẻ `<video>` trên trang có `src`:
```
https://labs.google/fx/api/trpc/media.getMediaUrlRedirect?name=<mediaId>
```
- `mediaId` = uuid video (vd `c0d23ea7-706d-4849-9b1e-cf851b8f762a`), lấy từ:
  - thẻ `<video>.src` trên DOM, HOẶC
  - SSE response của streamChat (option.video = mediaId)
- Endpoint này **302 redirect** tới CDN thật:
  `https://flow-content.google/video/<mediaId>?Expires=<ts>&KeyName=labs-flow-prod-cdn-key&Signature=<sig>`
- `fetch(redirectUrl, {redirect:"follow"})` từ page context (có cookie) → trả thẳng
  `video/mp4`. Tải qua CDP fetch→arrayBuffer→base64 ghi file OK.
- File thật: 720×1280 (9:16), H.264+AAC, 8.0s, ~3.7MB. Khớp cấu hình đã set.

### Cách poll "xong chưa" (đơn giản, đã verj,ify)
Poll DOM: `document.querySelectorAll('video').length > 0` và `video.src` chứa
`getMediaUrlRedirect` = đã xong. Trong lúc render, ô hiện `<n>%` (vd "75%").
4 ô lỗi hiện "Không thành công / Rất tiếc, đã xảy ra lỗi!" (KHÔNG bị trừ credit).

## CHI PHÍ THẬT (đã verify bằng /v1/credits trước-sau)
- Veo 3.1 Fast, 1 video 8s = **20 credit** (1000 → 980 sau 1 lần tạo thành công).
- Video FAIL = **KHÔNG trừ credit** (4 video lỗi lần đầu: credit vẫn nguyên 1000).
- Agent MẶC ĐỊNH tạo 4 video/lần (80 credit) → phải ghi rõ trong prompt
  "Generate only ONE single video (not 4)" để nó chỉ tạo 1 (20 credit).

## CÁC KHU VỰC / TAB TRONG FLOW (khảo sát đầy đủ 2026-07-09)

Sidebar (nút JS, không phải link — click bằng text):
- **Tất cả nội dung nghe nhìn** (`dashboard`) — gallery tổng, filter: Hình ảnh / Video / Giọng nói / Nhân vật / Hình đại diện / Tệp tải lên. Có search + "Sắp xếp và lọc".
- **Xem video** (`videocam`) — gallery lọc riêng video.
- **Nhân vật** (`accessibility_new`) — route `/characters`.
- **Xem các cảnh** (`movie`) — filter gallery theo cảnh.
- **Công cụ** (`apps_spark_2`) — kho tools + tạo tool riêng.
- **Thùng rác** (`delete`).

### Tab NHÂN VẬT (/characters)
"Tạo và sử dụng lại các nhân vật để video luôn NHẤT QUÁN" — chính là tính năng
giữ nhân vật đồng nhất qua mọi shot (khớp nhu cầu pipeline film3d).
- Model: **🍌 Nano Banana 2** (image model)
- Tạo bằng: prompt / **Tải lên** ảnh / **Thêm từ dự án**
- Nút "Định dạng" (personal_recommendations) chọn khung
- 6 template prompt: Kẻ lập dị, Nhân vật chuyên nghiệp, Nhân vật biến hoá,
  Nhân vật quen thuộc, Kẻ phản diện, Nhân vật kỳ ảo

### Tab CÔNG CỤ (Explore tools) — 37 tool, chia 4 nhóm + "Tạo công cụ" riêng
Có 2 chế độ: "Khám phá" (preset) / "Công cụ của tôi". Mỗi tool là 1 mini-app.
- **Hình ảnh (8):** Simple Sketch, Scene Explorer, Mockup, Image Editor,
  Shot Explorer, Mask Magic, Converge, Grid Architect
- **Video (10):** Shader Effects, Type Overlays, pixelBento, Poster Designer,
  Video Sketch, Transition Machine, Weirdcore, Video Resizer, Stringout Creator,
  Video Granulator
- **Đặt câu lệnh (5):** Character X-Ray, Style Writer, **Storyboard Studio**,
  Prompt Tree, Story Sketch  ← Storyboard Studio hữu ích cho film3d
- **Thử nghiệm (13):** Frame Deconstructor, Blob Tracking, DepthWarp 4D,
  Webcam Set, Datamosh, 3D Model Visualizer, Scout360, Ribbit, **Whisk**,
  Pose Text, 3D Face Swap
- "Tạo công cụ": tự mô tả ý tưởng → Flow sinh mini-tool.

### Scene editor
Route `/fx/vi/tools/flow/project/<projectId>/edit/<sceneId>` — trình sửa cảnh
(mỗi cảnh 1 sceneId uuid). `/scenes` trả 404 (không phải route hợp lệ).

## Model đầy đủ + dùng cho gì

Danh mục đầy đủ (82 usage key, chế độ sinh, giá theo 3 tier, giới hạn input) ở
[docs/06-models-pricing.md](docs/06-models-pricing.md). Ràng buộc khi chọn model —
theo tier, theo hướng ảnh, theo độ dài — ở
[docs/05-generation-flows.md](docs/05-generation-flows.md) mục 5.2.

## Control UI (toạ độ, cho automation CDP)
- Ô prompt: contenteditable DIV, @(931,835). Điền bằng CHAR key events (Input.dispatchKeyEvent type=char) mới enable được nút — set textContent/insertText KHÔNG đủ (nút "Tạo" giữ aria-disabled).
- Nút generate: "arrow_forward Tạo" @(1236,888)
- Nút Cài đặt (model/aspect): "tune Cài đặt" @(1199,888)
- Nút "add_2 Tạo" @(686,888) = dialog chèn media (KHÔNG phải tạo mới)
- Nút "Tác nhân" @(748,888) = chế độ agent
- Nút Phê duyệt (sau confirmation): DIV @(1678,603) — "Phê duyệt, không hỏi lại" @(1722,649), "Từ chối" @(1669,695)

## Kết luận hướng build (ĐÃ SỬA)

> Kết luận cũ ở đây ("Flow ép mọi generation qua AGENT AI → KHÔNG có API sạch")
> đã được chứng minh là sai. Xem phần ĐÍNH CHÍNH ở đầu file.

Thực tế có 2 hướng, và hướng API trực tiếp là hướng nên chọn:

1. **Gọi API trực tiếp** (khuyến nghị): `POST /v1/video:batchAsyncGenerateVideoText`
   → poll `video:batchCheckAsyncVideoGenerationStatus` → tải qua
   `media.getMediaUrlRedirect`. Không cần agent, không cần bấm Phê duyệt, chọn
   được đúng model và đúng số lượng video. Vẫn cần một browser đang mở để lấy
   `recaptchaContext.token` và `access_token`, nhưng browser chỉ làm nguồn token
   thay vì thực thi cả luồng.
2. **Automation UI qua CDP**: chỉ cần khi dùng tính năng chỉ có trên UI (applet,
   scene editor). Phụ thuộc DOM nên dễ vỡ khi Flow đổi giao diện.

Chi tiết luồng và code mẫu: [docs/05-generation-flows.md](docs/05-generation-flows.md)
và [docs/10-ui-automation.md](docs/10-ui-automation.md).

## ĐÃ BUILD & TEST THẬT (2026-07-10)
- `flow_veo.py` — FlowClient + CLI (gen/credits/status). Test: video 720×1280 8s
  H.264+AAC 24fps, credit trừ đúng 20/lần. Auto-approve DOM-click OK.
- `flow_character.py` — CharacterClient. Test: char_nam.jpg 1376×768, credit KHÔNG
  đổi → tạo nhân vật MIỄN PHÍ (Nano Banana 2).
- Tích hợp film3d: `media/video.py::_flow_video()` + `make_clip(video_prompt=)`,
  bật `FILM3D_VIDEO_PROVIDER=flow`. Test end-to-end: S99_e2e.mp4 cắt đúng 6s.
- Skill: `automation/google-flow-veo-cdp-automation` (đủ pitfalls).
- 4 pitfall chính: (1) prompt char events; (2) nút Tạo là BUTTON 32px không phải
  DIV bao ngoài; (3) Phê duyệt phải DOM-click vì y ÂM; (4) kết quả CHỈ hiện sau reload.
