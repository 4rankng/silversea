# Case QA-2026-10-23-FB127 — Tạo mới lô hàng: Số Bill/Booking phải đứng TRƯỚC Hình thức XNK

Card 231026163927 (QA R39 residual; TIEPVU-21, yêu cầu Tiệp Vũ 23/10 — MỚI
NHẤT, thắng card 261023093200 và case QA-2026-10-23-create-field-order).
Surface: /shipments/new → section "Nhận diện lô" → `ShipmentCreateIdentitySection`.

## Root cause

Card 261023093200 đặt Hình thức XNK cạnh Khách hàng (band 1), Số Bill/Booking
xuống band 2. Tiệp Vũ 23/10 (FB-127): Số Bill/Booking phải đứng TRƯỚC Hình
thức XNK — thứ tự chốt theo luồng chứng từ giấy.

## Expected (sau fix — supersedes case-QA-2026-10-23-create-field-order)

| ID | Bước | Kỳ vọng |
|---|---|---|
| FB127-R1 | Mở /shipments/new | 2 cụm có divider trong "Nhận diện lô": cụm "CHỨNG TỪ & ĐỊNH DANH" (Khách hàng, Số Bill/Booking, Hãng tàu FCL, Số tờ khai) và cụm "PHÂN LOẠI NGHIỆP VỤ" (Hình thức XNK, Tuỳ chọn) |
| FB127-R2 | Đọc DOM order | Số Bill/Booking đứng trước Hình thức xuất nhập khẩu |
| FB127-R3 | Chưa chọn hướng | Bill/Booking vẫn disabled + hint "Chọn Hình thức xuất nhập khẩu trước" (gate blNumber XOR bookingRef giữ nguyên — FB-113 ledger) |
| FB127-R4 | Chọn Nhập/Xuất | Bill/Booking enable, placeholder theo hướng như cũ |
| FB127-R5 | Semantics | Tờ khai chip input, conflict warning, flags, Hãng tàu FCL-only: giữ nguyên logic |
| FB127-R6 | Vitest | `ShipmentCreateIdentitySection.test.tsx` pin DOM order mới |

## Rule (PRD)
Thứ tự field chốt theo luồng chứng từ giấy; thay đổi sau này cần approval
Lead Ops. (ghi docs/prd/TaoMoiLoHang.md + comment code)

## Verify
- `qa/2026-10-24-gomhang-r39/` — Playwright trước/sau.
