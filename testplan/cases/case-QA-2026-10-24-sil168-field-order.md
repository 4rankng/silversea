# Case QA-2026-10-24-SIL168 — Tạo mới lô hàng: Hình thức XNK phải đứng TRƯỚC Số Bill/Booking (ruling B)

Ticket SIL-168 (board plan.tingting.vip); owner ruling B 24/10 sau khi khách
gửi lại đúng văn bản cũ lần 3. Supersedes case-QA-2026-10-23-fb127-bill-booking-order.
Surface: /shipments/new → section "Nhận diện lô" → `ShipmentCreateIdentitySection`.

## Root cause

9f174360 (FB-127) đọc spec gomhang 23/10 "chốt theo luồng chứng từ giấy" và đặt
Số Bill/Booking TRƯỚC Hình thức XNK, chia 2 cụm divider. Khách chưa từng yêu
cầu thứ tự đó — văn bản khách (23+24/10) chỉ nói "đổi vị trí 2 trường" từ bố
cục gốc mà khách biết (XNK trước Bill). Owner 24/10 chốt B: đảo lại.

## Expected (sau fix)

| ID | Bước | Kỳ vọng |
|---|---|---|
| SIL168-R1 | Mở /shipments/new | Band 1: Khách hàng · Hình thức XNK; band 2: Số Bill/Booking · Hãng tàu (FCL); band 3: Tuỳ chọn full width; band CUỐI: Số tờ khai. Không còn cụm "CHỨNG TỪ & ĐỊNH DANH"/"PHÂN LOẠI NGHIỆP VỤ" |
| SIL168-R2 | Đọc DOM order | Hình thức xuất nhập khẩu đứng trước Số Bill/Booking |
| SIL168-R3 | Chưa chọn hướng | Bill/Booking disabled + hint "Chọn Hình thức xuất nhập khẩu trước" (gate blNumber XOR bookingRef giữ nguyên — FB-113) |
| SIL168-R4 | Chọn Nhập/Xuất | Bill/Booking enable, placeholder theo hướng như cũ |
| SIL168-R5 | Semantics | Tờ khai chip input per-cont copy (CUS-05/REQ-22), conflict warning, flags, Hãng tàu FCL-only: giữ nguyên logic |
| SIL168-R6 | Vitest | `ShipmentCreateIdentitySection.test.tsx` pin DOM order mới + strip cuối section |

## Rule (PRD)
docs/prd/TaoMoiLoHang.md §1 — RULE owner 24/10 (SIL-168, ruling B) + bảng lịch
sử 3 lần đảo. Không đảo lần 4 không có ruling.

## Verify
- `qa/2026-10-24_sil168-field-order/` — vitest/typecheck + UI drive screenshot.
