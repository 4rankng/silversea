# Case 2026-10-16 — Chi phí - Quyết toán: CHỨNG TỪ cell link reads "Chi tiết" (owner report, screenshot)

## Claim
On `/shipments-debit` ("Chi phí - Quyết toán"), the CHỨNG TỪ cell's link reads
"Chi tiết lô hàng →". The owner ruled the short form is enough: "Chi tiet is
enough, no need chi tiet lo hang". The long label wraps onto two lines inside
the narrow docs column and repeats the screen's own subject (every row already
IS a lô hàng).

## Reproduce (pre-fix defect)
1. Log in locally as `ketoan` (see `testplan/testaccounts.txt`) and open `/shipments-debit`, pick a customer.
2. Look at any lot row's CHỨNG TỪ column, under "Số Bill" / "Số tờ khai".
3. Pre-fix: the link text is "Chi tiết lô hàng →" and wraps (arrow drops to its own line at narrow width).

## Expected behavior
The link reads "Chi tiết →" — same target (`/shipments/:id`), same styling,
hover `title` still explains the destination ("Xem chi tiết lô hàng"). The
phone card variant (`ShipmentDebitRecords.tsx`) has no such link; nothing else
on the page carries this label.

## Fix
`frontend/src/pages/ShipmentDebitPage.tsx` — docs-cell `<Link>` label
`Chi tiết lô hàng →` → `Chi tiết →`.

## Verification
- Pin: `ShipmentDebitPage.test.tsx` → "links the CHỨNG TỪ cell with the short
  Chi tiết → label" (label, href `/shipments/101`, hover title) — file green 29/29.
- Driver: `testplan/qa/scripts/2026-10-16-debit-detail-link-rung.mjs` (local,
  `ketoan`/ACCOUNTANT, buildHash `dev`) — **UI DRIVEN, rung 3**, 7/7 checks:
  - `qa/2026-10-16_debit-detail-link_ui-1-cell.png` — the CHỨNG TỪ cell reads
    "Chi tiết →" on ONE line (no wrap); all 3686 row links carry it, 0 stale.
  - `qa/2026-10-16_debit-detail-link_ui-2-destination.png` — the real click
    lands on `/shipments/38`, heading "BULK-IMP-0019", rail "Đang xem Chi tiết
    lô hàng" as Nguyễn Thị Mai (Kế toán).
  - DB read-only proof: `shipments` id=38 row byte-identical before/after the
    click (`38 |  | READY_FOR_DISPATCH | 1 | BULK-IMP-0019 | 2026-03-01 …`).
  - `qa/2026-10-16_debit-detail-link_ui-dom.json`,
    `qa/2026-10-16_debit-detail-link_ui-driver.log` (exit 0).
- Widths: 768 PASS (`…-768_*`, 7/7); 1440 PASS (above). 390 renders the phone
  card variant, which has no docs-cell link at all — the control's surface is
  the table view ≥641px only (`…-390_ui-1-page.png` shows the cards).
