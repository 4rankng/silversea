# SIL-729 (id 849) — Chi hộ 7.298.000₫ gom 'Chưa xác định': sửa join phí ↔ lô/chuyến

- Ticket: SIL-729 (board SIL, id 849, tạo 07/11/2026, HIGH). Lane K1.
- Surface: `/accounting/phoi-phieu` (Báo cáo thu/trả phơi), `/debt` +
  `/payables` (Tổng hợp sản lượng vận tải theo tháng) — cả 3 đọc MỘT query
  backend `getPhoiPhieuReport` (phoi-phieu-control.service.ts).

## Bug (kết quả thực tế trước fix)

12 chuyến 7.298.000₫ gom 1 dòng 'Chưa xác định' (báo cáo gốc). Evidence PewPie
07/11 (SIL-741, account hoapt): dữ liệu tăng — **13 chuyến / 7.418.000₫** vẫn
gom 'Chưa xác định', mỗi dòng chi tiết 'Phải thu: Chưa xác định | Phải trả:
Chưa xác định'. Nguyên nhân: bucket step
(:1333-1338) chỉ tra party qua `source.tripId` — phí OPS gắn shipment nhưng
tripId NULL (lô nhiều chuyến, phí chung lô, link chỉ tự gắn khi shipment có
đúng 1 chuyến live) rơi hết vào 1 bucket theo TÊN. Không có fallback
shipment → khách hàng/nhà xe dù `expense_accounting_sources.shipmentId` NOT NULL.

## Luật giữ nguyên (không phá)

- FB-061: khách hàng master đã soft-delete → tên KHÔNG bao giờ in; tiền vẫn
  báo cáo dưới 'Chưa xác định' (LEAK-3 THU); TRA carrier đã xóa danh mục →
  'Đơn vị vận chuyển không còn trong danh mục', KHÔNG phải 'Chưa xác định'
  (LEAK-4). Tiền không bao giờ rơi khỏi báo cáo (audit surface).
- `linkExpenseToRealTrip`: chỉ tự gắn khi đúng 1 chuyến live — luật unique
  candidate; TRA fallback qua shipment phải cùng luật (≠1 chuyến live →
  không đoán).

## Case pin (expected sau thay đổi)

1. THU: phí trip-less có shipment → party = khách hàng operationalName của
   shipment (master live); shipment không còn / master xóa → vẫn 'Chưa xác
   định'.
2. TRA: phí trip-less có shipment với đúng 1 chuyến live → party = tên nhà xe
   theo đúng case-expression hiện có (EXTERNAL/SUPPLIER tên, OWN có BKS →
   'XE NHÀ — SILVER SEA'); 0 hoặc ≥2 chuyến live → 'Chưa xác định'.
3. Phí có tripId → luật cũ giữ nguyên (trip party, fallback deletion).
4. 'Chưa xác định' CHỈ còn chứa: phí không gắn lô nào (shipmentId null về
   mặt logic), master KH đã xóa (FB-061), TRA không xác định được nhà xe.
5. Drill-down party-lots: phí trip-less đã resolve phải hiện trong drawer
   đúng party (bỏ skip trip-less vô điều kiện).
6. Money pin: tổng phí trip-less resolve được phải ra đúng tên; tiền KHÔNG
   bao giờ rơi khỏi báo cáo, mỗi đồng đúng 1 bucket (số đo 07/11: 13 chuyến /
   7.418.000₫ — pin bất biến, không hard-code số dữ liệu).

## Regression evidence

- (điền sau) BE pure-function tests (party resolution + bucket math) +
  giữ xanh `phoi-phieu-party-lots.test.ts` hiện có, qa/2026-11-07-lane-k1/.
