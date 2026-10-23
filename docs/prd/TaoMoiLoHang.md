# PRD — Tạo mới lô hàng (Tiếp nhận / CUS)

Quy trình tiếp nhận lô hàng lẻ (LCL) và nguyên container (FCL) tại màn
"__Tạo mới lô hàng__" (`/shipments/new`). Tài liệu này ghi các quy tắc
**đang áp dụng**; lịch sử quyết định nằm ở [CHANGELOG.md](CHANGELOG.md).

## 1. Thứ tự trường phần "Nhận diện lô" (FB-127 / TIEPVU-21, 23/10)

> **RULE (chốt bởi Tiệp Vũ 23/10, owner-approved):** _Thứ tự field chốt theo
> luồng chứng từ giấy; thay đổi sau này cần approval Lead Ops._

Phần "Nhận diện lô" chia 2 cụm có divider:

| Cụm | Trường | Ghi chú |
|---|---|---|
| **Chứng từ & định danh** (trước) | Khách hàng · Số Bill/Booking · Hãng tàu (FCL) · Số tờ khai (strip, cuối cụm) | Số Bill/Booking đứng **TRƯỚC** Hình thức XNK |
| **Phân loại nghiệp vụ** (sau) | Hình thức xuất nhập khẩu · Tuỳ chọn (Lệnh chạy ngoài / Có cược container / Đóng kết hợp) | Hình thức XNK là field phân loại, không phải chứng từ |

Quy tắc dữ liệu giữ nguyên bất kể bố cục:

- **Gate Bill/Booking (FB-113, đã chốt trên ledger):** ô Số Bill/Booking
  disable tới khi chọn Hình thức XNK — giá trị ghi vào `blNumber` (Nhập khẩu)
  hoặc `bookingRef` (Xuất khẩu), không bao giờ cả hai.
- Hãng tàu chỉ hiện với FCL; tờ khai là chip input dán nhiều số, semantics
  per-cont giữ nguyên (CUS-05).
- Quyết định này **thắng** bố cục của card 261023093200 (Hình thức XNK lên
  hàng 1) — yêu cầu 23/10 của Tiệp Vũ là mới nhất.

## 2. Tiêu chí nghiệm thu

| ID | Tiêu chí |
|---|---|
| FB127-AC1 | DOM/visual order: Số Bill/Booking đứng trước Hình thức xuất nhập khẩu |
| FB127-AC2 | Chưa chọn hướng: Bill/Booking disable + hint "Chọn Hình thức xuất nhập khẩu trước" |
| FB127-AC3 | Chọn Nhập/Xuất: Bill/Booking enable, placeholder đúng theo hướng |
| FB127-AC4 | Responsive 390/768/1440: 2 cụm giữ divider, không clipping, labels/values/keyboard access giữ nguyên |
