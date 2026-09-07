# 11. Nguồn bằng chứng

## 11.1 Nguyên tắc

Tài liệu này không ghi bất kỳ điều gì chỉ vì "có vẻ đúng". Mọi khẳng định phải truy
được về một trong ba nguồn:

| Nhãn | Nguồn | Độ tin cậy |
|------|-------|------------|
| `[VERIFIED]` | Lưu lượng thật đã bắt: có method, status, và hình dạng request/response | Cao |
| `[OBSERVED]` | Đã thấy endpoint hoạt động nhưng chưa bắt đầy đủ payload | Trung bình |
| `[BUNDLE]` | Đường dẫn trích từ bundle JS công khai của frontend | Đường dẫn chắc, hình dạng payload chưa rõ |

Khi một chi tiết là suy diễn, tài liệu nói rõ là suy diễn. Khi không biết, tài liệu ghi
là không biết — ví dụ giá trị thật của `MEDIA_VISIBILITY_*` ở
[07-enums.md](07-enums.md) mục 7.14.

## 11.2 Các file bằng chứng

| File | Nội dung | Dùng cho mục |
|------|----------|--------------|
| `_ctl/schemas_master.json` | 130 bản ghi endpoint (69 không tính OPTIONS, 65 có hình dạng req/res) | 03, 04 |
| `_ctl/schemas.json`, `schemas_final.json`, `schemas_video.json`, `schemas_applet.json` | Các lần bắt riêng lẻ, `merge_schemas.py` hợp lại thành master | 03 |
| `_ctl/pricing.json` | `modelConfig` đầy đủ: 82 usage key, creditMapping, inputSpec, requirements | 05, 06 |
| `_ctl/models.json` | Danh mục họ model + 53 model key deprecated | 06 |
| `_ctl/js/*.js` | 7 bundle JS công khai của frontend Flow | 03 (route), 07 (enum), 08 (mã lỗi) |
| `_ctl/flow_ctl.py` | Controller browser đã tạo ra các bản ghi trên | 10 |

Ba script phụ trợ:

| Script | Việc nó làm |
|--------|-------------|
| `_ctl/verify_docs.py` | Kiểm tra tài liệu khớp bằng chứng (chạy trước khi tin tài liệu) |
| `_ctl/gen_pricing_doc.py` | Sinh `docs/06-models-pricing.md` từ `modelConfig` |
| `_ctl/dig_video_fields.py` | Trích tên field và enum của các endpoint video từ bundle |
| `_ctl/merge_schemas.py` | Hợp các lần bắt vào `schemas_master.json`, giữ lại bằng chứng cũ |

`schemas_master.json` được hợp từ các lần bắt bằng `_ctl/merge_schemas.py`, ưu tiên bản
ghi nào có cả request và response.

## 11.3 Cơ chế ẩn danh

`_ctl/flow_ctl.py` chỉ lưu **tên field và kiểu dữ liệu**, không lưu giá trị:

- UUID thành `str<uuid>`, URL thành `str<url>`, chuỗi khác thành `str<len=N>`.
- URL trong log bị mask: UUID thay bằng `<id>`, token dài thay bằng `<tok>`, query
  string chỉ giữ tên key.
- Không lưu cookie, header `Authorization`, hay body thật.

Vì vậy tài liệu không chứa token, cookie, email, ID project hay ID media thật.
`_ctl/verify_docs.py` kiểm tra điều này tự động.

## 11.4 Chạy lại kiểm chứng

```powershell
# Kiểm tra tài liệu khớp bằng chứng (nhãn [VERIFIED], enum, bảng giá, rò rỉ dữ liệu)
python _ctl/verify_docs.py

# Sinh lại bảng giá từ modelConfig
python _ctl/gen_pricing_doc.py

# Xem hình dạng request/response của một nhóm endpoint
python _ctl/show_master.py video
python _ctl/show_master.py trpc
```

Kết quả mong đợi của `verify_docs.py`: `OK`, không WARN và không FAIL.

`verify_docs.py` kiểm các mục sau:

1. Mọi endpoint gắn `[VERIFIED]` phải có bản ghi tương ứng trong `schemas_master.json`.
2. Độ phủ hai chiều: mọi route tìm thấy trong bundle JS và mọi endpoint đã bắt được
   phải được nói đến trong `docs/`. Ngoại lệ duy nhất là `v1/place` (URL nhúng Google
   Maps, không thuộc API Flow).
3. Mọi giá trị enum trích trong file 07 phải tồn tại trong bundle hoặc trong
   `modelConfig`.
4. Bảng giá phải khớp hai chiều với `modelConfig`: không thiếu usage key nào và không
   có usage key lạ.
5. Không file `docs/*.md` nào chứa UUID thật hoặc access token thật.

Ở lần chạy gần nhất: 241 phép kiểm, 77 endpoint có nhãn bằng chứng, 67 endpoint đã bắt
được trong master (69 non-OPTIONS, 65 có hình dạng req/res), kết quả `OK` (không còn
WARN hay FAIL).

Verifier kiểm cả hai cách viết endpoint trong tài liệu: dạng `METHOD /path` và dạng
động từ RPC `video:batchAsyncGenerateVideoX` dùng trong bảng ở mục 3.4.

## 11.5 Đo thật đã làm

| Phép đo | Kết quả |
|---------|---------|
| Chi phí 1 video `veo_3_1_t2v_fast`, tier INTERMEDIATE | 20 credit (1000 -> 980) |
| Chi phí 4 video thất bại | 0 credit (1000 -> 1000) |
| Chi phí tạo nhân vật (Nano Banana 2) | 0 credit |
| File tải được | 720x1280, H.264+AAC, 8.0s, 24fps, ~3.7 MB, `video/mp4` |
| Gọi backend chỉ với `key=` (không bearer) | 401 `CREDENTIALS_MISSING` |
| Gọi backend từ origin khác | CORS chặn |
| Toàn bộ đợt dò tên trường (hơn 40 lần gọi) | 0 credit (số dư giữ nguyên 1028) |

## 11.6 Những điều chưa kiểm chứng

Ghi lại để không ai nhầm là đã xong:

1. **Hình dạng phần tử `referenceImages[]`.** Endpoint
   `batchAsyncGenerateVideoReferenceImages` đã `[VERIFIED]`, nhưng backend từ chối mọi
   tên trường đã thử cho phần tử bên trong (danh sách ở mục 3.4). Cần bắt một request
   thật phát ra từ UI khi dùng ảnh tham chiếu.
2. **4 endpoint video deprecated** (`CameraControl`, `ReshootVideo`,
   `ObjectInsertion`, `ObjectRemoval`) — gọi thử không nhận được response nào, nên
   khả năng cao đã bị tháo khỏi backend. Giữ nhãn `[BUNDLE]`.
3. **`GET /v1/flow/projects/...`** — path thấy trong bundle nhưng chưa bắt được lưu
   lượng; trong thực tế việc đọc project đi qua tRPC `flow.projectInitialData`.
4. **`GET /v1/flowAppletAgent/sharedApplets/<id>`** — cần một applet đã được chia sẻ
   với tài khoản này mới gọi được. Mười endpoint applet còn lại đều đã `[VERIFIED]`.
5. **Mã lỗi HTTP `429` và `5xx`.** Chưa gặp trong lưu lượng; phần xử lý ở
   [08-errors.md](08-errors.md) mục 8.5 là đề xuất phòng hộ, không phải quan sát.
   Riêng `400`, `403` (reCAPTCHA thất bại) và `404` đều đã quan sát được.
6. **Giá trị thật của `MEDIA_VISIBILITY_*` và `sku`.** Chỉ biết độ dài chuỗi.
7. **Bảng giá theo thời gian.** Số credit lấy từ một lần bắt; Google có thể đổi.

## 11.9 Dò tên trường mà không tốn credit

Kỹ thuật dùng cho nhóm video: gửi payload với reCAPTCHA token giả rồi đọc phản hồi.
Backend kiểm tra cú pháp payload **trước** khi kiểm reCAPTCHA, và kiểm reCAPTCHA
**trước** khi tính phí, nên có ba tầng phân biệt rõ:

```text
400 Unknown name "X"          -> trường X không tồn tại
400 invalid argument          -> tên trường đúng, giá trị/tổ hợp sai
403 reCAPTCHA evaluation failed -> payload hợp lệ hoàn toàn; dừng trước khi tính phí
```

Vì vậy 403 là bằng chứng mạnh nhất cho tên trường đúng, và không lần gọi nào trong
quá trình dò làm thay đổi số credit.

## 11.7 Cách bắt thêm bằng chứng

Khi cần bổ sung một endpoint chưa có:

1. Chạy `_ctl/flow_ctl.py` (browser hiện, profile đã đăng nhập).
2. Gửi lệnh `schema_clear` để log sạch.
3. Thao tác trên UI đúng tính năng cần bắt (ví dụ kéo dài video).
4. Gửi `schema_dump` với `path` mới, ví dụ `_ctl/schemas_extend.json`.
5. Chạy `python _ctl/merge_schemas.py` để hợp vào `schemas_master.json`.
6. Cập nhật tài liệu, đổi nhãn từ `[BUNDLE]` sang `[VERIFIED]`.
7. Chạy `python _ctl/verify_docs.py` — phải `OK`.

## 11.8 Cập nhật bundle khi Flow deploy bản mới

Tên file bundle có hash, nên sẽ đổi sau mỗi lần deploy. Lấy lại danh sách:

```powershell
$r = Invoke-WebRequest -Uri 'https://labs.google/fx/vi/tools/flow' -UseBasicParsing
[regex]::Matches($r.Content, '/fx/_next/static/chunks/[A-Za-z0-9._\-/]+\.js') |
  ForEach-Object { $_.Value } | Sort-Object -Unique
```

Tải các file đó vào `_ctl/js/`, rồi chạy lại `verify_docs.py` để phát hiện enum nào đã
bị bỏ hoặc đổi tên.
