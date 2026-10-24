# PRD — Tạo mới lô hàng (Tiếp nhận / CUS)

Quy trình tiếp nhận lô hàng lẻ (LCL) và nguyên container (FCL) tại màn
"__Tạo mới lô hàng__" (`/shipments/new`). Tài liệu này ghi các quy tắc
**đang áp dụng**; lịch sử quyết định nằm ở [CHANGELOG.md](CHANGELOG.md).

## 1. Thứ tự trường phần "Nhận diện lô" (SIL-168 / owner ruling B 24/10)

> **RULE (chốt owner 24/10 — SIL-168, ruling "B", khách yêu cầu lần 3):**
> _Hình thức XNK đứng **TRƯỚC** Số Bill/Booking; Số tờ khai là band cuối cùng
> của phần Nhận diện lô. Thay đổi sau này cần approval Lead Ops._

Bố cục dạng band phẳng (không còn cụm divider của FB-127):

| Band | Trường | Ghi chú |
|---|---|---|
| 1 | Khách hàng · Hình thức xuất nhập khẩu | Chủ lô chọn hướng XNK trước |
| 2 | Số Bill/Booking · Hãng tàu (FCL) | Bill/Booking gate theo hướng đã chọn ở band 1 |
| 3 | Tuỳ chọn (Lệnh chạy ngoài / Có cược container / Đóng kết hợp) | Full width |
| 4 (cuối) | Số tờ khai (chip input dán nhiều số) | Dưới cùng phần Nhận diện lô |

### Lịch sử 3 lần đảo thứ tự (đừng đảo lần 4 không có ruling)

| # | Thời điểm | Bố cục | Nguồn |
|---|---|---|---|
| 1 | 23/10 (2425726d) | XNK cạnh Khách hàng, Bill/Booking band 2, tờ khai cuối | Card 261023093200 — đúng văn bản khách 23/10 |
| 2 | 23/10 tối (9f174360) | Bill/Booking TRƯỚC XNK, chia 2 cụm "Chứng từ & định danh" / "Phân loại nghiệp vụ", tờ khai cuối cụm 1 | FB-127/TIEPVU-21 — đọc spec gomhang "chốt theo luồng chứng từ giấy" |
| 3 | **24/10 (ruling B, ticket SIL-168)** | **Trở lại bố cục (1): XNK TRƯỚC Bill/Booking, tờ khai cuối section** | Khách gửi lại đúng văn bản cũ lần 3 → owner chọn B, supersede FB-127 |

Quy tắc dữ liệu giữ nguyên bất kể bố cục:

- **Gate Bill/Booking (FB-113, đã chốt trên ledger):** ô Số Bill/Booking
  disable tới khi chọn Hình thức XNK — giá trị ghi vào `blNumber` (Nhập khẩu)
  hoặc `bookingRef` (Xuất khẩu), không bao giờ cả hai.
- Hãng tàu chỉ hiện với FCL; tờ khai là chip input dán nhiều số, semantics
  per-cont giữ nguyên (CUS-05/REQ-22).

## 2. Tiêu chí nghiệm thu

| ID | Tiêu chí |
|---|---|
| SIL168-AC1 | DOM/visual order: Hình thức xuất nhập khẩu đứng trước Số Bill/Booking |
| SIL168-AC2 | Số tờ khai là band cuối của section Nhận diện lô |
| SIL168-AC3 | Chưa chọn hướng: Bill/Booking disable + hint "Chọn Hình thức xuất nhập khẩu trước" |
| SIL168-AC4 | Chọn Nhập/Xuất: Bill/Booking enable, placeholder đúng theo hướng |
| SIL168-AC5 | Responsive 390/768/1440: band reflow không clipping, labels/values/keyboard access giữ nguyên |
