# 2. Xác thực và giới hạn truy cập

## 2.1 Bearer token cho `aisandbox-pa.googleapis.com`

Mọi request tới backend bắt buộc có header:

```http
Authorization: Bearer ya29.<access_token>
```

Đặc điểm quan sát được:

- Độ dài token trong mẫu: ~416 ký tự.
- Hạn dùng: khoảng 1 giờ. Hết hạn trả `401 UNAUTHENTICATED`.
- Chỉ truyền `key=` trên query string **không đủ**: backend trả 401 với
  `CREDENTIALS_MISSING`. Query `key` chỉ là API key của app, không thay thế OAuth.

## 2.2 Lấy token: `GET /fx/api/auth/session`  `[VERIFIED]`

Frontend lấy access token qua chính session của `labs.google`:

```http
GET https://labs.google/fx/api/auth/session
Cookie: <session cookie của labs.google>
```

Response:

```json
{
  "user": { "name": "str", "email": "str", "image": "str<url>" },
  "expires": "str<ISO-8601, len=24>",
  "access_token": "str<len=416>"
}
```

Đây là cách duy nhất đã xác nhận để lấy bearer token mà không dùng OAuth flow
riêng: đăng nhập bằng browser một lần, giữ cookie, rồi gọi endpoint này mỗi khi cần
token mới. `expires` cho biết thời điểm phải lấy lại.

Vì token hết hạn theo giờ, client dài hạn nên refresh chủ động: gọi lại endpoint này
khi còn dưới 5 phút, hoặc khi gặp 401 thì refresh rồi thử lại đúng một lần.

## 2.3 Session tRPC cho `labs.google/fx/api`

Các route tRPC không dùng bearer token; chúng dùng cookie session cùng origin. Vì vậy:

- Gọi từ trong page: `fetch(url, { credentials: "include" })`.
- Gọi từ ngoài: phải mang theo cookie session đã lưu.

## 2.4 reCAPTCHA cho request sinh media

Endpoint sinh media đòi hỏi `clientContext.recaptchaContext`:

| Field | Kiểu | Ghi chú |
|-------|------|---------|
| `token` | `str` | Độ dài quan sát: 2318 (video), 2361 (ảnh). Dùng 1 lần. |
| `applicationType` | enum | `RECAPTCHA_APPLICATION_TYPE_WEB` cho web |

Các giá trị enum khác (`ANDROID`, `IOS`, `UNSPECIFIED`) có trong bundle nhưng không
dùng từ web.

Token là reCAPTCHA Enterprise, sinh trong trang, gắn với phiên và thời điểm. Không có
cách lấy token hợp lệ từ ngoài browser. Kết quả thực tế:

- Nếu tự động hoá, phải có một browser thực đang mở trang Flow.
- Lấy token bằng cách eval JS trong page context, rồi dùng token đó gọi API từ cùng
  page context (tránh CORS).

## 2.5 CORS

`aisandbox-pa.googleapis.com` trả về CORS preflight (`OPTIONS`) hợp lệ cho origin
`https://labs.google`, không cho origin khác. Trong log, mọi endpoint backend đều có
một bản ghi `OPTIONS ... 200` đi trước request thật.

Hậu quả thực tế:

- Gọi từ JS trong tab `labs.google` — OK.
- Gọi từ trang khác hoặc từ extension có origin khác — bị CORS ("Failed to fetch").
- Gọi từ server (curl / python / requests) — OK, vì CORS chỉ áp dụng cho browser.

Cách làm an toàn nhất: lấy token + recaptcha trong page, rồi gửi request từ backend
của mình, hoặc gọi luôn từ page context bằng `fetch`.

## 2.6 Header thực tế khi gọi từ ngoài

```http
POST /v1/video:batchAsyncGenerateVideoText HTTP/1.1
Host: aisandbox-pa.googleapis.com
Authorization: Bearer ya29....
Content-Type: application/json
Origin: https://labs.google
Referer: https://labs.google/
```

`Origin`/`Referer` không bắt buộc để vượt xác thực, nhưng đặt đúng giúp trùng khớp
với lưu lượng thật và giảm nguy cơ bị chặn bởi kiểm tra chống lạm dụng
(`PUBLIC_ERROR_UNUSUAL_ACTIVITY`).

## 2.7 Kiểm tra điều kiện trước khi gọi

Ba endpoint đọc nên gọi trước khi bắt đầu pipeline:

1. `POST /v1:checkAppAvailability` — app có khả dụng cho tài khoản này không.
2. `GET /v1/credits` — còn bao nhiêu credit, tier nào.
3. `GET /v1/flow/models/statuses` — model nào đang tạm ngưng.

Ba cái này không tính phí và không cần reCAPTCHA.
