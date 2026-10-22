# TiepVu 22/10-2 — nhận lệnh không bắt buộc ảnh + search kho GLC + tag NHẬP LẺ/XUẤT LẺ

Source: docs feedback 22/10 (TiepVu22Oct-2.docx items 4/5/6 — cards
261022213755a/b/c). Environment: local dev (make dev — backend :3002,
frontend :7175, PG :5441). Accounts: testplan/testaccounts.txt.

## Case TV2-A (card 261022213755a) — driver hoàn tất lô KHÔNG cần ảnh

Owner ruling (docx): "let us keep them optional, not compulsory to have image".

1. Driver account → /my-trips → trip IN_TRANSIT (đã nhận lệnh).
2. Vào e-POD (/my-trips/:id/pod): KHÔNG tải bất kỳ ảnh nào.
3. Nút "Hoàn thành chuyến" phải ENABLED (không còn gate "Cần đủ 2 ảnh e-POD").
4. Bấm hoàn thành → trip COMPLETED, về /my-trips, không lỗi 409 từ BE.
5. Với draft e-POD có 1/2 loại ảnh: submit draft thành công (BE submitPod
   không còn 409 "chưa đủ hồ sơ bắt buộc"), rồi hoàn thành thành công.
6. Luồng tải ảnh vẫn hoạt động (tùy chọn): upload đủ 2 loại → submit →
   hoàn thành — không phá.

Expected: completion gate chỉ còn milestone (auto-record), không phụ thuộc
ảnh/chứng từ. Copy không còn nói "bắt buộc" nơi ảnh đã tùy chọn.

## Case TV2-B (card 261022213755b) — search kho "GLC" trong nhập lẻ

Repro gốc: gõ đủ "GLC" → menu biến mất (không thấy data); gõ "LC" → thấy.
Root cause: text gõ trùng CHÍNH XÁC label option → onCustomValue resolve id →
form value đổi → sync effect set chosenKey → react-aria coi là pick → đóng
menu giữa chừng.

1. CUS account → tạo lô hàng nhập lẻ → ô "Kho lấy hàng (CFS/Cảng)".
2. Gõ lần lượt: G, GL, GLC (kho có label "GLC" trong danh mục chung) — menu
   dropdown PHẢI còn mở và hiện option GLC ở cả ba bước (aria-expanded=true).
3. Gõ Glc / glc — vẫn ra (case-insensitive, đã có normalize).
4. Gõ "GL" — thấy (prefix/contains, đã có).
5. Gõ text không trùng label (vd "LC") — menu mở như cũ (không hồi quy).
6. Chọn option từ dropdown → commit id đúng; Enter commit match duy nhất
   vẫn đúng (20260922_4).

Expected: typing exact-label không bao giờ đóng suggestion menu giữa chừng.

## Case TV2-C (card 261022213755c) — tag NHẬP LẺ / XUẤT LẺ cho hàng lẻ

1. CUS list (/shipments dashboard CUS workspace): lô LCL direction IMPORT →
   badge đọc "Nhập lẻ"; EXPORT → "Xuất lẻ"; lô FCL giữ "Nhập"/"Xuất".
2. Chi tiết lô (/shipments/:id): dòng "Xuất / Nhập" — LCL đọc "Nhập lẻ"/
   "Xuất lẻ"; FCL giữ nguyên.
3. Ledger container (/shipments-detail): row lot-level (LCL) direction
   đọc "Nhập lẻ"/"Xuất lẻ"; row container thường giữ "Nhập"/"Xuất".
4. Style: text-only classification, cùng band `cus-direction-badge` —
   không pill mới, không filled chrome (owner ruling classification ≠ control).

Expected: hàng lẻ phân biệt rõ với cont trên mọi surface direction, không
tăng chiều cao hàng.
