# BE reds cuối — 11 fail bền qua 3 wave: root cause = cross-run interference trên DB dùng chung

Ngày: 2026-10-19 · Card theo dõi: các suite Q10/Q15/Q11/Q03, card 20260928_168,
card 081026104400-511 (vat), card 20260922_57 (quotation xlsx) · Worktree:
`fix-be-reds-final` (base main `64f81514`).

## Chẩn đoán (evidence)

Mỗi suitefail khi chạy full nhưng XANH khi chạy riêng — qua 3 wave fix không hết.
Bằng chứng thu được trong phiên này:

1. **Concurrent full-suite chạy song song trên cùng dev DB** (`pg_stat_activity`
   + `ps`): worktree `fix-be-reds-w4-b` đang chạy `tsx --test src/tests/*.test.ts`
   trong khi full-suite của session này cũng chạy — 3 tiến trình test cùng lúc.
2. **Cài đặt payroll bị treo (dangling)**: `app_settings.salary.payroll_business_unit_id = 2267`
   trỏ vào business unit KHÔNG tồn tại (unit active: 1, 211, 575, 1411, 1469,
   1559, 1783) → mọi readiness COMPANY-scope ném 409 "Đơn vị tính lương đã
   cấu hình không còn hoạt động". Đã dọn về trạng thái gốc (row absent).
3. **Pin UPDATE-only**: q10/q11 pin payroll unit bằng bare UPDATE — no-op âm thầm
   khi row chưa tồn tại → suite chạy COMPANY scope (quét 2368 driver seed).
4. Suite green khi chạy riêng/sequence-tail (q03→vat: 1045 test, 1044 pass,
   fail duy nhất là Q23 field-operations — lớp can thiệp uploads, ngoài 11;
   log không giữ lại) — fail chỉ xuất hiện khi có writer đồng thời trên:
   - singleton `app_settings` payroll (q09/q10/q11/q15/m73/final cùng ghi),
   - singleton `vat_config` + cache Redis `config:vat` (2 suite vat),
   - aggregate toàn công ty: đếm `quotations` (q57), hội tụ sổ quỹ↔169 (card168),
   - deadline chờ audit (q03, 20×50ms < 1s) dưới tải DB 3 lần.

## Cases

### REDS-CONC-01 — payroll pin race + dangling restore
- Reproduce: 2 tiến trình chạy cùng lúc q09↔q10 (hoặc để q09 fail giữa test khi
  setting=unit rồi after xóa unit); hoặc xóa row app_settings rồi chạy q10/q11
  (pin UPDATE no-op).
- Expected: mọi suite payroll (q09/q10/q11/q15/m73/final) serialize qua advisory
  lock `(906416,1)`; pin bằng upsert; teardown restore giá trị/gốc-absent TRƯỚC
  khi xóa unit; restore fail ⇒ giữ unit, không bao giờ để setting treo.
- Files: `helpers/cross-suite-lock.ts` (mới), q09, q10, q11, q15-salary-period-routes,
  m73, final-q01-q02-q07-q08-coverage.

### REDS-CONC-02 — vat singleton + cache race
- Reproduce: 2 tiến trình cùng chạy vat-config-singleton (hoặc cache-shape):
  process B delete row giữa PUT và GET của process A.
- Expected: cả 2 suite vat giữ advisory lock `(906416,2)` suốt before→after
  (kể cả teardown delete + cacheInvalidate).
- Files: vat-config-singleton, vat-config-cache-shape.

### REDS-CONC-03 — q57 đếm quotations toàn công ty
- Reproduce: tiến trình khác commit quotation giữa 2 lần count của test
  "unmatched factory aborts the sheet".
- Expected: pin "no partial write" scope theo customer của sheet (card
  20260922_57 contract: sheet abort không ghi gì CHO SHEET ĐÓ), không đếm
  toàn công ty.
- Files: q57-baogia-xlsx.

### REDS-CONC-04 — card168 hội tụ đọc 2 lần cách nhau
- Reproduce: advance write của tiến trình khác commit giữa
  `listFundBook` và `listMonthlyReconciliationReport` → hai aggregate "một
  định nghĩa" đọc ở 2 thời điểm lệch nhau.
- Expected: đọc cặp liên tục, cho phép 3 lần settle-reread; divergence thật
  (không hội tụ sau 3 lần) vẫn fail — pin card 168 câu 1 giữ nguyên.
- Files: card168-fund-book-period.

### REDS-CONC-05 — q03 deadline chờ audit/notification
- Reproduce: tải DB 3 suite đồng thời → audit row (persist sau res.end) trễ
  hơn 1s → wait 20×50ms trả thiếu row → deepEqual fail.
- Expected: wait budget 100×100ms (10s).
- Files: q03-payment-receipts-route.

## Phạm vi fix

Không đổi product code, không đổi contract nghiệp vụ — chỉ tăng tính deterministic
của test infrastructure trên DB dùng chung (pattern đã có precedent:
`freight-pricing-config-routes.test.ts` dùng `pg_advisory_lock` cho cùng mục đích).

## Not covered

- Các suite KHÔNG được sửa trong đợt này vẫn có thể đỏ nếu chạy đồng thời với
  suite khác đụng chung bảng (ví dụ Q23 field-operations uploads) — đã thấy 1
  case như vậy trong tail-slice log (404!==200, ngoài phạm vi 11).
- Full-suite gate sạch chỉ có ý nghĩa khi KHÔNG có tiến trình test khác chạy
  song song trên DB này.
