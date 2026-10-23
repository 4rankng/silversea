# Kế hoạch test — Redesign Chi phí - Quyết toán (CUS) · 2026-10-24

Nguồn: owner screenshots 23/10 ("UI UX layout shitty") + audit 5 điểm + thông báo
spec final v2 (23/10 tối). Scope FE `/shipments-debit` + additive BE wire fields.

## Trường hợp regression

### QT-RD-01 — Cân đối cột + số right-align (audit #1)
- Repro: mở `/shipments-debit` 1440×900.
- Expected: 11 cột cố định (Checkbox 44 · Mã lô/Booking 130 · Tờ khai 160 ·
  Tuyến 144 · Chứng từ 130 · Doanh thu 130 · Cước trả hãng 120 · Chi nội địa
  130 · Tổng chi 130 · LN gộp 140 · Trạng thái+kebab 90); header 1 dòng nowrap,
  cột tiền header + data right-align cùng mép; `tabular-nums`; row ≤ 56px,
  align-middle, 1 baseline ngang mỗi cell.

### QT-RD-02 — Bỏ lặp mã / ALL-CAPS / 'Chưa xác định' (audit #2 #3)
- Expected: Số Bill hiện đúng 1 lần (cột Mã lô, mono, không prefix 'S6 Bill:');
  tên KH hiển thị 1 lần ở group header Title Case (không ALL-CAPS mỗi row);
  không còn chuỗi 'Chưa xác định' trong ô tiền — 3 trạng thái tiền: số |
  '0' (đã tính, = 0) | pill 'Chờ số liệu' (chưa chốt); '—' cho ô không phát
  sinh dữ liệu (tờ khai/nhà máy). Doanh thu không còn in đậm đỏ.

### QT-RD-03 — Bộ lọc 1 cơ chế ngày (audit #4)
- Repro: đếm cơ chế chọn ngày trên màn + topbar.
- Expected: 1 Unified Date Range Picker (trigger 280×36, popover preset dọc +
  dual-month calendar, auto-apply); KHÔNG còn pills rời + cặp Từ/Đến cũ +
  month-picker topbar trên route này; select phụ 180px 'Khóa lô' (chính tả
  đúng); chip 'Xóa bộ lọc (N)' đếm số tiêu chí đang áp.

### QT-RD-04 — Group khách + totals sticky (audit #5)
- Expected: group header 38px theo khách (sticky dưới table header): tên KH
  Title Case + badge 'N lô' + subtotal 3 cột tiền right tabular; chevron
  collapse/expand; tfoot sticky bottom 'TỔNG CỘNG (N lô)' + Σ 5 cột tiền =
  tổng các ô cột (assert DOM); KHÔNG còn nút đen 'KHÓA LÔ HÀNG' giữa layout —
  hành động row nằm trong menu ⋯.

### QT-RD-05 — Gộp hàng toolbar (audit #4/#5)
- Expected: nút 'Gộp hàng' (secondary sm, icon Layers 16px, không emoji) trên
  action bar ngang 'Xuất Debit Note'; checkbox luôn hiển thị (canManage);
  nút chỉ enable khi ≥ 2 tick; tick giữ nguyên qua expand/collapse; đổi filter
  xóa selection cũ.

### QT-RD-06 — Chứng từ badge + popover (audit #2)
- Expected: 1 badge đếm '[2/2]' (đủ) hoặc rose 'Thiếu N C/T' (thiếu); hover/
  click mở popover checklist Bill/Booking + Tờ khai (✓ số / ✗ Chưa đính kèm);
  số tờ khai truncate 1 dòng + tooltip + copy 1 click.

### QT-RD-07 — Mobile 390
- Expected: card list theo KH; tổng bar hiển thị; chip trạng thái; tiền theo
  3 trạng thái như QT-RD-02.

### QT-RD-08 — Expand L2 giữ nguyên
- Expected: mở 1 row (menu ⋯ → 'Mở chi tiết lô') vẫn mount LCL facts +
  workspace đầy đủ; đóng lại collapse.

## Ghi chú ánh xạ dữ liệu (spec v2 vs wire — không bịa)
- 'Chi hãng tàu' ← `carrierCostTotal` (Cước trả = Σ trip_carrier_info
  .external_freight_cost) — field MỚI additive trên BE + shared zod.
- 'Chi nội địa' ← `opsCostTotal` (ops expense entries) — field MỚI như trên.
- 'Tuyến POL→POD' không có trên L1 wire → cột hiển thị NHÀ MÁY (factoryName,
  tooltip địa chỉ) — chờ wire field tuyến.
- 'MST/Mã KH', TMS viền vàng, '(PDF)', '· N file' — không có dữ liệu nguồn,
  không render (ghi nhận trong qa README + commit body).
- 'Khoản mục' select: không có chiều dữ liệu thật trên L1 → giữ select
  'Khóa lô' (chính tả đúng) 180px; filter khoản mục chờ wire.
