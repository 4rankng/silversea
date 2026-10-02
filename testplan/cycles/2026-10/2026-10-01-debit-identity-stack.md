# QA-AUDIT-UI-30 — separate record identity facts

Open accounting debit close, scroll actual populated rows and horizontally
through all columns at390/768/1440. Code, Bill/Booking and customer must occupy
distinct readable lines rather than concatenate; sticky identity remains
visible and no value is discarded. Save exact DOM rectangles/values, screenshot
and equal200 API reads. Other accounting records need their own coverage.

When Bill/Booking is absent, show Chưa có số Bill/Booking, never internal SHP.

Phone continuation: at390px, read the first record's Bill/Booking, customer,
container, totals and reconciliation status without horizontal scrolling.
Open Chi tiết and inspect every remaining shown column. Details must not select
the record. Select via its checkbox, open Chọn Debit, then Hủy; no financial
write occurs. Change to Trang sau and back, filter to one record and confirm
pagination resets. At768/1440 retain table keyboard selection and all columns.
