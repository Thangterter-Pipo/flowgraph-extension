# NHẬT KÝ THỰC THI QUY TRÌNH TẠO VIDEO (VIDEO GENERATION RUN LOG)
**Hệ thống:** FlowGraph Studio × Google Flow (Veo 3.1 Lite Keyframe Interpolation)  
**Kịch bản:** *Cô bé và linh vật rừng phát sáng (Anime Ghibli Style)*  
**Dự án Google Flow:** `https://flow.google.com/project/a412e256-8534-43c7-bfb9-71f15a2944df`  
**Tài khoản thực thi:** `thang1411238030@gmail.com` (`⚡ PRO Daily`)  
**Thời gian hoàn thành:** 2026-09-08 03:20:00 (UTC+7)  
**Trạng thái tổng thể:** `SUCCESS (100% COMPLETED)`

---

## 1. BẢNG TỔNG HỢP CẤU HÌNH & KẾT QUẢ TỪNG NODE (7/7 NODES)

| Node ID | Tên Node | Loại (Kind) | Trạng thái | Model & Thông số | Đầu vào (Inputs) | Dữ liệu đầu ra (Outputs / Artifacts) |
| :--- | :--- | :--- | :---: | :--- | :--- | :--- |
| **Node 1** | Prompt 1 (Start Frame) | `prompt` | `SUCCESS` | Text String | Không | Prompt mô tả bé gái ngắm đốm sáng lơ lửng |
| **Node 2** | Text to Image #1 | `t2i` | `SUCCESS` | `Banana 2` · 16:9 · x1 | `Prompt` (từ Node 1) | **Image Asset:** `ba6f7fad-5676-488d-a849-46086949f46c`<br>*(Linh vật đang lơ lửng trước mặt, tay mở nhẹ)* |
| **Node 3** | Prompt 2 (End Frame) | `prompt` | `SUCCESS` | Text String | Không | Prompt mô tả bé gái khi đốm sáng đã đậu vào tay |
| **Node 4** | Text to Image #2 | `t2i` | `SUCCESS` | `Banana 2` · 16:9 · x1 | `Prompt` (từ Node 3) | **Image Asset:** `587c2568-ffec-49d8-aad7-8b434c7b6c37`<br>*(Linh vật đậu gọn gàng trong lòng bàn tay khum lại)* |
| **Node 5** | Mô Tả Cảnh (Scene Prompt) | `prompt` | `SUCCESS` | Text String | Không | Prompt mô tả quỹ đạo bay và hành động tiếp xúc |
| **Node 6** | Tạo Cảnh (Start - End Frame) | `interpolation` | `SUCCESS` | `Veo Lite` · 720p · 8s · 16:9 · x1 | `Start` (từ Node 2)<br>`End` (từ Node 4)<br>`Prompt` (từ Node 5) | **Video Clip ID:** `9b79bf52-c98a-40d3-bdfe-2f4769f72589`<br>**Asset ID:** `a4e913dd-041f-44f2-8dc8-0d9def513a08`<br>**Resolution:** 1280x720 (AVC1/H.264), 48kHz Stereo |
| **Node 7** | Final Video | `download` | `SUCCESS` | File MP4 720p (8s) | `Media` (từ Node 6) | **File Name:** `flowgraph-video.mp4`<br>Đã kích hoạt trình phát tương tác và nút Download |

---

## 2. CHI TIẾT CÁC CÂU LỆNH NHẮC (PROMPTS) ĐÃ THỰC THI

### 2.1. Prompt Khung Đầu (Start Frame - Node 1):
```text
A cinematic hand-painted animated film scene of a young girl standing in a quiet enchanted forest at dusk. She is around 12 years old, with short dark brown hair, large gentle eyes, and a simple cream dress with a light blue cardigan and a small satchel. In front of her floats a tiny glowing forest spirit shaped like a soft round creature with leaf-like ears and warm golden light. The girl looks surprised and curious, slightly leaning forward with one hand lifted. The forest is filled with tall trees, mossy stones, tiny flowers, floating dust particles, and soft evening mist. Warm poetic lighting, delicate painterly background, expressive character acting, richly detailed foliage, whimsical magical atmosphere, high-end animated feature film quality, 16:9 composition.
```

### 2.2. Prompt Khung Cuối (End Frame - Node 3):
```text
A cinematic hand-painted animated film scene of the exact same young girl in the exact same enchanted forest at dusk. She has short dark brown hair, large gentle eyes, a cream dress, a light blue cardigan, and a small satchel. The tiny glowing forest spirit has now gently landed in her open hands, radiating a warm golden light onto her face. The girl smiles softly with wonder and tenderness. Keep the same forest setting, mossy stones, tiny flowers, and soft evening mist. Warm poetic lighting, delicate painterly background, expressive character acting, richly detailed foliage, whimsical magical atmosphere, high-end animated feature film quality, 16:9 composition.
```

### 2.3. Prompt Mô Tả Chuyển Động Diễn Hoạt (Motion Interpolation - Node 5):
```text
The young girl slowly reaches both hands toward the floating forest spirit. The spirit gently circles once in front of her face with a soft golden trail, then peacefully lands into her open palms. The girl looks surprised at first, then smiles warmly with wonder as the golden light illuminates her face. Smooth camera push-in, poetic gentle animation, Studio Ghibli style, high-end animated film quality.
```

---

## 3. THÔNG TIN FILE NGUỒN & ARTIFACTS VIDEO THÀNH PHẨM

- **Video Container Format:** ISO Media, MP4 Base Media v1 [IS0 14496-12:2003]
- **Video Codec:** `avc1.42E033` (H.264 Baseline Profile L3.1)
- **Độ phân giải thực tế:** `1280 × 720` (Chuẩn tỷ lệ 16:9)
- **Thời lượng chuẩn:** `00:00:08.000` (8 giây)
- **Audio Codec:** `mp4a.40.2` (AAC-LC Stereo, 48000 Hz, 2 Channels)
- **Direct Video Stream CDN URL:**
  ```text
  https://flow-content.google/video/9b79bf52-c98a-40d3-bdfe-2f4769f72589?Expires=1788858766&KeyName=labs-flow-prod-cdn-key&Signature=u5oXD_7eFrV8HBfEpBWOIlaTJV8
  ```
- **Poster Thumbnail URL:**
  ```text
  https://flow.google.com/asb/AB-nOUaLYGSTQnz4hjUXPBQXzQaCPD2SceRv-IRJJY1Ynczw4wLfKNh-L7zAjKKtKg-2CT3P5xXnGlEAqW2mg9VzK3f9EfApEPmnIRbxaOVyjOUNrYZPg_PSUoefLh10YBS21Lp-0jCrXSLWaPPSOtB9GFkpDz0RXvMwnadX01OdUw
  ```

---

## 4. CÁC ĐIỂM SỬA CHỮA KỸ THUẬT QUAN TRỌNG TRONG QUÁ TRÌNH THỰC THI

1. **Khắc phục đè chéo kết quả (Single Target Reverse Sync Collision):**
   - *Nguyên nhân:* Google Flow phát sự kiện `resultMedia` toàn cục mà không có ID node, dẫn đến việc `toStudio.write()` ghi đè ảnh số 2 lên ảnh số 1.
   - *Đã sửa:* Chặn `resultMedia` tự động ghi đè ở tầng reverse sync trong `main.tsx`. Tách biệt độc lập `Start Frame` (lơ lửng) và `End Frame` (trên tay).
2. **Khai thông Endpoint Nội Suy Trực Tiếp (Direct AISandbox API Bypass):**
   - *Nguyên nhân:* Việc chuyển đổi giao diện Image $\rightarrow$ Video qua DOM bị trễ khiến nút Generate bị vô hiệu hóa.
   - *Đã sửa:* Định tuyến `interpolation` trực tiếp qua API endpoint `video:batchAsyncGenerateVideoStartAndEndImage` với token media xác thực của Google Flow.
3. **Sửa lỗi Trình Phát Video (Video Player Controls & Z-Index Layering):**
   - *Nguyên nhân:* Thumbnail poster nằm ở `z-index: 1` che mất nút bấm của video player bên dưới.
   - *Đã sửa:* Xây dựng component `SafeVideoPlayer`, nâng `.player-overlay` lên `z-index: 5` (`pointer-events: auto`), đưa nút Play tròn kính thủy tinh và thanh thời lượng `0:00 / 0:08` nổi lên bề mặt để click phát trực tiếp trên Canvas.
4. **Chuẩn hóa Dây Cáp Nối (Standard Cubic Bézier & Z-Index Subordination):**
   - *Yêu cầu:* Dây trở về đường cong tự nhiên mềm mại và luôn nằm dưới thân các Node.
   - *Đã sửa:* Khóa cứng CSS `.react-flow__edges { z-index: 0 !important; }` và `.react-flow__nodes { z-index: 1 !important; }`. Toàn bộ dây cáp chạy ngầm bên dưới thân node, hoàn toàn không đè lên mặt ảnh hay thông số điều khiển.
