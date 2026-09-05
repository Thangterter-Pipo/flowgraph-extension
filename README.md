# FlowGraph Extension — Node-Based Workflow Builder for Google Flow (Veo)

**FlowGraph** là một Chrome Extension (Manifest V3) giao diện Node-based Visual Workflow Builder dành cho **Google Flow & Veo AI Studio** (`labs.google/fx/tools/flow`). 

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
│   ├── background/           # Service Worker & Extension Background Listener
│   ├── components/           # UI Components (Node Editor, Canvas, Controls)
│   ├── content/              # Content Script nhúng vào Google Flow
│   ├── hooks/                # Custom React Hooks
│   ├── studio/               # Giao diện Studio Fullscreen
│   └── sidepanel/            # Giao diện SidePanel Manifest V3
├── manifest.json             # Extension Manifest V3 Specification
├── packages/                 # Core Packages & Workflow Engine
├── proxies/                  # Service Worker & Proxy Bridge Modules
├── scripts/                  # Build & Automation Scripts
└── vite.config.ts            # Vite Build Configuration
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
3. Bấm **Load unpacked (Tải tiện ích đã giải nén)** và chọn thư mục `dist/` vừa build.
4. Mở trang Google Flow ([`labs.google/fx/tools/flow`](https://labs.google/fx/tools/flow)) để trải nghiệm FlowGraph Extension!

---

## 📄 Giấy Phép & Tác Giả
- **Phát triển bởi**: Thangterter-Pipo & Papi AI Family
- **Giấy phép**: MIT License
