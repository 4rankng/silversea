# SIL-919 — Dàn trải hiển thị KB 24/11: tab lô hàng, dính cont/loại, kg→tấn, ngày DD/MM/YYYY (2026-11-24)

Board: SIL (plan.tingting.vip), ticket SIL-919 (id 1078). Trunk `main`, no branch.
Source: audit KB 24/11 (`/tmp/kb-conformance-sil-2026-11-24.md`) mục **3.2**, **6.5**, **7.1**,
**3.9**, **10.4** (§3.1.5, §3.1.7, §6.4, §7.2.1 CUS-08, §10.1.1, §10.3.2, §10.8.1, §10.8.4).
Doctrine: `uiux` (POLISH), house design law book (`docs/design-system/README.md`,
`docs/design-guidelines.md`).

## Regression cases

| ID | Ticket | Surface | Expected |
|---|---|---|---|
| TC-919-TABS-01 | SIL-919(a) | `/shipments` → thanh thẻ chức năng | Thanh thẻ **"Tất cả lô hàng"** (đang chọn, kèm số lô) và **"Hóa đơn kết hợp"** (vị trí dựng sẵn — **disabled**, không phải liên kết chết). Không có tablist "Trạng thái lô hàng" trước khi dữ liệu về (luật cũ giữ nguyên). |
| TC-919-REV-01 | SIL-919(a) | `/shipments` → cột **Tổng thu Khách (Không Hóa đơn)** | Cột hiện `item.finance.customerNoInvoiceTotal` (tiền thu khách KHÔNG kèm hóa đơn) định dạng `1.500.000 ₫`; giá trị null hiện `—` (không bịa 0). Cột nằm sau "Lịch trình & điều xe", trước "Ghi chú"/"Trạng thái". Thang độ rộng cột (chốt ladder) vẫn cộng đúng 100% ở CẢ hai băng (mặc định + ≥1024px). |
| TC-919-REV-02 | SIL-919(a) | `/shipments` → ô tìm kiếm | Placeholder = **"Bill, Book, Cont, Tờ khai..."** — KHÔNG nhắc "Mã lô" (mã kỹ thuật nội bộ, §1.4.3). |
| TC-919-CONT-01 | SIL-919(b) | `/accounting/invoice-tracking` → cột **CONT & CHỨNG TỪ** | Số container và loại container KHÔNG dính liền: text của ô là `MNBU0006614 · 40'DC` (có dấu " · " thật trong DOM, không phải margin), không phải `MNBU000661440'DC`. |
| TC-919-KG-01 | SIL-919(c) | `/accounting/phơi phiếu` → cột **THÔNG SỐ CONTAINER** | Trọng lượng hiển thị theo **TẤN** (`28,2 tấn`), không phải `28.200kg` (CUS-08 / §7.2.1). |
| TC-919-CONT-02 | SIL-919(d) | `/dispatch` (Kế hoạch Tổng quát) | Bảng KHÔNG in "Chưa có cont" ở bất kỳ ô nào. Lô chưa có container hiện **"Chưa có số container"**; lô hàng lẻ vẫn hiện số kiện / khối lượng / thể tích (FB-091). Bảng XLSX (master-plan export) dùng CHUNG một hàm nên cũng đổi theo. |
| TC-919-CONT-03 | SIL-919(d) | `/ops/orders` (Kế hoạch làm hàng) | Cột CONT không in "Chưa có cont"; lô chưa có container hiện "Chưa có số container". LCL vẫn hiện "1 cont" (SIL-601). |
| TC-919-DATE-01 | SIL-919(e) | `/shipments-debit` + `/accounting/ghep-bo-debit` → cột **NGÀY** | Ngày hiện **DD/MM/YYYY** (lưới dùng chung), không phải `YYYY-MM-DD`. |
| TC-919-DATE-02 | SIL-919(e) | `/accounting/chot-debit` → caption kỳ | Caption đọc `kỳ 01/11/2026 – 24/11/2026`, không phải `kỳ 2026-11-01 – 2026-11-24`. |
| TC-919-DATE-03 | SIL-919(e) | `/accounting/phơi phiếu` → caption kỳ | Caption đọc `Ngày 01/11/2026 – 24/11/2026`, không phải `Ngày 2026-11-01 – 2026-11-24`. |
| TC-919-DATE-04 | SIL-919(e) | `/timesheet/doi-chieu` → cột **Ngày** | Ngày hiện DD/MM/YYYY; nhãn a11y của ô "Chỉnh lệch chuyến" cũng đọc DD/MM/YYYY (người dùng AT đọc đúng như màn hình). |
| TC-919-DATE-05 | SIL-919(e) | `/accounting/deposit-tracker` → 3 cột ngày | Ngày cược / Ngày nộp CV / Ngày dự kiến hoàn cược hiện **DD/MM/YYYY** (4 chữ số năm), không phải dạng rút gọn `DD/MM/YY`. |

## Luật áp dụng

- §10.8.4 (chuẩn hiển thị ngày): **DD/MM/YYYY** và **DD/MM/YYYY HH:mm** trên toàn hệ thống.
  Mọi màn trong bảng trên dùng HÀM DÙNG CHUNG `formatISODate` / `formatDate` của
  `frontend/src/lib/format.ts` — không còn màn nào tự cắt chuỗi ngày riêng.
- §1.4.3 (không lộ mã kỹ thuật nội bộ): gợi ý tìm kiếm của `/shipments` không nhắc
  "Mã lô" (mã lô `SHP-*` là mã nội bộ).
- §10.8.1 (không dính chữ trong bảng): số container và loại container là hai sự thật
  riêng, phải đọc được là hai sự thật.
