# 3. Endpoint backend `aisandbox-pa.googleapis.com`

Base: `https://aisandbox-pa.googleapis.com`
Auth: `Authorization: Bearer ya29...` cho mọi endpoint trong file này.

Mục lục:

- 3.1 Tài khoản và cấu hình
- 3.2 Project
- 3.3 Sinh ảnh
- 3.4 Sinh video
- 3.5 Poll trạng thái và huỷ
- 3.6 Workflow, scene, collection
- 3.7 Upload và biến đổi media
- 3.8 Nhân vật (likeness / characters)
- 3.9 Creation agent (SSE)
- 3.10 Applet (tab Công cụ)
- 3.11 Telemetry

---

## 3.1 Tài khoản và cấu hình

### `GET /v1/credits`  `[VERIFIED]` 200

Số credit còn lại và bậc dịch vụ. Không tính phí.

```json
{
  "credits": "int",
  "userPaygateTier": "str (enum PAYGATE_TIER_*)",
  "sku": "str",
  "serviceTier": "str (enum SERVICE_TIER_*)",
  "subscriptionCredits": "int"
}
```

`serviceTier` là khoá để tra bảng giá: chi phí credit của cùng một model khác nhau
giữa `SERVICE_TIER_ENTRY`, `INTERMEDIATE`, `ADVANCED`. Xem
[06-models-pricing.md](06-models-pricing.md).

Dùng endpoint này trước và sau mỗi lần sinh để đo chi phí thật.

### `POST /v1:checkAppAvailability`  `[VERIFIED]` 200

```json
// request
{ "clientContext": { "tool": "PINHOLE" } }
// response
{ "availabilityState": "str" }
```

### `GET /v1/flow/appConfig`  `[VERIFIED]` 200

Feature flag toàn cục. Quyết định tính năng nào bật cho tài khoản hiện tại.

| Field | Kiểu | Ý nghĩa |
|-------|------|---------|
| `changeLogId` | `str` | ID changelog hiện tại; so với `userSettings.lastAcknowledgedChangeLogId` |
| `siteContent.banners[]` | `list` | Banner trong app: `id`, `headline`, `caption`, `ctaText`, `ctaClickBehavior`, `imageUri`, `ctaFeature`, `isDismissable` |
| `isFreeTierEnabled` | `bool` | Bậc miễn phí có bật |
| `isFlowImageEnabled` | `bool` | Cho sinh ảnh trong Flow |
| `isGemPixProEnabled` | `bool` | Bật Nano Banana Pro (`GEM_PIX_2`) |
| `isObjectRemovalEnabled` | `bool` | Bật xoá vật thể |
| `imageUpsamplerMinTimeSeconds` | `str` | Thời gian tối thiểu cho upsample ảnh |
| `isFlowUpsamplingEnabled` | `bool` | Bật upsample video (1080p/4K) |
| `isAudioPresetsEnabled` | `bool` | Bật preset âm thanh |
| `isPricingPageEnabled` | `bool` | Hiện trang giá |
| `isAdEnabled` | `bool` | Quảng cáo |
| `onboardingGuideVersion` | `str` | Phiên bản hướng dẫn |
| `isReturnSilentVideosEnabled` | `bool` | Trả video không tiếng |
| `isImageFxAndWhiskDeprecationEnabled` | `bool` | Có đánh dấu ImageFX/Whisk là cũ |
| `activeExperimentIds` | `int[]` | Danh sách experiment đang bật (mẫu: 43 phần tử) |
| `isAbraEnabled` | `bool` | Bật họ model `abra` (Omni Flash) |
| `onboardingVideoModelId` | `str` | Model video mặc định khi onboard |
| `isFlowRemovedFromFxBannerEnabled` | `bool` | Banner chuyển đổi |
| `isNewCreditsUiEnabled` | `bool` | UI credit mới |
| `agentModeDefaultState` | `str` | Trạng thái agent mặc định (enum `AGENT_TOGGLE_STATE_*`) |
| `zeroStatePromptsDefaultMode` | `str` | Chế độ prompt gợi ý |
| `isWatermarkForceEnabled` | `bool` | Bắt buộc watermark |
| `isRegionSupported` | `bool` | Khu vực được hỗ trợ |
| `isAgeSupported` | `bool` | Độ tuổi đủ điều kiện |
| `isYoutubePublishEnabled` | `bool` | Cho đăng trực tiếp lên YouTube |

`isRegionSupported` và `isAgeSupported` là hai cờ cần kiểm tra trước: nếu `false`,
mọi request sinh media sẽ thất bại với `PUBLIC_ERROR_USER_REGION_DISALLOWED` hoặc
`PUBLIC_ERROR_USER_MINOR`.

### `GET /v1/flow/models/statuses`  `[VERIFIED]` 200

```json
{ "modelStatus": [ { "modelKey": "str", "status": "str" } ] }
```

Mẫu quan sát: 4 phần tử. Dùng để bỏ qua model đang quá tải trước khi gửi request,
tránh lỗi `PUBLIC_ERROR_MODEL_DISABLED_DUE_TO_TRAFFIC`.

### `GET /v1/flow/userSettings`  `[VERIFIED]` 200

```json
{
  "lastAcknowledgedChangeLogId": "str",
  "completedOnboardingIds": ["str"],
  "isAgentModeToggled": "bool",
  "isChatPanelOpen": "bool"
}
```

`isAgentModeToggled` cho biết UI đang ở đường agent hay đường trực tiếp.

### `POST /v1:fetchUserRecommendations`  `[VERIFIED]` 200

```json
// request
{ "onramp": ["str", "..."] }   // mẫu: 6 phần tử
// response
{}                              // rỗng với tài khoản đã onboard
```

---

## 3.2 Project

### `PATCH /v1/projects/<projectId>`  `[VERIFIED]` 200

Query: `clientContext.tool=PINHOLE`, `updateMask=projectTitle`

```json
// request
{ "projectTitle": "str" }
// response
{ "projectTitle": "str" }
```

### `PATCH /v1/projects/<projectId>/agentInfo`  `[VERIFIED]` 200

Query: `updateMask=agentToggleState`

```json
// request
{ "agentToggleState": "AGENT_TOGGLE_STATE_ENABLED | AGENT_TOGGLE_STATE_DISABLED" }
// response
{ "agentInfo": { "agentToggleState": "str" } }
```

Đây là công tắc chuyển giữa đường agent và đường trực tiếp.

### `GET /v1/flow/projects/...`  `[BUNDLE]`

Có trong bundle nhưng chưa bắt được lưu lượng. Việc đọc project trong thực tế đi qua
tRPC `flow.projectInitialData` — xem [04-endpoints-trpc.md](04-endpoints-trpc.md).

---

## 3.3 Sinh ảnh

### `POST /v1/projects/<projectId>/flowMedia:batchGenerateImages`  `[VERIFIED]` 200

**Đồng bộ** — response trả về ảnh đã xong kèm URL và kích thước.

Request:

```json
{
  "clientContext": {
    "recaptchaContext": { "token": "str", "applicationType": "RECAPTCHA_APPLICATION_TYPE_WEB" },
    "projectId": "str<uuid>",
    "tool": "PINHOLE",
    "sessionId": "str"
  },
  "mediaGenerationContext": { "batchId": "str<uuid>" },
  "useNewMedia": true,
  "requests": [
    {
      "clientContext": { "...": "lặp lại y nguyên clientContext ở trên" },
      "imageModelName": "str",
      "imageAspectRatio": "IMAGE_ASPECT_RATIO_*",
      "structuredPrompt": { "parts": [ { "text": "str" } ] },
      "seed": "int",
      "imageInputs": []
    }
  ]
}
```

Lưu ý về hình dạng request: `clientContext` xuất hiện **hai lần** — một ở cấp ngoài
và một lần nữa trong từng phần tử `requests[]`. Lưu lượng thật lặp lại nguyên vẹn cả
`recaptchaContext.token`. `batchId` là UUID do client tự sinh.

`imageModelName` nhận usage key của model ảnh, không phải tên hiển thị:
`NARWHAL` (Nano Banana 2), `GEM_PIX_2` (Nano Banana Pro), `HARBOR_SEAL`
(Nano Banana 2 Lite). Xem [06-models-pricing.md](06-models-pricing.md).

Response:

```json
{
  "media": [
    {
      "name": "str<uuid>",
      "workflowId": "str<uuid>",
      "image": {
        "generatedImage": {
          "seed": "int",
          "mediaGenerationId": "str",
          "mediaVisibility": "str",
          "prompt": "str",
          "modelNameType": "str",
          "workflowId": "str<uuid>",
          "fifeUrl": "str<url>",
          "aspectRatio": "IMAGE_ASPECT_RATIO_*",
          "requestData": { "promptInputs": [ "..." ], "imageGenerationRequestData": {} },
          "mediaId": "str<uuid>"
        },
        "dimensions": { "width": "int", "height": "int" }
      }
    }
  ],
  "workflows": [
    {
      "name": "str<uuid>",
      "metadata": {
        "displayName": "str",
        "createTime": "str<ISO-8601>",
        "primaryMediaId": "str<uuid>",
        "batchId": "str<uuid>",
        "updateTime": "str<ISO-8601>"
      },
      "projectId": "str<uuid>"
    }
  ]
}
```

`fifeUrl` là URL ảnh dùng được ngay (không cần qua bước redirect như video).

Chi phí: theo bảng giá, mọi model ảnh có `cost: 0` ở cả ba service tier — nghĩa là
sinh ảnh và tạo nhân vật không trừ credit. Riêng upsample 4K
(`GEM_PIX_2_UPSAMPLE_4K`) chỉ có ở `SERVICE_TIER_ADVANCED`.

---

## 3.4 Sinh video

Tất cả là **không đồng bộ**, dùng chung tiền tố
`POST /v1/video:batchAsyncGenerateVideo*` và trả về cùng hình dạng response.

| Endpoint | Mục đích | Field input | Bằng chứng |
|----------|----------|-------------|------------|
| `video:batchAsyncGenerateVideoText` | Text-to-video | `textInput` | `[VERIFIED]` 200 |
| `video:batchAsyncGenerateVideoStartImage` | Image-to-video (ảnh đầu) | `startImage` | `[VERIFIED]` 403 |
| `video:batchAsyncGenerateVideoStartAndEndImage` | Nội suy giữa ảnh đầu và ảnh cuối | `startImage` + `endImage` | `[VERIFIED]` 403 |
| `video:batchAsyncGenerateVideoReferenceImages` | Reference-to-video (3-7 ảnh) | `referenceImages[]` | `[VERIFIED]` 400 |
| `video:batchAsyncGenerateVideoExtendVideo` | Kéo dài video sẵn có | `videoInput` | `[VERIFIED]` 400/403 |
| `video:batchAsyncGenerateVideoEditVideo` | Sửa video (`abra_edit`) | `videoInput` | `[VERIFIED]` 400 |
| `video:batchAsyncGenerateVideoUpsampleVideo` | Nâng cấp 1080p / 4K | `videoInput` | `[VERIFIED]` 403 |
| `video:batchAsyncGenerateVideoCameraControl` | Điều khiển camera | — | `[BUNDLE]`, đã ngừng hoạt động |
| `video:batchAsyncGenerateVideoReshootVideo` | Quay lại cảnh | — | `[BUNDLE]`, đã ngừng hoạt động |
| `video:batchAsyncGenerateVideoObjectInsertion` | Chèn vật thể | — | `[BUNDLE]`, đã ngừng hoạt động |
| `video:batchAsyncGenerateVideoObjectRemoval` | Xoá vật thể | — | `[BUNDLE]`, đã ngừng hoạt động |

Bốn endpoint cuối tương ứng với các usage key `veo_2_*` / `veo_3_0_reshoot_*` hiện
nằm trong `deprecatedModelKeys`. Khi gọi thử, chúng không trả về response nào (request
bị chặn ở tầng preflight), khác với bảy endpoint trên đều trả status rõ ràng — dấu hiệu
chúng đã bị tháo khỏi backend.

### Xác nhận field input của từng biến thể  `[VERIFIED]`

Bảy endpoint đang hoạt động dùng chung envelope của `...VideoText` (mục ngay dưới);
chỉ trường input trong `requests[]` khác nhau. Tên trường được xác nhận bằng cách gửi
payload với reCAPTCHA token giả và đọc phản hồi:

- Status **403 `reCAPTCHA evaluation failed`** nghĩa là payload đã parse xong và mọi
  tên trường hợp lệ; request chỉ dừng ở bước xác thực reCAPTCHA. Đây là bằng chứng
  trường đúng.
- Status **400 `Unknown name "X"`** nghĩa là trường `X` không tồn tại.

Kết quả đã dò:

```text
startImage           -> 403  (đúng)
image                -> 400 Unknown name
imageInput           -> 400 Unknown name
imageMediaInput      -> 400 Unknown name
startImageInput      -> 400 Unknown name
mediaInput           -> 400 Unknown name
startMedia           -> 400 Unknown name
```

Phần tử của `videoInput` là `{ "mediaId": "<uuid>" }` (403), còn `{"name": ...}` và
`{"mediaGenerationId": ...}` đều trả 400.

Riêng `referenceImages[]` chưa xác định được hình dạng phần tử. Backend gọi nó là
`requests[0].reference_images[0]` nhưng từ chối `mediaId`, `assetId`, `imageId`,
`name`, `fifeUrl`, `encodedImage`, `mediaGenerationId`, `media`, `image`,
`imageInput`, `startImage`, và `referenceImageType`. Bundle có enum
`REFERENCE_IMAGE_TYPE_UNSPECIFIED | _CONTEXT | _STYLE` nhưng chưa rõ nó nằm ở đâu
trong phần tử. Cần bắt một request thật từ UI để chốt.

### `POST /v1/video:batchAsyncGenerateVideoText`  `[VERIFIED]` 200

Request:

```json
{
  "mediaGenerationContext": {
    "batchId": "str<uuid>",
    "audioFailurePreference": "AUDIO_FAILURE_PREFERENCE_UNSPECIFIED"
  },
  "clientContext": {
    "projectId": "str<uuid>",
    "tool": "PINHOLE",
    "userPaygateTier": "PAYGATE_TIER_*",
    "sessionId": "str",
    "recaptchaContext": { "token": "str", "applicationType": "RECAPTCHA_APPLICATION_TYPE_WEB" }
  },
  "requests": [
    {
      "aspectRatio": "VIDEO_ASPECT_RATIO_LANDSCAPE | VIDEO_ASPECT_RATIO_PORTRAIT",
      "textInput": { "structuredPrompt": { "parts": [ { "text": "str" } ] } },
      "videoModelKey": "str",
      "seed": "int",
      "metadata": {}
    }
  ],
  "useV2ModelConfig": true
}
```

Điểm khác biệt so với sinh ảnh: `clientContext` chỉ xuất hiện **một lần** ở cấp
ngoài, và có thêm `userPaygateTier` (lấy từ `GET /v1/credits`).

Số lượng video sinh ra bằng số phần tử trong `requests[]`. Muốn đúng 1 video thì đặt
đúng 1 phần tử. Đây là cách kiểm soát chi phí chắc chắn hơn so với đường agent
(agent mặc định tạo 4).

`videoModelKey` phải là usage key hợp lệ với aspect ratio tương ứng. Nhiều key bị
ràng buộc hướng: `veo_3_1_t2v_fast` chỉ `LANDSCAPE`, `veo_3_1_t2v_fast_portrait` chỉ
`PORTRAIT`. Chọn sai cặp sẽ không hợp lệ.

Response:

```json
{
  "remainingCredits": "int",
  "workflows": [
    { "name": "str<uuid>", "metadata": { "displayName": "str", "createTime": "str",
      "primaryMediaId": "str<uuid>", "batchId": "str<uuid>", "updateTime": "str" },
      "projectId": "str<uuid>" }
  ],
  "media": [
    {
      "name": "str<uuid>",
      "projectId": "str<uuid>",
      "workflowId": "str<uuid>",
      "workflowStepId": "str",
      "mediaMetadata": {
        "createTime": "str<ISO-8601>",
        "mediaTitle": "str",
        "requestData": {
          "videoGenerationRequestData": {
            "videoModelControlInput": {
              "videoModelName": "str",
              "videoGenerationMode": "VIDEO_GENERATION_MODE_*",
              "videoAspectRatio": "VIDEO_ASPECT_RATIO_*",
              "videoResolution": "VIDEO_RESOLUTION_*"
            }
          },
          "promptInputs": [ { "structuredPrompt": "..." } ],
          "clientPlatform": "CLIENT_PLATFORM_WEB"
        },
        "mediaStatus": { "mediaGenerationStatus": "MEDIA_GENERATION_STATUS_*" },
        "visibility": "str"
      },
      "video": {
        "generatedVideo": {
          "seed": "int",
          "prompt": "str",
          "model": "str",
          "baseImageMediaGenerationId": "str",
          "isLooped": "bool",
          "aspectRatio": "VIDEO_ASPECT_RATIO_*"
        },
        "dimensions": { "length": "str" }
      }
    }
  ]
}
```

`remainingCredits` là cách rẻ nhất để biết chi phí thật: số này đã trừ phí cho lần
gọi vừa rồi, không cần gọi lại `/v1/credits`.

Lưu `media[].name` và `media[].projectId` — đây là cặp khoá để poll ở bước sau.

### Schema chung của `videoGenerationRequestData`  `[BUNDLE]`

Bundle chứa validator (zod) cho `videoGenerationRequestData`, tức là khuôn dữ liệu
dùng chung cho **mọi** biến thể sinh video. Đây là cách suy ra tên field của 10
endpoint chưa bắt được lưu lượng.

```jsonc
{
  "videoGenerationRequestData": {
    "videoModelControlInput": {          // model, chế độ, aspect ratio, resolution
      "videoModelName": "str",
      "videoGenerationMode": "VIDEO_GENERATION_MODE_*",
      "videoAspectRatio": "VIDEO_ASPECT_RATIO_*",
      "videoResolution": "VIDEO_RESOLUTION_*"
    },
    "videoGenerationImageInputs":   [],  // ảnh đầu / ảnh cuối / ảnh tham chiếu
    "videoGenerationVideoInputs":   [],  // video nguồn: extend, edit, upsample
    "videoGenerationAudioInputs":   [],  // tham chiếu âm thanh
    "videoGenerationEntityInputs":  [],  // thực thể trong project
    "videoGenerationLikenessInputs":[],  // nhân vật (likeness)
    "videoGenerationCameraControlInput": {},  // điều khiển camera
    "videoGenerationOrigin": "VIDEO_GENERATION_ORIGIN_*",
    "reshootMotionType": "RESHOOT_MOTION_TYPE_*"
  },
  "promptInputs": [ { "structuredPrompt": {}, "textInput": {}, "expandedTextInput": {} } ],
  "clientPlatform": "CLIENT_PLATFORM_WEB"
}
```

Ánh xạ từ chế độ sang field input:

| Chế độ | Endpoint | Field input |
|--------|----------|-------------|
| Text-to-video | `...VideoText` | chỉ `textInput` |
| Image-to-video | `...VideoStartImage` | `videoGenerationImageInputs` (ảnh đầu) |
| Nội suy đầu-cuối | `...VideoStartAndEndImage` | `videoGenerationImageInputs` (`startImage` + `endImage`) |
| Reference-to-video | `...VideoReferenceImages` | `videoGenerationImageInputs` (`referenceImages`) + tuỳ chọn `videoGenerationLikenessInputs`, `videoGenerationAudioInputs` |
| Kéo dài | `...VideoExtendVideo` | `videoGenerationVideoInputs` |
| Sửa video | `...VideoEditVideo` | `videoGenerationVideoInputs` + `videoGenerationOrigin: ..._EDIT` |
| Upsample | `...VideoUpsampleVideo` | `videoGenerationVideoInputs` |
| Chèn / xoá vật thể | `...VideoObjectInsertion` / `...ObjectRemoval` | `videoGenerationOrigin: ..._INSERTION` / `..._REMOVAL` |
| Reshoot | `...VideoReshootVideo` | `reshootMotionType` + `videoGenerationOrigin: ..._RESHOOT` |

Các tên literal `startImage`, `endImage`, `referenceImages`, `videoInput`, `imageInput`
đều tồn tại trong bundle, nhưng cấu trúc lồng chính xác bên trong từng
`*Inputs[]` chưa được bắt trong lưu lượng thật — chỗ này vẫn là suy diễn có cơ sở,
không phải `[VERIFIED]`.

Enum kèm theo ở [07-enums.md](07-enums.md) mục 7.16 và 7.17.

---

## 3.5 Poll trạng thái và huỷ

### `POST /v1/video:batchCheckAsyncVideoGenerationStatus`  `[VERIFIED]` 200

```json
// request
{ "media": [ { "name": "str<uuid>", "projectId": "str<uuid>" } ] }
```

Response giống hình dạng `media[]` của endpoint sinh video, cộng thêm:

```json
"video": { "operation": { "name": "str<uuid>" } }
```

Trạng thái đọc từ `mediaMetadata.mediaStatus.mediaGenerationStatus`. Các giá trị kết
thúc: `MEDIA_GENERATION_STATUS_SUCCESSFUL`, `..._COMPLETE`, `..._FAILED`,
`..._CANCELED`. Các giá trị đang chạy: `..._PENDING`, `..._SCHEDULED`,
`..._IN_PROGRESS`, `..._ACTIVE`. Xem [07-enums.md](07-enums.md).

Nhịp poll hợp lý: theo `generationTimeSeconds` của model (100-330 giây tuỳ model),
poll mỗi 5-10 giây, timeout ít nhất 2 lần thời gian dự kiến.

Endpoint này nhận nhiều media một lượt — poll cả batch bằng một request.

### `POST /v1/flowMedia:cancelGeneration`  `[VERIFIED]` 400

Huỷ một lần sinh đang chạy. Lỗi liên quan:
`PUBLIC_ERROR_MEDIA_GENERATION_CANNOT_BE_CANCELED`.

---

## 3.6 Workflow, scene, collection

### `PATCH /v1/flowWorkflows/<workflowId>`  `[VERIFIED]` 200

```json
// request
{
  "workflow": {
    "name": "str<uuid>",
    "projectId": "str<uuid>",
    "metadata": { "primaryMediaId": "str<uuid>" }
  },
  "updateMask": "metadata.primaryMediaId"
}
// response
{
  "name": "str<uuid>",
  "metadata": { "displayName": "str", "createTime": "str",
    "primaryMediaId": "str<uuid>", "batchId": "str<uuid>", "updateTime": "str" },
  "projectId": "str<uuid>"
}
```

Dùng khi một batch tạo nhiều media và cần chọn cái nào là bản đại diện.

### Các endpoint còn lại

| Endpoint | Mục đích | Bằng chứng |
|----------|----------|------------|
| `GET/PATCH /v1/flowWorkflows/<id>` | Đọc / sửa workflow | `[VERIFIED]` 200 |
| `POST /v1/flow:copyWorkflow` | Nhân bản workflow | `[VERIFIED]` 400 |
| `GET /v1/flow/scene/<sceneId>` | Đọc scene | `[VERIFIED]` 404 |
| `POST /v1/flow/scene:addWorkflowsToScene` | Thêm workflow vào scene | `[VERIFIED]` 200 |
| `POST /v1/flow/scene/sceneWorkflows:update` | Cập nhật thứ tự workflow trong scene | `[VERIFIED]` 400 |
| `POST /v1/flow/scene:copyScene` | Nhân bản scene | `[VERIFIED]` 404 |
| `GET /v1/flowCollections/<id>` | Đọc collection | `[VERIFIED]` 400 |
| `POST /v1/flow:batchMoveToCollection` | Chuyển media vào collection | `[VERIFIED]` 400 |
| `POST /v1/flow:batchDeleteAssets` | Xoá media (đưa vào Thùng rác) | `[VERIFIED]` 400 |
| `POST /v1/flow:copyProjectMedia` | Copy media sang project khác | `[VERIFIED]` 400 |
| `GET /v1/flowMedia/<mediaId>` | Đọc metadata một media | `[VERIFIED]` 404 |
| `GET /v1/media/<id>` | Đọc media (route chung) | `[VERIFIED]` 404 |

Lỗi liên quan collection: `PUBLIC_ERROR_COLLECTION_FULL`,
`PUBLIC_ERROR_COLLECTION_DEPTH_EXCEEDED`, `PUBLIC_ERROR_COLLECTION_INVALID`.

---

## 3.7 Upload và biến đổi media

| Endpoint | Mục đích | Bằng chứng |
|----------|----------|------------|
| `POST /v1/flow/uploadImage` | Tải ảnh lên để dùng làm input | `[VERIFIED]` 400 |
| `POST /v1/flow/upsampleImage` | Nâng cấp ảnh 2K / 4K | `[VERIFIED]` 400 |
| `POST /v1/flow:transformImage` | Biến đổi ảnh | `[VERIFIED]` 400 |
| `GET /v1/flow/entities` | Đọc thực thể trong project | `[VERIFIED]` 200 |
| `POST /v1/flow/entities:copyEntity` | Nhân bản thực thể | `[VERIFIED]` 404 |

Trong bundle, `uploadImage` được gọi với `{ request, bearerToken }` và body JSON
(không phải multipart), nghĩa là ảnh được gửi dạng base64 trong JSON.

Lỗi liên quan upload: `PUBLIC_ERROR_IMAGE_TOO_LARGE`, `PUBLIC_ERROR_IMAGE_TOO_SMALL`,
`PUBLIC_ERROR_UNKNOWN_IMAGE_FILE_FORMAT`, `PUBLIC_ERROR_UNSAFE_IMAGE_UPLOAD`,
`PUBLIC_ERROR_VIDEO_UPLOAD_FAILED`, `PUBLIC_ERROR_VIDEO_UPLOAD_TIMEOUT`.

---

## 3.8 Nhân vật (likeness / characters)

### `GET /v1/flow/likeness:checkEligibility`  `[VERIFIED]` 200

```json
{ "eligible": "bool" }
```

### `GET /v1/flow/likeness:listUserLikenesses`  `[VERIFIED]` 200

Query: `populateImage=<bool>`

```json
{}   // rỗng khi chưa có nhân vật nào
```

Tính năng Nhân vật giữ ngoại hình nhất quán qua nhiều shot. Nhân vật được tạo bằng
model ảnh (Nano Banana 2) nên không trừ credit. Trong bundle có
`FEATURE_FLOW_CHARACTERS` và `LIKENESS_REGISTRATION_STATUS_*`.

Giới hạn số nhân vật lấy từ `inputSpec.maxCharacters` của từng model: model ảnh cho
tới 10, model video cho tới 3. Xem [06-models-pricing.md](06-models-pricing.md).

---

## 3.9 Creation agent (SSE)

### `POST /v1/flowCreationAgent/sessions`  `[VERIFIED]` 200

```json
// request
{ "projectId": "projects/<projectId>" }
// response
{ "sessionInfo": { "agentSessionId": "str<uuid>",
  "sessionContext": { "creationTime": "str", "lastUpdatedTime": "str", "agentMode": "str" } } }
```

Lưu ý `projectId` ở đây mang tiền tố `projects/` (độ dài mẫu 45 = 9 + 36).

### `GET /v1/flowCreationAgent/sessions`  `[VERIFIED]` 200

Query: `projectId=projects/<projectId>`. Trả `{}` khi chưa có phiên.

### `GET /v1/flowCreationAgent/sessions/<agentSessionId>`  `[VERIFIED]` 200

Trả về `sessionInfo` như trên.

### `POST /v1/flowCreationAgent:streamChat?alt=sse`  `[VERIFIED]` 403, `text/event-stream`

Đã bắt lại trong bộ bằng chứng hiện hành (status 403 do recaptcha token giả, nhưng đã
xác nhận đúng endpoint và có request shape).

```json
{
  "agentSessionId": "str<uuid>",
  "agentClientContext": {
    "projectId": "projects/<projectId>",
    "clientSessionId": "str",
    "recaptchaContext": { "token": "str", "applicationType": "RECAPTCHA_APPLICATION_TYPE_WEB" },
    "turnNumber": "int"
  },
  "userMessage": { "userPrompt": { "parts": [ { "text": "str" } ] } }
}
```

Response là SSE, mỗi frame là một `agentMessage`:

- `thinkingEvent.thought` — agent suy luận (chọn model, aspect, số lượng).
- `response.text` — câu trả lời, kèm câu hỏi xác nhận credit.
- Sau khi người dùng phê duyệt: UI component `MultipleChoice`, mỗi option chứa
  `video` (mediaId), `modelUsageKey`, `aspectRatio`.

Phê duyệt được log bằng `PERMISSION_ACTION_APPROVED` hoặc
`PERMISSION_ACTION_APPROVED_STICKY` (phê duyệt và không hỏi lại).

Nhận xét về chi phí: agent mặc định sinh 4 video mỗi lần. Với `veo_3_1_t2v_fast` ở
`SERVICE_TIER_INTERMEDIATE` (20 credit/video), một lần là 80 credit. Đường trực tiếp
ở mục 3.4 tránh được chuyện này.

---

## 3.10 Applet (tab Công cụ)

### `GET /v1/flowAppletAgent/applets`  `[VERIFIED]` 200

Mẫu quan sát: 49 applet.

```json
{
  "applets": [
    {
      "appletId": "str", "creatorGaiaId": "str", "displayName": "str",
      "description": "str", "currentVersionId": "str<uuid>",
      "createTime": "str", "updateTime": "str", "name": "str",
      "source": "str", "thumbnailUrl": "str<url>", "creatorDisplayName": "str",
      "hasCode": "bool", "favoriteCount": "str", "previewUrl": "str<url>",
      "categories": ["str"], "remixDisabled": "bool", "ordering": "int"
    }
  ]
}
```

### `GET /v1/flowAppletAgent/savedSharedApplets`  `[VERIFIED]` 200 — `{}` khi chưa lưu gì.

### Các endpoint applet còn lại

| Endpoint | Mục đích | Bằng chứng |
|----------|----------|------------|
| `GET /v1/flowAppletAgent/applets/community-<id>` | Chi tiết applet | `[VERIFIED]` 200 |
| `GET /v1/flowAppletAgent/sharedApplets/<id>` | Applet được chia sẻ | `[BUNDLE]` |
| `POST /v1/flowAppletAgent:copyApplet` | Nhân bản | `[VERIFIED]` 404 |
| `POST /v1/flowAppletAgent:forkSharedApplet` | Fork applet chia sẻ | `[VERIFIED]` 400 |
| `POST /v1/flowAppletAgent:shareApplet` | Chia sẻ | `[VERIFIED]` 404 |
| `POST /v1/flowAppletAgent:saveSharedApplet` | Lưu applet của người khác | `[VERIFIED]` 400 |
| `POST /v1/flowAppletAgent:deleteSavedSharedApplet` | Bỏ lưu | `[VERIFIED]` 400 |
| `POST /v1/flowAppletAgent:favoriteApplet` | Đánh dấu yêu thích | `[VERIFIED]` 200 |
| `POST /v1/flowAppletAgent:unfavoriteApplet` | Bỏ yêu thích | `[VERIFIED]` 200 |
| `POST /v1/flowAppletAgent:revertAppletVersion` | Quay về phiên bản trước | `[VERIFIED]` 404 |
| `POST /v1/flowAppletAgent:submitAppletReview` | Gửi review | `[VERIFIED]` 400 |

Lỗi liên quan: `PUBLIC_ERROR_APPLET_SIZE_LIMIT_EXCEEDED`,
`PUBLIC_ERROR_APPLET_STORAGE_QUOTA_EXCEEDED`.

---

## 3.11 Telemetry

### `POST /v1/flow:batchLogFrontendEvents`  `[VERIFIED]` 200

```json
{
  "events": [
    {
      "eventType": "str",
      "metadata": {
        "sessionId": "str",
        "createTime": "str",
        "additionalParams": {
          "TIMER_ID":        { "@type": "str", "value": "str" },
          "TOOL_NAME":       { "@type": "str", "value": "PINHOLE" },
          "CURRENT_TIME_MS": { "@type": "str", "value": "str" },
          "USER_AGENT":      { "@type": "str", "value": "str" },
          "IS_DESKTOP":      { "@type": "str", "value": "str" }
        },
        "experimentIds": "str"
      }
    }
  ]
}
```

Response: `{}`. Các `eventType` đã thấy: `PROMPT_BOX_SUBMISSION`,
`CREATION_AGENT_PERMISSION_RESPONSE`.

Endpoint này không cần thiết cho việc sinh media. Bỏ qua được hoàn toàn.
