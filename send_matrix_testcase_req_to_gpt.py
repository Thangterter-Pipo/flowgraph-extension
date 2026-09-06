import sys, json, time, urllib.request

sys.path.insert(0, 'E:/Flow_veo/chatgpt-web-bridge')
from chat_client import chat_with_web_gpt

prompt = """Chào Kiến trúc sư trưởng GPT,

Bố vừa chỉ đạo trực tiếp một nhiệm vụ trọng tâm về Kiểm định chất lượng toàn diện (Full Combinatorial Matrix Testing & QA/QC Automation):

======================================================================
CHỈ ĐẠO CỦA BỐ:
"Yêu cầu tạo ra tất cả các test case nhỏ, ví dụ như T2I thì tạo nhiều test phối hợp tất cả các trường hợp cấu hình giữa:
 - Tỉ lệ khung hình (5 tỉ lệ: 16:9, 4:3, 1:1, 3:4, 9:16)
 - Mô hình AI (3 model: Nano Banana Pro, Nano Banana 2, Nano Banana 2 Lite)
 - Số lượng tạo (4 mức: x1, x2, x3, x4)
Tạo ra nhiều flow và test trực tiếp trên UI áp dụng với tất cả các node còn lại, đảm bảo output chính xác với cấu hình.
Làm việc cùng ChatGPT, yêu cầu ChatGPT tạo FULL BỘ TEST CASES chi tiết cho Pipo làm. Pipo làm xong từng đợt sẽ chạy automation trên UI thật, thu thập bằng chứng và báo cáo lại để ChatGPT đánh giá và giao việc tiếp."
======================================================================

Để hiện thực hóa đúng 100% chỉ đạo của bố, Pipo kính đề nghị Kiến trúc sư trưởng:

1. Xây dựng MA TRẬN TEST CASES TỔ HỢP TOÀN DIỆN (Full Combinatorial Test Matrix) cho từng Node:
   - Node 1: Text to Image (T2I)
     * 3 Models x 5 Aspect Ratios x 4 Batch Multipliers = 60 tổ hợp cấu hình.
   - Node 2: Image to Video (I2V)
     * 4 Video Models (Omni 1.1 Flash, Veo 3.1 Lite, Fast, Quality) x 2 Ratios (16:9, 9:16) x 2 Resolutions (720p, 360p) x 4 Durations (4s, 6s, 8s, 10s) x 4 Batches (x1..x4).
   - Node 3: Start - End Frame (Interpolation)
     * Tổ hợp giữa Video Model, Start/End Image Model, Ratios, Durations, Resolutions, Batches.
   - Node 4: Prompt, Upload Image, Image Upscale, Video Upscale, Final Video Download/Playback.

2. Tiêu chí kiểm định từng Test Case trên UI (Assertion Criteria):
   - Thay đổi cấu hình trên Node / Popup -> Graph State (`node.data.config`) cập nhật chính xác.
   - Estimated Credits tính toán đúng 100% theo ma trận registry.
   - Dynamic Handles/Ports và dây nối Bézier giữ đúng trạng thái kết nối và tương thích kiểu dữ liệu.
   - Không gây crash, không vỡ layout, không sinh xung đột sync DOM giữa Studio và Google Flow.

3. Phân chia Lộ trình Thực thi theo các Batch/Giai đoạn (Sprint Phase):
   - Chia thành các giai đoạn rõ ràng (ví dụ: Batch A - T2I Matrix, Batch B - I2V Matrix, Batch C - Interpolation & Upscale Matrix, Batch D - Multi-flow E2E).
   - Mỗi giai đoạn có ID test case chuẩn hóa (vd: `TC-T2I-01` -> `TC-T2I-60`), kèm kịch bản chạy tự động bằng script Chrome CDP live + Vitest.

Kính mời Kiến trúc sư trưởng lên kế hoạch chi tiết, ban hành bộ Test Case chuẩn để Pipo bắt tay vào viết automation test và chạy thực nghiệm ngay lập tức!
"""

print("[*] Đang gửi yêu cầu của bố sang Kiến trúc sư trưởng GPT Web...")
res = chat_with_web_gpt(prompt, timeout_s=3600.0)

resp_text = ""
if isinstance(res, dict):
    if res.get("ok"):
        resp_text = res.get("response", "")
    else:
        resp_text = f"Error: {res.get('error')}"
else:
    resp_text = str(res)

print("\n[=== PHẢN HỒI TỪ KIẾN TRÚC SƯ TRƯỞNG GPT ===]\n")
print(resp_text)

with open("E:/Flow_veo/gpt_full_testcase_matrix_plan.txt", "w", encoding="utf-8") as f:
    f.write(resp_text)

print("\n[+] Đã lưu toàn bộ bộ test case vào E:/Flow_veo/gpt_full_testcase_matrix_plan.txt")
