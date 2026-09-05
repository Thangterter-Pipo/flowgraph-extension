# 8. Lỗi và cách xử lý

## 8.1 Ba tầng lỗi

Một request thất bại có thể báo lỗi ở ba tầng khác nhau, và phải kiểm tra cả ba:

1. **HTTP** — `401`, `403`, `429`, `5xx`.
2. **tRPC** — HTTP 200 nhưng `result.data.json.status` là mã lỗi.
3. **Sinh media** — HTTP 200, tạo thành công, nhưng media kết thúc với
   `MEDIA_GENERATION_STATUS_FAILED` kèm một `PUBLIC_ERROR_*`.

Tầng 3 là tầng dễ bỏ sót nhất: request "thành công" nhưng không có video.

## 8.2 Mã HTTP quan sát được

| Mã | Nguyên nhân | Xử lý |
|----|-------------|-------|
| `200` | OK | — |
| `307` | Redirect của `media.getMediaUrlRedirect` | Theo redirect (`redirect: "follow"`) |
| `401 UNAUTHENTICATED` (`CREDENTIALS_MISSING`) | Thiếu/hết hạn bearer token, hoặc chỉ truyền `key=` | Lấy lại token từ `/fx/api/auth/session`, thử lại 1 lần |

Mã `403`/`429`/`5xx` chưa bắt được trong lưu lượng nhưng nên xử lý phòng hộ: `429` và
`5xx` thì backoff theo hàm số mũ, `403` thì dừng lại và báo người dùng.

## 8.3 Mã lỗi public (59 mã)

Trích từ bundle (`PUBLIC_ERROR_*`). Nhóm theo cách xử lý.

### Nhóm thử lại được (backoff rồi thử lại)

```text
PUBLIC_ERROR_HIGH_TRAFFIC
PUBLIC_ERROR_MODEL_OVERLOADED
PUBLIC_ERROR_MODEL_DISABLED_DUE_TO_TRAFFIC
PUBLIC_ERROR_UNUSUAL_ACTIVITY_TOO_MUCH_TRAFFIC
PUBLIC_ERROR_USER_REQUESTS_THROTTLED
PUBLIC_ERROR_CONCURRENT_LIMIT_REACHED
PUBLIC_ERROR_GENERATION_ALREADY_IN_PROGRESS
PUBLIC_ERROR_VIDEO_GENERATION_TIMED_OUT
PUBLIC_ERROR_SOMETHING_WENT_WRONG
```

Với `CONCURRENT_LIMIT_REACHED` và `GENERATION_ALREADY_IN_PROGRESS`, thử lại ngay lập
tức sẽ lại thất bại: phải chờ lần sinh đang chạy kết thúc trước.

### Nhóm quota (thử lại vô ích)

```text
PUBLIC_ERROR_USER_QUOTA_REACHED
PUBLIC_ERROR_PER_MODEL_DAILY_QUOTA_REACHED
PUBLIC_ERROR_PER_MODEL_DAILY_QUOTA_REACHED_UPGRADEABLE
PUBLIC_ERROR_WORKSPACE_ACCOUNT_QUOTA_REACHED
PUBLIC_ERROR_APPLET_STORAGE_QUOTA_EXCEEDED
```

`PER_MODEL_DAILY_QUOTA_REACHED` là quota theo từng model theo ngày — đổi sang model
khác trong cùng họ có thể đi tiếp.

### Nhóm quyền và điều kiện tài khoản

```text
PUBLIC_ERROR_APP_UNAVAILABLE
PUBLIC_ERROR_MODEL_ACCESS_DENIED
PUBLIC_ERROR_USER_REGION_DISALLOWED
PUBLIC_ERROR_USER_MINOR
PUBLIC_ERROR_UNUSUAL_ACTIVITY
```

Kiểm tra trước bằng `appConfig.isRegionSupported` / `isAgeSupported` và
`POST /v1:checkAppAvailability` để tránh mất một vòng gọi.

### Nhóm bộ lọc nội dung (prompt hoặc output bị từ chối)

```text
PUBLIC_ERROR_UNSAFE_GENERATION
PUBLIC_ERROR_SEXUAL
PUBLIC_ERROR_VIOLENCE_FILTER
PUBLIC_ERROR_DANGER_FILTER
PUBLIC_ERROR_MINOR
PUBLIC_ERROR_REPUTATIONAL
PUBLIC_ERROR_PROMINENT_PEOPLE_FILTER_FAILED
PUBLIC_ERROR_IMAGE_OUTPUT_IP_FILTER
PUBLIC_ERROR_AUDIO_FILTERED
PUBLIC_ERROR_UNDERSPECIFIED_ANIMAL
PUBLIC_ERROR_NON_ENGLISH_PROMPT
PUBLIC_ERROR_RESPONSE_TOO_LONG
```

Hai mã đáng chú ý: `NON_ENGLISH_PROMPT` cho thấy prompt tiếng Việt có thể bị từ chối
với một số model — nên dịch prompt sang tiếng Anh trước khi gửi.
`UNDERSPECIFIED_ANIMAL` yêu cầu tả rõ loài động vật thay vì nói chung chung.

### Nhóm lỗi input (ảnh/video đầu vào)

```text
PUBLIC_ERROR_IMAGE_TOO_LARGE
PUBLIC_ERROR_IMAGE_TOO_SMALL
PUBLIC_ERROR_UNKNOWN_IMAGE_FILE_FORMAT
PUBLIC_ERROR_UNSAFE_IMAGE_UPLOAD
PUBLIC_ERROR_UNSAFE_VIDEO_UPLOAD
PUBLIC_ERROR_IP_INPUT_IMAGE
PUBLIC_ERROR_MINOR_INPUT_IMAGE
PUBLIC_ERROR_MINOR_UPLOAD
PUBLIC_ERROR_MINOR_HARM_UPLOAD
PUBLIC_ERROR_PHOTOREAL_INPUT_IMAGE
PUBLIC_ERROR_PHOTOREAL_UPLOAD
PUBLIC_ERROR_PROMINENT_PEOPLE_INPUT_IMAGE
PUBLIC_ERROR_PROMINENT_PEOPLE_UPLOAD
PUBLIC_ERROR_SEXUAL_UPLOAD
PUBLIC_ERROR_VIDEO_UPLOAD_FAILED
PUBLIC_ERROR_VIDEO_UPLOAD_TIMEOUT
PUBLIC_ERROR_VIDEO_DURATION_TOO_LONG
```

`VIDEO_DURATION_TOO_LONG` liên quan `inputSpec.maxInputV2vVideoDuration` (8 giây cho
`veo_3_1_extension_lite`, 10 giây cho `abra_edit`).

### Nhóm collection / applet / handle

```text
PUBLIC_ERROR_COLLECTION_FULL
PUBLIC_ERROR_COLLECTION_DEPTH_EXCEEDED
PUBLIC_ERROR_COLLECTION_INVALID
PUBLIC_ERROR_APPLET_SIZE_LIMIT_EXCEEDED
PUBLIC_ERROR_HANDLE_INVALID
PUBLIC_ERROR_HANDLE_TAKEN
```

### Nhóm khác

```text
PUBLIC_ERROR_UNSPECIFIED
PUBLIC_ERROR_CODE
PUBLIC_ERROR_MEDIA_GENERATION_CANNOT_BE_CANCELED
PUBLIC_ERROR_SPEECH_EDIT
PUBLIC_ERROR_VIDEO_EDIT
```

## 8.4 Sinh thất bại không trừ credit

Đã xác nhận bằng đo trước/sau: 4 video thất bại, số credit không đổi (1000 -> 1000).
Một video thành công với `veo_3_1_t2v_fast` ở `SERVICE_TIER_INTERMEDIATE` trừ đúng
20 credit (1000 -> 980).

Nghĩa là thử lại sau khi thất bại là an toàn về chi phí. Nhưng vẫn nên giới hạn số lần
thử (3 lần là đủ) để tránh bị đánh dấu `PUBLIC_ERROR_UNUSUAL_ACTIVITY`.

## 8.5 Chiến lược thử lại đề xuất

```text
401                         -> refresh token, thử lại 1 lần
429 / 5xx                   -> backoff mũ: 2s, 4s, 8s, tối đa 3 lần
HIGH_TRAFFIC / OVERLOADED   -> backoff 30s, tối đa 3 lần
CONCURRENT_LIMIT_REACHED    -> chờ lần sinh hiện tại xong, rồi thử lại
PER_MODEL_DAILY_QUOTA_*     -> đổi usage key khác trong cùng họ
bộ lọc nội dung             -> không thử lại; sửa prompt
quota người dùng / region   -> dừng lại, báo người dùng
```

## 8.6 Dấu hiệu thất bại trên UI

Khi theo đường tự động hoá UI, ô video thất bại hiện "Không thành công" / "Rất tiếc,
đã xảy ra lỗi". Trong lúc đang render, ô hiện phần trăm (ví dụ "75%"). Đọc trạng thái
qua API đáng tin hơn so với đọc chữ trên DOM.
