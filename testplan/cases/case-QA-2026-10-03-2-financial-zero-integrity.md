# Case QA-2026-10-03-2 — Financial zero integrity (card 20261002_293, R28/D02)

## Claim
A computed financial value of 0 renders as "0 ₫" (quietly toned where the
surface distinguishes), never as a dash, blank, or "Chưa xác định". VND money
renders without decimals at the display edge.

## Reproduce
1. Login `admin` (Abc123) at http://localhost:7175.
2. Open Công nợ phải trả (`/payables`), expand "Tuổi nợ nhà cung cấp · mở chi tiết".
3. Any supplier with a 0 in an aging bucket renders that bucket "0 ₫"
   (muted ink), e.g. Shell Vietnam → 0-30 ngày shows "0 ₫".
4. Any customer detail with creditLimit 0 renders "0 ₫", not "—"
   (`/customers`, open a customer with an explicit 0 limit).
5. Trip create (`/trips/new`) with an empty suggested price: "Giá trị chuyến
   dự kiến" reads "0 ₫", never "Chưa xác định".

## Expected behavior
- 0 ₫ is a value; only null/NaN renders the house empty token (— ₫).
- Aging bucket tones stay muted at 0; non-zero buckets keep their warning tones.
- formatCurrency/formatMoney round fractional VND at display (no decimals).

## Automated pins
- `frontend/src/lib/format.test.ts` — zero + grouping + rounding pins.
- `frontend/src/lib/money-zero-suppression-law.test.ts` — app-wide source scan
  banning the self-suppression shape (structural ledger split allowlisted).
- `shared` calculation suite — `round2dp(0) === 0` (round.test.ts) and the
  full 241-test run.

## Regression guard
The law test fails on any future `x ? formatCurrency(x) : '—'` /
`x > 0 ? formatMoney(x) : '—'` self-suppression introduced outside the
allowlisted structural case.
