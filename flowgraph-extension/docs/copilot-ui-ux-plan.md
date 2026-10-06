# Kế hoạch UI/UX Copilot FlowGraph — đề xuất chờ duyệt

## Mục tiêu và phạm vi
Thiết kế theo nghiệp vụ dựng graph → xem thay đổi → duyệt chi phí → chạy → theo dõi kết quả. Chỉ lập kế hoạch; không sửa code, không render, không commit. Cơ sở đánh giá: DOM bố cung cấp và mã FloatingCopilotDock.tsx/theme.css trong hội thoại; chưa kiểm tra lại filesystem/live ở lượt này.

## Vấn đề hiện tại
- Composer trộn thao tác hội thoại với thao tác canvas và quản lý vị trí.
- Sidebar hiện là absolute overlay; đổi vị trí không tương đương sidebar dành riêng không gian.
- Nhãn model mặc định hardcode có nguy cơ khác cấu hình request thực.
- File chip không chứng minh nội dung được gửi: mã đã đọc chỉ nối text; ảnh có preview nhưng không được truyền vào runPrompt; video/audio/document nhị phân chưa có parser/upload.
- Placeholder quảng cáo @ và / khi chưa có bằng chứng triển khai.
- Build/test pass không chứng minh tính đúng đắn UX, attachment và approval live.

## Phương án
A. Composer nổi tối giản: ít chiếm chỗ nhưng kém khi hội thoại, duyệt và theo dõi dài.
B. Panel Copilot dockable + composer tối giản: đề xuất. Sidebar mặc định bên phải, hỗ trợ trái và đáy; dành chỗ thật trong layout, canvas co giãn.
C. Workspace AI toàn màn hình: nhiều diện tích nhưng che workflow, chưa cần.

## Bố cục đề xuất
- Header panel: AI Director, trạng thái ngắn, menu vị trí, thu gọn.
- Body cuộn độc lập: hội thoại, thẻ đề xuất thay đổi graph, thẻ approval, thẻ tiến độ.
- Footer cố định: context/attachment tray → textarea → nút thêm tệp, model selector, gửi/dừng.
- Canvas toolbar riêng cùng hệ thiết kế: Undo/Redo, Auto Layout, Fit; Reset trong menu phụ và xác nhận. Không đặt Reset cạnh Gửi.
- Header chỉ dùng một menu vị trí thay vì ba icon cạnh Gửi.

## Layout
- Mặc định sidebar phải 380px, resize khoảng 320–520px; trái dùng cùng component.
- Đáy là panel ngang dành riêng không gian, không overlay lên canvas; composer giữa, tối đa khoảng 760px. Khi thu gọn chỉ còn header/composer; vùng hội thoại mở rộng theo nhu cầu.
- Giữ nguyên draft, attachments, scroll và tiến trình khi đổi vị trí; không remount agent.
- Giữ canvas sử dụng được ở màn hình nhỏ; dưới ngưỡng không đủ hai vùng thì dùng panel mở/đóng, không ép hàng công cụ tràn.

## Luồng nghiệp vụ
1. Người dùng nhập yêu cầu, thêm tệp và chọn model tương thích.
2. Tệp: selected → reading/uploading → ready hoặc unsupported/error; nút gửi chờ tệp xử lý xong. Không gửi metadata rồi ngụ ý AI đã đọc nội dung.
3. AI phân tích và đề xuất: tóm tắt cảnh/thời lượng thật, node thêm/sửa/xóa; xem chi tiết theo yêu cầu.
4. Approval card: số cảnh, model sinh media, thời lượng, credit ước tính, phạm vi chạy. Nếu chưa biết giá phải ghi chưa xác định, không giả số.
5. Một hành động Duyệt & chạy, vô hiệu hóa ngay khi xử lý để chống double-click. Runtime phải xác thực duyệt, không dựa vào disabled button. Thay đổi kế hoạch làm duyệt cũ mất hiệu lực.
6. Tiến độ: queued/submitted/rendering/success/failed; xem node lỗi và retry có phạm vi. Không restart toàn graph mặc định.
7. Dừng Agent và dừng workflow là hai hành động riêng; không hứa hủy job provider đã nhận.

## Model và attachment
- Model dropdown lấy danh sách/capability từ gateway hoặc registry đã xác minh; không tự đổi model chỉ để khớp ảnh mẫu.
- Chọn model phải khớp request thực, lưu qua settings store có sẵn sau khi khảo sát; không thêm localStorage song song.
- Text/Markdown/CSV/JSON đọc văn bản có giới hạn; ảnh gửi multimodal nếu model hỗ trợ; PDF/Office cần parser, video/audio cần adapter phù hợp. Tệp không hỗ trợ có trạng thái rõ, không giả thành công.
- Giới hạn số lượng/dung lượng, hủy đọc/upload, retry, gỡ file, giải phóng preview URL và thông báo dữ liệu gửi tới provider.

## Visual system
Monochrome, nền đặc, viền nhẹ, không glow/gradient. Radius 10–12px cho composer, spacing 4/8/12/16px; body 13–14px. Icon 14–16px trong vùng click tối thiểu 28–32px. Màu ngữ nghĩa chỉ cho lỗi/cảnh báo. Không gắn chất lượng bằng nhãn pixel-perfect.
Enter gửi, Shift+Enter xuống dòng; không gửi khi IME đang compose. Focus visible, accessible labels, Escape đóng menu, keyboard navigation và tương phản đủ đọc.

## Thứ tự triển khai sau duyệt
1. Khảo sát lại main.tsx, FloatingCopilotDock.tsx, SettingsModal.tsx, AgentClient.ts, FlowGraphAgent.ts và theme.css; xác nhận luồng approval, settings và attachment hiện hữu.
2. Dựng layout/sidebar và prototype ba vị trí, trạng thái empty/chat/approval/error; nghiệm thu hình trước khi wiring.
3. Tách component có trách nhiệm rõ: CopilotPanel, ChatComposer, ModelSelector, AttachmentTray, ApprovalCard, RunProgress; tên/path mới là đề xuất, chưa tồn tại được xác minh.
4. Nối model/settings và file capability thực; không quảng cáo chức năng chưa hỗ trợ.
5. Bảo toàn callback canvas, run locks và approval gate; bỏ toolbar trùng và CSS cũ trong phạm vi.
6. Typecheck/build, regression tests liên quan và kiểm thử live không phát sinh credit.

## Tiêu chí nghiệm thu
- Ba vị trí không đè canvas hoặc che nút; sidebar thực thay vì card nổi góc.
- Không overflow ở 1280×720, 1440×900, 1920×1080 và zoom 125%.
- Thao tác đổi vị trí không mất draft/file/hội thoại; textarea dài không đẩy nút gửi ra ngoài.
- Dropdown model chọn bằng keyboard; request dùng đúng model, không chỉ đổi nhãn.
- Kéo thả ảnh/text/tệp không hỗ trợ/file quá lớn có trạng thái đúng; xác minh payload, không chỉ nhìn chip.
- Approval đang chờ, double-click, sửa graph sau duyệt, cancel/retry không vượt rào credit.
- Canvas undo/redo/layout/reset bị khóa đúng lúc chạy.
- Screenshot và tương tác live từng vị trí; unit test xanh không thay thế nghiệm thu UI.
- Không render trả phí nếu bố chưa duyệt riêng.
