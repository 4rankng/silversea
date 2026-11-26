-- SIL-1109 — đóng cửa sổ race số hóa đơn trùng (follow-up SIL-1101, K2.119).
-- Guard SIL-1101 trong invoice-number-conflict.service là check-then-insert:
-- hai request ĐỒNG THỜI (hai lô khác nhau, cùng số HĐ sau khi fold
-- ' TD-001 ' ≡ 'td-001') đều đọc thấy "chưa có" và cùng insert thành công →
-- hai nghĩa vụ thanh toán cho một chứng từ. Hai lớp khóa vá đúng cửa sổ đó:
--
-- 1) APPLICATION LOCK (invoice-number-conflict.service): pg_advisory_xact_lock
--    theo số HĐ đã fold, chặn cả race GIỮA 4 bảng (index per-table không thấy
--    được cross-table). Chạy trong transaction của caller nên giữ tới commit.
--
-- 2) 4 PARTIAL UNIQUE EXPRESSION INDEX dưới đây — chốt duy nhất ở tầng DB cho
--    mọi đường ghi, kể cả đường không đi qua guard (driver-fulfillment,
--    forwarder, sửa chi phí kế toán). Predicate khớp CHÍNH XÁC định nghĩa
--    "row sống" của guard: invoice_tracking loại row đã xóa mềm
--    (deleted_at), trip_expenses / ops_expense_entries loại VOIDED/REJECTED,
--    driver_incidental_costs không có khái niệm hủy. Biểu thức fold
--    regexp_replace(lower(col), '[[:space:]]+', '', 'g') trùng khớp INVOICE_FOLD
--    trong service — cùng một khóa so sánh với guard.
--
-- Dữ liệu hiện hành không có trùng số HĐ sống (đã kiểm 4 bảng theo cùng
-- predicate khi mở ticket — same argument as trip_pairs_active_only_unique),
-- nên tạo thẳng, không cần dedupe. Route 23505 được middleware/errorHandler +
-- withInvoiceNumberUniqueGuard đổi thành 400 tiếng Việt, không lộ text DB.
CREATE UNIQUE INDEX "invoice_tracking_live_invoice_number_key"
  ON "invoice_tracking" (regexp_replace(lower("invoice_number"), '[[:space:]]+', '', 'g'))
  WHERE "invoice_number" IS NOT NULL AND "deleted_at" IS NULL;
CREATE UNIQUE INDEX "trip_expenses_live_invoice_number_key"
  ON "trip_expenses" (regexp_replace(lower("invoice_number"), '[[:space:]]+', '', 'g'))
  WHERE "invoice_number" IS NOT NULL AND "approval_status" NOT IN ('VOIDED', 'REJECTED');
CREATE UNIQUE INDEX "driver_incidental_costs_live_invoice_number_key"
  ON "driver_incidental_costs" (regexp_replace(lower("invoice_number"), '[[:space:]]+', '', 'g'))
  WHERE "invoice_number" IS NOT NULL;
CREATE UNIQUE INDEX "ops_expense_entries_live_invoice_number_key"
  ON "ops_expense_entries" (regexp_replace(lower("invoice_number"), '[[:space:]]+', '', 'g'))
  WHERE "invoice_number" IS NOT NULL AND "approval_status" NOT IN ('VOIDED', 'REJECTED');
