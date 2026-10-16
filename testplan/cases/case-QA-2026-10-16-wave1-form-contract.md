# Case QA-2026-10-16-wave1-form-contract — shared form contract on 4 pages (UI audit Wave 1)

Source: `docs/ui-audit-2026-10-16.md` Wave 1 (approved audit; rung-1 code-read
findings). Branch `ui/wave1-form-contract`.

## Claim
1. **ExpenseEntryPage** (`/expenses/new`, `/expenses/:id/edit`): the long form is
   grouped into uppercase-divider sub-sections (THÔNG TIN CHUNG / DANH MỤC / SỐ TIỀN /
   HIỆU LỰC khi hạng mục gia hạn / LÝ DO khi sửa); no bespoke `.expense-input` control
   skin remains (fields ride the shared `.input`); required marks use the shared
   `.ds-field__required` rose marker, not `.expense-required`.
2. **AccountingInvoiceTrackingPage add/edit modal**: the 2-col form grid collapses to
   1 column under 640px; every field in the modal uses ONE control anatomy (UUI field
   family) — no raw `className="input"` fields beside `UuiSelectField`.
3. **TruckTiresPage**: the "Serial lốp" required mark (and the tire dialogs' three
   sibling labels) renders the shared rose marker instead of a plain-text asterisk
   inside the label string.
4. **TripDetailPage**: the governance-reason modal retires `.tdp-governance-asterisk`
   for the shared rose marker.

## Reproduce (pre-fix defect)
1. `/expenses/new` — entire form sat under one `h2` "Thông tin chung"; inputs wore
   `.expense-input` (third outline treatment); required marks `.expense-required`
   (page-private class) — `ExpenseEntryPage.css:83/:227`.
2. Open the invoice-tracking modal at a 390px viewport — `.invoice-tracking-form__grid`
   stayed `repeat(2, minmax(0,1fr))` (two ~170px columns); the modal mixed raw
   `className="input"` fields with `UuiSelectField` (`AccountingInvoiceTrackingPage.css:139-143`).
3. `/fleet/tires` — "Serial lốp *" asterisk was plain label text (`tire-controls.tsx:66`).
4. `/trips/:id` → Hoàn thành/Hủy chuyến modal — `.tdp-governance-asterisk` private
   marker (`TripDetailPage.tsx:163`).

## Expected behavior (post-fix)
- All field ids, accessible label strings, state, handlers, and test ids unchanged.
- Existing tests keep passing (labels queried by `getByLabelText` exact stay exact:
  'Ghi chú', 'Bill / Booking', 'Số hóa đơn', 'Số tiền trả NCC (₫)', 'MST',
  'Nhà cung cấp', 'COM (₫)', 'Ghi chú COM', 'Ghi chú', 'Chuyến (cont)').
- No native `[required]` attributes appear on ExpenseEntryPage (pin:
  `ExpenseEntryPage.test.tsx` "no hidden native required control").
- `.expense-validity-pair` stays a full-row internal 2-col grid with no chrome
  (`ExpenseEntryPage.date-pair.verify.styles.test.ts`).
- Regression evidence: see `plans/2026-10-16-ui-wave1-form-contract/reports/` and
  `qa/2026-10-16_wave1-form-contract_*`.
