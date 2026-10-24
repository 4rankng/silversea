# SIL-169 — [CUS][UX] Khách hàng & Đối tác redesign

Board: https://plan.tingting.vip/tingtingsoft/SIL (SIL-169, issue id 192)
Spec v1 (comment 614) + CONSULT VERDICT deepseek (comment 616 — override hình
thức, giữ cấu trúc): metric INLINE cạnh H1 (bỏ cards 88px) · toolbar 1 hàng
44px segmented · bảng 7 cột width cụ thể (KH 260/MST 110/Địa chỉ 180/Liên hệ
180/HạnTT 96/Công nợ 120/kebab 32) · row 56px · dot rủi ro 8px · chip viết tắt
h20 · bỏ tab "Tạm khoá·0" · quá hạn đỏ #B42318 · mobile card giữ v1.

## Surface

- `frontend/src/pages/CustomersPage.tsx` (/customers — officeStaffOnly)
- `frontend/src/pages/config/CustomersConfigPage.tsx` (/config/customers)
- `frontend/src/features/customers/CustomerFilters.tsx` (toolbar)
- CSS: `frontend/src/pages/CustomersPage.css`, tokens nếu cần màu mới

## Data sources (KHÔNG tạo BE mới)

- Công nợ quá hạn + rủi ro: `GET /api/financial/reports/receivables-aging`
  (existing, ADMIN/MANAGER/ACCOUNTANT — trùng khớp officeStaffOnly).
  `totals.overdueCount`, `totals.highRiskCount`, bucket amounts; per-row
  `totalOutstanding`, `maxOverdueDays`, aging buckets.
- Không phát sinh 30 ngày: `useCustomerLedgerEntries` (existing) — last entry
  timestamp per customer.
- Roles không gọi được aging (CUS/DISPATCHER trên /config/customers) → '—'.

## Regression cases

- SIL169-01: 3 metric inline cạnh H1 (không phải cards riêng), label uppercase
  11px, value 16px tabular; metric quá hạn đỏ #B42318 khi >0; thiếu data → '—'
  + data-testid (`cus-metric-overdue/-idle30/-risk`).
- SIL169-02: toolbar 1 hàng: tabs có count Tất cả/Rủi ro cao/Hoạt động (+Tạm
  khoá chỉ khi >0), search, Xuất Excel (icon, aria-label giữ tên), Thêm KH
  primary. Count Tất cả = total dataset; Rủi ro cao = aging highRiskCount.
- SIL169-03: bảng desktop 7 cột đúng width colgroup (260/110/180/180/96/120/32),
  row 56px, dot 8px (đỏ #D92D20/amber #F79009/xám #98A2B3), chip viết tắt h20
  r4 bg #F2F4F7, tên title-case, mã KH dòng 2 mono 11px; MST mono; Địa chỉ 1
  dòng ellipsis + tooltip; Liên hệ 2 dòng (chính + kế toán); Hạn TT "25 ngày";
  Công nợ right-align, quá hạn đỏ #B42318 + sub "quá hạn n ngày".
- SIL169-04: mobile <640 card list: dot + tên + chip + kebab; body grid MST/
  Địa chỉ/Liên hệ/Hạn TT; footer công nợ đỏ khi quá hạn.
- SIL169-05: config page cùng pattern: bỏ 4 KPI cards → 3 metric inline; bảng
  7 cột; tab Tạm khoá ẩn khi 0.
- SIL169-06 (carry-over FB-007): cột "Cập nhật" bị bỏ theo verdict — updatedAt
  chuyển vào drawer chi tiết; test CustomersPage.test.tsx cập nhật theo hợp
  đồng mới.
- SIL169-07: sort headers giữ nguyên hành vi server-side (name/taxCode/...).

## Expected behavior

Không đổi hành vi mutation/CRUD/selection/keyboard — chỉ layout + columns +
metrics. Xuất CSV giữ nguyên cột dữ liệu.

## Results (24/10, lane fix-sil169-khachhang-ux)

- SIL169-01 ✅ vitest: CustomersPage 'inline header metrics' + config metrics
  tests (aging + ledger mocks); UI: metrics thật từ /reports/receivables-aging
  (after-driver.log).
- SIL169-02 ✅ CustomerFilters.test tabs/counts/hidden-locked; sort.test strip
  pins; UI tabs "Tất cả 5 · Rủi ro cao 0 · Hoạt động 5".
- SIL169-03 ✅ action-column-width-budget.styles (verdict widths + coarse
  floor); CustomersPage.test 7-header; config 7-col test; sort.test grid pins.
- SIL169-04 ✅ cấu trúc card theo JSX/CSS (cus-m-card*); screenshot 390.
- SIL169-05 ✅ config: metrics test + KPI strip retired pin
  (config-catalog-tabular.styles).
- SIL169-06 ✅ FB-007 updatedAt → drawer (CustomersPage.test 'detail drawer').
- SIL169-07 ✅ sort.test server-side sort (name/taxCode) pass.

Gates: pnpm lint 0 errors · tsgo 0 · tsc -b 0 · full vitest (xem
qa/2026-10-24-khachhang-redesign/gates.log + ticket comment) · make build OK ·
design:drift no growth (baseline refresh — main đã vượt từ lane trước, evidence
stash-test) · check:ui + brand OK.

## Ghi chú

- Verdict đổi left/right toolbar (tabs trái, search phải) — house FilterBar
  band giữ DOM order search→tabs→actions; bản merge theo band (one-pattern
  law), note deviation trong ticket comment.
- 15px mobile debt → --text-section-size (14px): house ladder không có 15px
  (ui-contract checker).
- Cột kebab 32px fine-pointer, nở touch floor ở coarse (cus-col-action).

