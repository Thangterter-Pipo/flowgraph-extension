# FlowGraph Extension — Node-Based Workflow Builder for Google Flow (Veo)

**FlowGraph** là một Chrome Extension (Manifest ) giao diện Node-based Visual Workflow Builder dành cho **Google Flow & Veo AI Studio** (`labs.google/fx/tools/flow`). 

Dự án giúp xây dựng, quản lý và tự động hóa các chuỗi xử lý sinh hình ảnh, video (Text-to-Video, Image-to-Video, Video Extend, Image Upsample, Character Consistency) theo dạng sơ đồ khối trực quan.

---

## 🌟 Tính Năng Nổi Bật

- 🎨 **Visual Node Canvas**: Kéo thả và nối các Node (Text Prompt, Image Input, Model Selector, Video Generation, Upsample, Export).
- 🔄 **Realtime Bi-directional Sync**: Đồng bộ trạng thái 2 chiều trực tiếp với giao diện Google Flow mà không cần reload.
- 🚀 **CDP & Trusted Gesture Automation**: Tự động hóa điền prompt, kích hoạt reCAPTCHA Enterprise Gesture và trigger submit trực tiếp vào React Slate Editor của Google Flow.
- 🎬 **Character & Multi-Scene Support**: Quản lý tính nhất quán của nhân vật (Character Slotting) và dựng phim nhiều cảnh (Multi-Scene Sequencing).
- 📦 **Standalone Studio UI**: Giao diện Studio độc lập tích hợp SidePanel và Canvas full-screen.

---

## 🛠️ Cấu Trúc Dự Án

```text
flowgraph-extension/
├── src/                      # Mã nguồn chính (React, TypeScript, Vite)
│   ├── adapters/             # Google Flow / Gemini adapters (typed RPC tới Service Worker)
│   ├── background/           # Service Worker: automation CDP, session, download
│   ├── runtime/              # Workflow runtime: DAG planner, executors, cache, polling
│   ├── shared/               # Typed bridge, sync contracts, timeouts
│   └── ui/                   # Studio fullscreen + Sidepanel (React Flow canvas)
├── public/                   # Static assets, content script & manifest.json (nguồn build)
├── scripts/                  # Build bridge & automation scripts
├── tests/unit/               # Unit tests (Vitest)
└── vite.config.ts            # Vite Build Configuration (studio.html, sidepanel.html)
```

---

## 🚀 Cài Đặt & Sử Dụng

### 1. Build Extension từ Source
```bash
# Cài đặt dependencies
npm install

# Build bản sản phẩm Manifest V3 (output ra thư mục dist/)
npm run build
```

### 2. Tải Extension vào Trình Duyệt Chrome / Cốc Cốc
1. Mở Chrome và truy cập: `chrome://extensions`
2. Bật cờ **Developer mode (Chế độ dành cho nhà phát triển)** ở góc trên bên phải.
3. Bấm **Load unpacked (Tải tiện ích đã giải nén)** và chọn thư mục `dist/` vừa build (hoặc giải nén từ bản release ZIP).
4. Mở trang Google Flow ([`flow.google.com`](https://flow.google.com/)) để trải nghiệm FlowGraph Extension!

---

## 💬 Báo Cáo Lỗi & Đề Xuất Phát Triển (Issues)

Dự án tiếp nhận mọi phản hồi, đóng góp và báo cáo lỗi trực tiếp qua **[GitHub Issues](https://github.com/Thangterter-Pipo/flowgraph-extension/issues)**:
* 🐛 **Báo cáo lỗi (Bug Report)**: Gặp trục trặc khi chạy node, giao diện hoặc kết nối Google Flow? Vui lòng tạo issue kèm ảnh chụp màn hình minh chứng.
* 💡 **Đề xuất tính năng (Feature Request)**: Bạn cần thêm node xử lý mới, preset tỷ lệ khung hình hay công cụ hỗ trợ nào? Hãy mở issue để đội ngũ phát triển xem xét và triển khai!

---

## 🔒 Cam Kết Bảo Mật & Quyền Riêng Tư (Privacy)
* Extension hoạt động **100% Client-side** trên trình duyệt của người dùng.
* Chỉ tương tác với tab `flow.google.com` của chính bạn.
* **Tuyệt đối KHÔNG thu thập, lưu trữ hay gửi cookie/mật khẩu Google** ra bất kỳ máy chủ bên ngoài nào.
* Toàn bộ tài nguyên ảnh/video sinh ra thuộc quyền sở hữu của bạn và lưu trên tài khoản Google cá nhân.

---

## 📄 Giấy Phép & Tác Giả
- **Phát triển bởi**: Thangterter-Pipo
- **Giấy phép**: MIT License
