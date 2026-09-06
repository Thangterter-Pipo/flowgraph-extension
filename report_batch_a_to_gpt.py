import sys, json, time, urllib.request

sys.path.insert(0, 'E:/Flow_veo/chatgpt-web-bridge')
from chat_client import chat_with_web_gpt

report = """Chào Kiến trúc sư trưởng GPT,

Pipo báo cáo KẾT QUẢ NGHIỆM THU CHI TIẾT BATCH A (FULL 60 / 60 T2I COMBINATORIAL MATRIX) theo đúng chỉ đạo:

======================================================================
KẾT QUẢ NGHIỆM THU GIAI ĐOẠN QA-A1 (T2I COMBINATORIAL MATRIX):
 - Mã kịch bản: TC-T2I-001 -> TC-T2I-060 (Đủ 60/60 test cases)
 - Không gian tổ hợp:
   * 3 Models: 🍌 Nano Banana Pro, 🍌 Nano Banana 2, 🍌 Nano Banana 2 Lite
   * 5 Tỷ lệ khung hình: 16:9, 4:3, 1:1, 3:4, 9:16
   * 4 Số lượng tạo (Batch Multiplier): x1, x2, x3, x4
   * 60/60 cấu hình độc lập được kiểm định.

KẾT QUẢ THỰC THI:
 1. Unit / Contract Test (Vitest):
    - File test: FullT2IMatrix60.test.ts
    - Kết quả: 61/61 PASSED (100%)
 2. Live UI Automation trên Chrome CDP 9222:
    - File script: run_live_t2i_60_matrix.py
    - Kết quả: 60/60 PASSED (100% PASS_UI_STATE)
    - File bằng chứng JSON đã lưu: E:/Flow_veo/batch_a_t2i_60_matrix_evidence.json
 3. Fix kỹ thuật nền tảng:
    - Chuẩn hóa aspectCode() trong flowModelRegistry.ts để map đúng các tỷ lệ ngắn (16:9, 4:3, 1:1, 3:4, 9:16) sang mã chuẩn LANDSCAPE, PORTRAIT, SQUARE, v.v., đảm bảo deriveRegistryConfig() không bị ép sai về giá trị mặc định.
    - Toàn bộ 60 tổ hợp khi dispatch sang UI đều hiển thị đúng Model, Ratio, Batch x1..x4 trên thẻ footer node, chi phí xác nhận 0 credits.
======================================================================

Kính mời Kiến trúc sư trưởng đánh giá kết quả nghiệm thu Batch A và giao tiếp nhiệm vụ cho BATCH B (TC-I2V-001 -> TC-I2V-256)!
"""

print("[*] Đang gửi báo cáo nghiệm thu Batch A sang Kiến trúc sư trưởng GPT...")
res = chat_with_web_gpt(report, timeout_s=3600.0)

resp_text = ""
if isinstance(res, dict):
    if res.get("ok"):
        resp_text = res.get("response", "")
    else:
        resp_text = f"Error: {res.get('error')}"
else:
    resp_text = str(res)

print("\n[=== PHẢN HỒI & GIAO VIỆC TỪ KIẾN TRÚC SƯ TRƯỞNG GPT ===]\n")
print(resp_text)

with open("E:/Flow_veo/gpt_batch_b_assignment.txt", "w", encoding="utf-8") as f:
    f.write(resp_text)

print("\n[+] Đã lưu chỉ đạo mới vào E:/Flow_veo/gpt_batch_b_assignment.txt")
