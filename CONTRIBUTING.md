# Contributing to FlowGraph Extension 🚀

Cảm ơn bạn đã quan tâm và muốn đóng góp cho **FlowGraph Extension**! 

Dự án này là một Chrome Extension (Manifest V3) Node-based Visual Workflow Builder dành cho **Google Flow & Veo AI Studio**. Dưới đây là hướng dẫn chi tiết để bạn có thể bắt đầu đóng góp mã nguồn một cách nhanh chóng và hiệu quả.

---

## 🛠️ Quy Trình Đóng Góp (Contribution Workflow)

### Step 1: Fork & Clone Repository
1. Nhấn nút **Fork** ở góc trên bên phải của repo này để tạo bản sao về tài khoản GitHub của bạn.
2. Clone repo cá nhân về máy local:
   ```bash
   git clone https://github.com/YOUR_USERNAME/flowgraph-extension.git
   cd flowgraph-extension
   ```

### Step 2: Cài Đặt Môi Trường Phát Triển
Đảm bảo máy của bạn đã cài **Node.js** (v18+ hoặc LTS):
```bash
# Cài đặt toàn bộ dependencies
npm install

# Khởi chạy chế độ Watch Mode (tự động re-build khi sửa code)
npm run watch

# Hoặc build bản production Manifest V3 (output ra thư mục dist/)
npm run build
```

### Step 3: Tải Extension Vào Trình Duyệt Để Dev/Test
1. Mở Chrome / Cốc Cốc và truy cập: `chrome://extensions`
2. Bật cờ **Developer mode (Chế độ dành cho nhà phát triển)** ở góc trên bên phải.
3. Bấm **Load unpacked (Tải tiện ích đã giải nén)** và chọn thư mục `dist/` vừa build.
4. Mỗi khi sửa code, bạn chỉ cần nạp lại extension trên trang `chrome://extensions` và F5 lại trang Google Flow ([`labs.google/fx/tools/flow`](https://labs.google/fx/tools/flow)).

### Step 4: Tạo Branch Mới
Luôn tạo branch mới cho từng tính năng hoặc lỗi bạn muốn xử lý:
```bash
git checkout -b feat/tentinhnangmoi
# Hoặc sửa lỗi:
git checkout -b fix/mota-loi
```

### Step 5: Đảm Bảo Kiểm Thử (Unit Tests)
Dự án sử dụng **Vitest** để kiểm thử tự động. Hãy đảm bảo tất cả các test suite chạy qua sạch sẽ trước khi tạo commit:
```bash
# Chạy bộ test unit
npm test
```

### Step 6: Commit & Push Code
Viết commit message rõ ràng theo quy chuẩn Commitizen / Conventional Commits:
- `feat: ...` (Cho tính năng mới)
- `fix: ...` (Cho sửa lỗi)
- `docs: ...` (Cho cập nhật tài liệu)
- `refactor: ...` (Cho cải tiến mã nguồn không thay đổi tính năng)

```bash
git add .
git commit -m "feat: add new custom node type for audio generation"
git push origin feat/tentinhnangmoi
```

### Step 7: Mở Pull Request (PR)
1. Truy cập repo gốc `Thangterter-Pipo/flowgraph-extension`.
2. Bấm nút **New Pull Request** và chọn branch của bạn.
3. Mô tả ngắn gọn:
   - Thay đổi chính bạn đã làm là gì?
   - Lý do thay đổi hoặc link Issue liên quan (nếu có).
   - Ảnh chụp màn hình / GIF minh họa tính năng (nếu có thay đổi UI).
4. Đội ngũ phát triển (Thangterter-Pipo & Papi AI Family) sẽ kiểm tra, trao đổi và merge PR của bạn!

---

## 🎯 Quy Định Mã Nguồn (Coding Standards)

1. **TypeScript First**: Sử dụng TypeScript chuẩn, định nghĩa Interface/Type rõ ràng, tuyệt đối không dùng `any` bừa bãi.
2. **Quyền riêng tư & Bảo mật (Security & PII)**:
   - **KHÔNG BẢO LƯU SECRET**: Tuyệt đối không commit API Key, OAuth Access Tokens, Session Cookies hay Email cá nhân lên repo.
   - Luôn sử dụng `<REDACTED_EMAIL>` hoặc `<REDACTED_TOKEN>` trong các file test fixtures/mock data.
3. **CDP & Slate React Reactivity**: Khi tương tác DOM với Google Flow, lưu ý Slate Editor cần **Trusted User Gestures** (`Input.insertText` + trigger event input) chứ không thể chỉ gán `innerText` thuần.

---

## 💬 Hỗ Trợ & Thắc Mắc
Nếu có bất kỳ thắc mắc nào, bạn có thể tạo một **Issue** trên GitHub hoặc liên hệ qua kênh đóng góp dự án!

Cảm ơn bạn vì đã cùng chung tay xây dựng cộng đồng Open-Source ngày càng phát triển! 🌟
