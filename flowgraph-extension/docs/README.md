# Tài liệu API Google Flow (Veo) — nội bộ

Bộ tài liệu này mô tả bề mặt API thật của Google Flow (`labs.google/fx/tools/flow`)
và backend `aisandbox-pa.googleapis.com`, dựng từ lưu lượng thật (browser
instrumentation) cộng với bundle JS công khai của frontend.

## Cấu trúc

| File | Nội dung |
|------|----------|
| [01-overview.md](01-overview.md) | Kiến trúc, 2 host, 2 lớp API, quy ước chung |
| [02-auth.md](02-auth.md) | OAuth bearer, session tRPC, reCAPTCHA, CORS |
| [03-endpoints-aisandbox.md](03-endpoints-aisandbox.md) | Toàn bộ endpoint backend `aisandbox-pa` |
| [04-endpoints-trpc.md](04-endpoints-trpc.md) | Toàn bộ endpoint tRPC `labs.google/fx/api` |
| [05-generation-flows.md](05-generation-flows.md) | Luồng tạo ảnh / video / upsample / extend, poll trạng thái |
| [06-models-pricing.md](06-models-pricing.md) | 82 model usage key + giá credit theo service tier |
| [07-enums.md](07-enums.md) | Enum protobuf thật (aspect ratio, status, mode, tier...) |
| [08-errors.md](08-errors.md) | 59 mã lỗi public + mã lỗi HTTP |
| [09-media-delivery.md](09-media-delivery.md) | Tải media: redirect 307 sang CDN có signature |
| [10-ui-automation.md](10-ui-automation.md) | Đường CDP/Playwright khi không dùng API trực tiếp |
| [11-evidence.md](11-evidence.md) | Nguồn bằng chứng cho từng mục, mức độ tin cậy |

## Mức độ bằng chứng

Mỗi endpoint trong tài liệu được gắn một nhãn:

- `[VERIFIED]` — đã bắt được request/response thật, có status code và shape.
- `[OBSERVED]` — đã thấy endpoint được gọi (có status) nhưng chưa c vó đầy đủ payload.
- `[BUNDLE]` — đường dẫn lấy từ bundle JS của frontend, chưa bắt được lưu lượng thật.

Không dùng nhãn nào khác. Nếu một chi tiết là suy diễn, tài liệu ghi rõ "suy diễn".

## Cảnh báo

Đây là API nội bộ, không được Google công bố và không có cam kết ổn định.
Đường dẫn, tên field và bảng giá credit có thể đổi bất kỳ lúc nào. Trước khi đưa
vào production, chạy lại bước thử bằng chứng ở [11-evidence.md](11-evidence.md).

Tài liệu này chỉ ghi tên field và kiểu dữ liệu. Không lưu token, cookie, ID người
dùng, ID project hay ID media thật.
