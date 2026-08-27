# 9. Tải media

## 9.1 Chuỗi phân phối

Video không được trả về trực tiếp từ API sinh. Chuỗi đầy đủ:

```text
mediaId (UUID)
   |
   v
GET https://labs.google/fx/api/trpc/media.getMediaUrlRedirect?name=<mediaId>
   |  307
   v
https://flow-content.google/video/<mediaId>
   ?Expires=<unix-ts>&KeyName=labs-flow-prod-cdn-key&Signature=<sig>
   |  200 video/mp4
   v
file mp4
```

Ba điều quan trọng:

1. URL CDN có **signature và thời hạn**. Không lưu lại được lâu; lấy lại qua
   `getMediaUrlRedirect` mỗi lần cần tải.
2. Bước redirect cần cookie session của `labs.google` (không dùng bearer token).
3. Với `fetch(..., { redirect: "follow" })` từ page context, browser tự đi hết chuỗi
   và trả về `video/mp4`.

## 9.2 Lấy `mediaId`

Ba nguồn, theo độ tin cậy giảm dần:

| Nguồn | Cách lấy |
|-------|----------|
| Response API sinh video | `media[].name` — tốt nhất |
| Response poll trạng thái | `media[].name` |
| DOM | `document.querySelector("video").src` chứa `getMediaUrlRedirect?name=<mediaId>` |

Đường DOM chỉ dùng khi tự động hoá UI. Với đường API, `media[].name` có ngay từ
response đầu tiên, trước khi video render xong.

## 9.3 Thumbnail

Thêm `mediaUrlType=MEDIA_URL_TYPE_THUMBNAIL` để lấy ảnh đại diện thay vì video:

```text
GET /fx/api/trpc/media.getMediaUrlRedirect?name=<mediaId>&mediaUrlType=MEDIA_URL_TYPE_THUMBNAIL
```

## 9.4 Ảnh: không cần redirect

Ảnh trả về `fifeUrl` trực tiếp trong response của `flowMedia:batchGenerateImages`. Đây
là URL FIFE (hạ tầng ảnh của Google), dùng được ngay, không qua bước 307.

## 9.5 Đặc điểm file đã kiểm chứng

Một video sinh bởi `veo_3_1_t2v_fast` với `VIDEO_ASPECT_RATIO_PORTRAIT`:

| Thuộc tính | Giá trị |
|------------|---------|
| Kích thước | 720 x 1280 |
| Codec | H.264 + AAC |
| Độ dài | 8.0 giây |
| Frame rate | 24 fps |
| Dung lượng | ~3.7 MB |
| Content-Type | `video/mp4` |

Khớp đúng với `videoLengthSeconds: 8` và aspect ratio đã đặt trong request.

## 9.6 Tải từ server

Nếu tải từ ngoài browser, phải mang cookie session của `labs.google` và cho phép
redirect:

```python
import requests

def download_flow_video(media_id: str, session_cookies: dict, out_path: str) -> int:
    """Tải mp4 của một media. Trả về số byte đã ghi."""
    url = "https://labs.google/fx/api/trpc/media.getMediaUrlRedirect"
    with requests.get(
        url,
        params={"name": media_id},
        cookies=session_cookies,
        allow_redirects=True,   # bắt buộc: bước đầu trả 307
        stream=True,
        timeout=120,
    ) as res:
        res.raise_for_status()
        ctype = res.headers.get("content-type", "")
        if "video" not in ctype:
            raise RuntimeError(f"không phải video, nhận được: {ctype}")
        total = 0
        with open(out_path, "wb") as fh:
            for chunk in res.iter_content(chunk_size=1 << 16):
                fh.write(chunk)
                total += len(chunk)
    return total
```

Kiểm tra `content-type` trước khi ghi file: nếu session hết hạn, bước redirect có thể
trả về HTML trang đăng nhập thay vì video, và file ghi ra sẽ hỏng mà không báo lỗi.

## 9.7 Xoá và dọn dẹp

- `POST /v1/flow:batchDeleteAssets` `[VERIFIED]` 400 — đưa media vào Thùng rác.
- `POST /fx/api/trpc/project.deleteProject` `[VERIFIED]` — xoá cả project.

Xoá project là thao tác không hoàn tác được qua API. Với project chứa media thật, nên
xác nhận lại trước khi gọi.
