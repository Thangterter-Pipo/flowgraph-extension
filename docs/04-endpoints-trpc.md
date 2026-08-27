# 4. Endpoint tRPC `labs.google/fx/api`

Base: `https://labs.google/fx/api`
Auth: cookie session của `labs.google` (không dùng bearer token).

## 4.1 Quy ước tRPC

Cả hai chiều đều bọc thêm một lớp `json`:

```text
GET  <route>?input=<URL-encoded JSON: {"json": {...}}>
POST <route>   body = {"json": {...}}
```

Response luôn có dạng:

```json
{
  "result": {
    "data": {
      "json": {
        "result": { "...": "dữ liệu thật ở đây" },
        "status": "int",
        "statusText": "str"
      }
    }
  }
}
```

Nghĩa là dữ liệu thật nằm sau `result.data.json.result`. Trường `status` bên trong là
status của lần backend gọi nội bộ, không phải HTTP status của request tRPC. Một
request tRPC có thể trả HTTP 200 nhưng `status` bên trong là lỗi.

## 4.2 Session

### `GET /fx/api/auth/session`  `[VERIFIED]` 200

Endpoint duy nhất không theo khuôn tRPC. Xem [02-auth.md](02-auth.md) mục 2.2.

```json
{
  "user": { "name": "str", "email": "str", "image": "str<url>" },
  "expires": "str<ISO-8601>",
  "access_token": "str"
}
```

## 4.3 Project

### `POST /fx/api/trpc/project.createProject`  `[VERIFIED]` 200

```json
// request
{ "json": { "projectTitle": "str", "toolName": "PINHOLE" } }
// result
{ "projectId": "str<uuid>", "projectInfo": { "projectTitle": "str" } }
```

### `POST /fx/api/trpc/project.deleteProject`  `[VERIFIED]` 200

```json
// request
{ "json": { "projectToDeleteId": "str<uuid>" } }
// result
{}
```

### `GET /fx/api/trpc/project.searchUserProjects`  `[VERIFIED]` 200

```json
// result
{
  "projects": [
    { "projectId": "str<uuid>", "projectInfo": "obj",
      "creationTime": "str", "agentInfo": "obj" }
  ]
}
```

### `GET /fx/api/trpc/flow.projectInitialData`  `[VERIFIED]` 200

Endpoint nặng nhất và hữu ích nhất: một lần gọi trả về toàn bộ trạng thái project
**cộng với** cả `modelConfig` (danh mục model + bảng giá credit).

```json
{
  "projectName": "str",
  "projectId": "str<uuid>",
  "projectContents": {
    "externalReferenceMedia": [
      { "mediaId": "str", "mediaType": "str", "workflowDisplayName": "str", "media": "obj" }
    ],
    "agentInfo": {
      "defaultGenerationSettings": { "imageDefaults": "obj", "videoDefaults": "obj" },
      "agentToggleState": "AGENT_TOGGLE_STATE_*"
    }
  },
  "modelConfig": {
    "imageModelFamilies": [ { "displayName": "str", "id": "str",
      "enableUpselling": "bool", "usages": "obj" } ],
    "videoModelFamilies": [ { "displayName": "str", "id": "str",
      "enableUpselling": "bool", "usages": "obj" } ],
    "deprecatedModelKeys": { "<modelKey>": { "displayName": "str" } },
    "tierDefaults": { "SERVICE_TIER_*": { "defaultImageModelFamily": "str",
      "defaultVideoModelFamily": "str" } },
    "audioModelKey": "str"
  }
}
```

`modelConfig` là nguồn sự thật cho bảng giá credit. Mẫu quan sát: 5 họ model ảnh,
7 họ model video, 53 model key đã deprecated, 82 usage key còn hiệu lực. Chi tiết ở
[06-models-pricing.md](06-models-pricing.md).

Đường dẫn tới từng usage: `modelConfig.videoModelFamilies[].usages.<tên>` với các
trường `key`, `creditMapping`, `videoLengthSeconds`, `generationTimeSeconds`,
`supportedResolutions`, `supportedAspectRatios`, `outputsAudio`, `maxImageInputs`,
`maxImageReferences`, `inputSpec`, `requirements`.

## 4.4 Cấu hình và tuỳ chọn người dùng

### `GET /fx/api/trpc/videoFx.getFlowAppConfig`  `[VERIFIED]` 200

Cùng nội dung với `GET /v1/flow/appConfig` (xem
[03-endpoints-aisandbox.md](03-endpoints-aisandbox.md) mục 3.1), chỉ khác là được bọc
trong lớp tRPC. Dùng bản tRPC khi chỉ có cookie, dùng bản backend khi đã có bearer
token.

### `GET /fx/api/trpc/videoFx.getUserSettings`  `[VERIFIED]` 200

```json
{ "lastAcknowledgedChangeLogId": "str", "completedOnboardingIds": ["str"],
  "isAgentModeToggled": "bool", "isChatPanelOpen": "bool" }
```

### `POST /fx/api/trpc/videoFx.updateUserSettings`  `[VERIFIED]` 200

```json
// request
{ "json": { "isAgentModeToggled": "bool" } }
```

Response trả về toàn bộ userSettings sau khi cập nhật. Đây là cách bật/tắt agent mode
từ phía frontend (song song với `PATCH /v1/projects/<id>/agentInfo` ở backend).

### `GET /fx/api/trpc/general.fetchUserPreferences`  `[VERIFIED]` 200

```json
{ "enableHistory": "bool", "enableProductImprovement": "bool" }
```

### `GET /fx/api/trpc/general.fetchUserAcknowledgement`  `[VERIFIED]` 200

```json
{ "hasAcknowledgement": "bool" }
```

### `GET /fx/api/trpc/general.fetchToolAvailability`  `[VERIFIED]` 200

```json
{ "availabilityState": "str" }
```

## 4.5 Media

### `GET /fx/api/trpc/media.getMediaUrlRedirect`  `[VERIFIED]` 307

Query: `name=<mediaId>`, tuỳ chọn `mediaUrlType=MEDIA_URL_TYPE_THUMBNAIL`.

Khác các route tRPC khác: không trả JSON mà trả **307 redirect** tới CDN. Chi tiết
chuỗi phân phối ở [09-media-delivery.md](09-media-delivery.md).

## 4.6 Telemetry

### `POST /fx/api/trpc/general.submitBatchLog`  `[VERIFIED]` 200

```json
{
  "json": {
    "appEvents": [
      {
        "event": "str",
        "eventProperties": [ { "key": "str", "stringValue": "str" } ],
        "activeExperiments": [],
        "eventMetadata": { "sessionId": "str" },
        "eventTime": "str"
      }
    ]
  }
}
```

Không cần cho pipeline. Bỏ qua được.
