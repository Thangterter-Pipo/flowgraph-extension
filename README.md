# FlowGraph Extension — Visual Node-Based Workflow Builder for Google Flow (Veo)

[![Chrome Extension](https://img.shields.io/badge/Chrome_Extension-Manifest_V3-blue?logo=googlechrome&logoColor=white)](https://developer.chrome.com/docs/extensions/mv3/intro/)
[![React Flow](https://img.shields.io/badge/Built_with-React_Flow_12-ff0072?logo=react&logoColor=white)](https://reactflow.dev/)
[![TypeScript](https://img.shields.io/badge/Language-TypeScript_5-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

**FlowGraph** là một Chrome Extension (Manifest V3) mã nguồn mở mang lại giao diện **Node-based Visual Workflow Builder** mạnh mẽ dành riêng cho **Google Flow & Veo AI Studio** ([`flow.google.com`](https://flow.google.com/)).

Dự án giúp nhà sáng tạo nội dung, nghệ sĩ AI và nhà làm phim xây dựng, trực quan hóa và tự động hóa toàn bộ chuỗi sản xuất video điện ảnh: từ Prompt ý tưởng, mở rộng qua Gemini AI, sinh ảnh phác thảo (T2I), sinh video liên tục (I2V), mở rộng thời lượng (Extend), đến ghép timeline và xuất video thành phẩm.

---

## 🌟 Tính Năng Nổi Bật

- 🎨 **Visual Node Canvas**: Không gian làm việc trực quan vô tận với React Flow. Kéo thả tự do, click-to-edit văn bản, nối dây giữa các cổng đầu vào/đầu ra tương thích.
- ⚡ **Tối Ưu Hóa Tốc Độ Đa Phân Cảnh (Multi-Scene Speed Optimization)**:
  - **Stage Concurrency Burst**: Tự động song song hóa tối đa các tác vụ AI Gateway (lên tới 8 workers) mà vẫn đảm bảo an toàn tuyệt đối cho tab Google Flow.
  - **Chế độ Draft (Nhanh 4s/720p) vs Master (Chuẩn HQ)**: Chuyển đổi 1-click giữa chế độ duyệt nhịp phim siêu tốc và chế độ xuất bản chất lượng cao.
- 🔗 **Direct Frame Bridge (Tính Liền Mạch Thị Giác)**: Tự động trích xuất khung hình cuối (`lastFrame`) của cảnh trước để bơm thẳng vào khung đầu (`Start Image`) của cảnh sau, giải quyết triệt để vấn đề các video AI rời rạc không liên quan.
- 🎬 **Native Video Player Trên Canvas**: Trực tiếp phát, tua thời gian, điều chỉnh âm lượng và phóng to toàn màn hình các clip đã tạo ngay trên mặt từng Node.
- 📁 **Mở Dự Án Nhanh & Canvas Độc Lập**: Bấm vào bất kỳ dự án nào trên Sidepanel sẽ mở ngay Studio tương ứng. Với dự án mới tạo, Canvas luôn sạch sẽ (0 node) sẵn sàng cho ý tưởng mới.
- 🔒 **100% Client-Side & Bảo Mật Tuyệt Đối**:
  - Không thu thập, không lưu trữ và không gửi bất kỳ cookie hay mật khẩu nào ra ngoài.
  - Toàn bộ video và credit được quản lý trực tiếp trên tài khoản Google cá nhân của người dùng.

---

## 🛠️ Cấu Trúc Mã Nguồn

```text
flowgraph-extension/
├── src/
│   ├── adapters/          # Typed RPC Adapter kết nối Google Flow qua Service Worker
│   ├── background/        # Manifest V3 Service Worker: CDP automation, session, downloads
│   ├── runtime/           # Workflow engine: DAG execution planner, executors, cache
│   ├── shared/            # Type definitions, contracts, protocol messages
│   └── ui/
│       ├── sidepanel/     # Giao diện danh sách dự án bên hông trình duyệt (Sidepanel)
│       └── studio/        # Giao diện Studio Canvas toàn màn hình (React Flow)
├── public/                # Manifest.json, icons, content script
├── scripts/               # Package & build automation scripts
├── tests/unit/            # Bộ kiểm thử tự động 88 test files (Vitest)
└── vite.config.ts         # Cấu hình Vite bundle & vendor chunk splitting
```

---

## 🚀 Cài Đặt & Sử Dụng

### Cách 1: Cài Đặt Nhanh Từ Bản Đóng Gói (Khuyên Dùng)
1. Tải file ZIP release mới nhất từ thư mục [`packages/`](flowgraph-extension/packages/).
2. Giải nén file ZIP vào một thư mục trên máy tính.
3. Mở trình duyệt Chrome (hoặc Cốc Cốc, Brave, Edge), truy cập địa chỉ:
   ```text
   chrome://extensions/
   ```
4. Bật công tắc **Chế độ dành cho nhà phát triển (Developer mode)** ở góc trên bên phải.
5. Bấm nút **Tải tiện ích đã giải nén (Load unpacked)** ở góc trái và chọn thư mục vừa giải nén.
6. Truy cập [Google Flow](https://flow.google.com/) và bấm icon **FlowGraph** trên thanh công cụ tiện ích để bắt đầu sáng tạo!

### Cách 2: Tự Build Từ Mã Nguồn (Dành Cho Lập Trình Viên)
Yêu cầu: Đã cài đặt **Node.js 18+** và **npm**.

```bash
# 1. Di chuyển vào thư mục extension
cd flowgraph-extension

# 2. Cài đặt các gói phụ thuộc
npm install

# 3. Chạy kiểm thử tự động (88 test files / 1,162 tests)
npm test

# 4. Build bản sản xuất (kết quả xuất ra thư mục dist/)
npm run build

# Hoặc đóng gói thành file ZIP sẵn sàng phân phối
npm run package
```

---

## 💬 Báo Cáo Lỗi & Đề Xuất Phát Triển (GitHub Issues)

Dự án tiếp nhận mọi đóng góp, phản hồi và báo lỗi trực tiếp qua **[GitHub Issues](https://github.com/Thangterter-Pipo/flowgraph-extension/issues/new/choose)**:

- 🐛 **[Báo cáo lỗi (Bug Report)](https://github.com/Thangterter-Pipo/flowgraph-extension/issues/new?template=bug_report.md)**: Gặp sự cố hiển thị, lỗi tạo video hay trục trặc kết nối? Hãy mở issue kèm **ảnh chụp màn hình minh chứng** để đội ngũ kỹ thuật xử lý nhanh nhất.
- 💡 **[Đề xuất tính năng (Feature Request)](https://github.com/Thangterter-Pipo/flowgraph-extension/issues/new?template=feature_request.md)**: Bạn cần bổ sung node mới, preset khung hình hay ý tưởng cải tiến quy trình? Hãy chia sẻ ý tưởng cùng cộng đồng!

---

## 🔒 Cam Kết Bảo Mật & Quyền Riêng Tư (Privacy)

- **Quyền hạn tối thiểu**: Extension chỉ yêu cầu quyền hoạt động trên đúng tên miền `flow.google.com`.
- **Không xâm phạm dữ liệu**: Không có máy chủ trung gian nào đọc lén prompt, nội dung ảnh hay video của bạn.
- **Tiêu chuẩn mở**: Toàn bộ mã nguồn phía Client được công khai minh bạch để cộng đồng cùng kiểm tra và đóng góp.

---

## 📄 Giấy Phép & Tác Quyền

- Dự án được phát hành theo giấy phép **MIT License** — xem chi tiết tại file [LICENSE](LICENSE).
- Được phát triển với ❤️ bởi đội ngũ **Thangterter-Pipo**.
