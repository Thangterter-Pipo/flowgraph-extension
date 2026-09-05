# 10. Tự động hoá qua UI

Đường API trực tiếp (xem [05-generation-flows.md](05-generation-flows.md)) đơn giản
hơn và rẻ hơn. File này dành cho hai trường hợp còn lại:

1. Cần lấy `recaptchaContext.token` — việc này bắt buộc phải có browser thực.
2. Cần dùng tính năng chỉ có trên UI (applet, scene editor, tạo nhân vật bằng UI).

## 10.1 Kiến trúc đề xuất: browser làm nguồn token, không làm nguồn logic

Cách bền nhất là giữ browser ở vai trò tối thiểu:

```text
Browser (đã đăng nhập)
  -> lấy access_token qua /fx/api/auth/session
  -> lấy recaptcha token trong page context
  -> trả hai giá trị này về cho code của mình
Code của mình
  -> gọi API trực tiếp, poll, tải file
```

Như vậy chỉ còn hai điểm phụ thuộc vào DOM (thay vì cả chuỗi bấm nút), nên ít vỡ khi
Flow đổi UI.

## 10.2 Nếu buộc phải bấm UI: các chạm đã gặp

Bốn chạm này đều làm mất thời gian nếu không biết trước.

**Ô prompt không nhận `textContent`.** Ô prompt là `contenteditable` DIV. Đặt
`textContent` hoặc dùng `insertText` không làm nút "Tạo" bỏ trạng thái `aria-disabled`.
Phải gửi **char key event** thật (`Input.dispatchKeyEvent` với `type=char` qua CDP,
hoặc `keyboard.type` của Playwright).

**Nút "Tạo" là BUTTON nhỏ, không phải DIV bao ngoài.** Nút thật chỉ khoảng 32px. Bấm
vào DIV bao quanh không có tác dụng.

**Nút "Phê duyệt" phải bấm bằng DOM.** Toạ độ y của nó có thể âm (nằm ngoài viewport
theo tính toán), nên bấm theo toạ độ sẽ trượt. Dùng `element.click()` hoặc dispatch
chuỗi pointer event.

**Radix tab không phản hồi `.click()` đơn thuần.** Các tab chọn độ dài (`4s`, `6s`) và
số lượng (`x1`...`x4`) là Radix trigger, phản hồi `pointerdown` chứ không phải `click`.
Phải dispatch đầy đủ chuỗi:

```javascript
// Dispatch chuỗi pointer event đầy đủ tại tâm element (Radix trigger).
function firePointerSequence(el) {
  const r = el.getBoundingClientRect();
  const x = r.left + r.width / 2;
  const y = r.top + r.height / 2;
  const base = { bubbles: true, cancelable: true, composed: true,
                 clientX: x, clientY: y, view: window };
  el.scrollIntoView({ block: "center" });
  el.dispatchEvent(new PointerEvent("pointerover",  { ...base, pointerId: 1, isPrimary: true }));
  el.dispatchEvent(new PointerEvent("pointerenter", { ...base, pointerId: 1, isPrimary: true }));
  el.dispatchEvent(new MouseEvent("mouseover", base));
  el.dispatchEvent(new PointerEvent("pointerdown", { ...base, pointerId: 1, isPrimary: true, button: 0, buttons: 1 }));
  el.dispatchEvent(new MouseEvent("mousedown", { ...base, button: 0, buttons: 1 }));
  el.focus?.();
  el.dispatchEvent(new PointerEvent("pointerup", { ...base, pointerId: 1, isPrimary: true, button: 0, buttons: 0 }));
  el.dispatchEvent(new MouseEvent("mouseup", { ...base, button: 0, buttons: 0 }));
  el.dispatchEvent(new MouseEvent("click", { ...base, button: 0 }));
}
```

## 10.3 Kiểm tra video xong bằng DOM

Khi không dùng API poll, đọc trạng thái từ thẻ `<video>`:

```javascript
// Video coi như xong khi có kích thước thật và duration hợp lệ.
const ready = [...document.querySelectorAll("video")].some(
  (v) => v.videoWidth > 0 && Number.isFinite(v.duration) && v.duration > 0
);
```

Cách này kém tin cậy hơn `video:batchCheckAsyncVideoGenerationStatus`: có trường hợp
kết quả chỉ hiện sau khi reload trang. Nếu dùng DOM, phải có bước reload trong vòng
poll.

## 10.4 Khu vực trong Flow (khảo sát UI)

Sidebar là nút JS, không phải link — điều hướng bằng cách bấm theo nhãn chữ:

| Nhãn | Icon | Nội dung |
|------|------|----------|
| Tất cả nội dung nghe nhìn | `dashboard` | Gallery tổng, lọc: Hình ảnh / Video / Giọng nói / Nhân vật / Hình đại diện / Tệp tải lên |
| Xem video | `videocam` | Gallery chỉ video |
| Nhân vật | `accessibility_new` | Route `/characters` |
| Xem các cảnh | `movie` | Gallery theo cảnh |
| Công cụ | `apps_spark_2` | Kho applet + tạo applet riêng |
| Thùng rác | `delete` | Media đã xoá |

Scene editor: `/fx/vi/tools/flow/project/<projectId>/edit/<sceneId>`.
Route `/scenes` trả 404 — không phải route hợp lệ.

## 10.5 Tab Nhân vật

Giữ ngoại hình nhân vật nhất quán qua nhiều shot. Model: Nano Banana 2 (`NARWHAL`),
nên không trừ credit.

Cách tạo: prompt, tải ảnh lên, hoặc chọn từ media có trong project. Có 6 template
prompt sẵn: Kẻ lập dị, Nhân vật chuyên nghiệp, Nhân vật biến hoá, Nhân vật quen thuộc,
Kẻ phản diện, Nhân vật kỳ ảo.

Giới hạn số nhân vật trong một lần sinh: 10 với model ảnh, 3 với model video (xem
`maxCharacters` ở [06-models-pricing.md](06-models-pricing.md)).

## 10.6 Tab Công cụ (applet)

`GET /v1/flowAppletAgent/applets` trả về 49 applet trong mẫu quan sát. Các nhóm và
applet ghi nhận được trên UI:

| Nhóm | Applet |
|------|--------|
| Hình ảnh | Simple Sketch, Scene Explorer, Mockup, Image Editor, Shot Explorer, Mask Magic, Converge, Grid Architect |
| Video | Shader Effects, Type Overlays, pixelBento, Poster Designer, Video Sketch, Transition Machine, Weirdcore, Video Resizer, Stringout Creator, Video Granulator |
| Đặt câu lệnh | Character X-Ray, Style Writer, Storyboard Studio, Prompt Tree, Story Sketch |
| Thử nghiệm | Frame Deconstructor, Blob Tracking, DepthWarp 4D, Webcam Set, Datamosh, 3D Model Visualizer, Scout360, Ribbit, Whisk, Pose Text, 3D Face Swap |

Danh sách này lấy từ UI ở thời điểm khảo sát, không phải từ API, nên có thể lệch. Nguồn
đáng tin là `GET /v1/flowAppletAgent/applets` với trường `categories[]`.

## 10.7 Công cụ sẵn có trong repo

`_ctl/flow_ctl.py` là một controller Playwright/Camoufox giữ một browser sống lâu, nhận
lệnh qua file (`_ctl/cmd.json` -> `_ctl/result.json`). Nó tồn tại vì camoufox-cli trên
Windows không chạy được daemon Unix-socket, và mô hình "connect rồi thoát" làm chết
browser context.

Các action hỗ trợ: `goto`, `reload`, `snapshot` (liệt kê element tương tác với ref
`@eN`), `click`, `mouse_click`, `fill`, `press`, `eval`, `text`, `screenshot`,
`upload`, `upload_chooser`, `net` (log mạng đã ẩn danh), `schemas` / `schema_dump`
(bắt hình dạng request/response), `console`, `tabs`, `switch`, `viewport`.

Controller này có sẵn cơ chế ẩn danh: nó chỉ lưu tên field và kiểu dữ liệu, mask UUID
và token, và bỏ giá trị query string. Đó là nguồn sinh ra `schemas_master.json` dùng
cho tài liệu này.
