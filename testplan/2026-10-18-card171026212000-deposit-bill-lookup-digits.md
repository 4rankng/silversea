# Card 171026212000 — Thêm cược: tra cứu Bill không gợi ý (verify-fail FB-096)

- **Case ID:** `171026212000-deposit-bill-lookup-digits`
- **Column:** TODO (SilverSea kanban) — verify-fail regression on FB-096
  (landed 48ed1fe1, staging QA PASS build 11720424).
- **Reported:** owner verify — in Kế toán → Theo dõi hoàn cược → **Thêm cược**,
  the Bill/Book lookup ("Tra cứu Bill (4 số cuối)") shows NO suggestions for
  lots that exist.

## Reproduction (local dev DB, prod-mirror data)

1. Log in as `ketoan` (ACCOUNTANT), open `/accounting/deposit-tracker`.
2. Click **Thêm cược**.
3. In "Tra cứu Bill (4 số cuối)", type the last four digits of a real
   reference whose printed tail is not pure digits, e.g. lot `FB020-R21-RB1`
   → digits run `020211` → type `0211`.
4. Observed: no suggestion items; the form claims
   "Không có lô hàng nào kết thúc bằng 0211. Nhập tay bên dưới."
5. Same for every `-IMP/-EXP/-FCL/-NEW/-SEED` style reference (booking refs
   like `RARBOOK-1792226038601-9bzut2` → `0192`, because the
   suffix's own 9 and 2 digits continue the run).

## Root cause

`findBillSuggestions` (backend/src/services/bill-book-search.service.ts)
matches `right(bl_number, 4) = digits` / `right(booking_ref, 4) = digits` —
the last four **characters**. The owner ruling (2026-10-14) and the field
label say **"4 số cuối"** — the last four **digits** of the number as printed.
Any reference with a non-digit suffix fails: local dev DB has 640 live
references, 444 with ≥4 digits, of which **193 (43%)** have a non-digit tail
and can never match. FB-096's tests seeded only pure-digit tails
(`YMLU7742`, `ONE7742`, `HLXU7742`) and the staging QA script picked a
pure-digit bill too, so landing gates could not see the gap.

Secondary defect in the same flow (error swallowed): when the suggestion
query fails (401/5xx), the form renders the same "Không có lô hàng nào…"
message as a genuine empty match — an API error is indistinguishable from
"no lot found".

## Expected behavior (after fix)

- Typing the last four DIGITS of a reference finds the lot even when the
  printed reference ends in non-digit characters (`FB020-R21-RB1` + `0211`
  → suggestion with display `FB020-R21-RB1`).
- Pure-digit-tail references keep matching exactly as before (landing
  behavior preserved).
- Fewer than 4 digits / non-digits still rejected 400 (unchanged).
- A failed suggestion lookup renders an explicit error line, never the
  "no lot" message.

## Coverage added

- Backend: `backend/src/tests/deposit-bill-suggestions.test.ts` —
  non-digit-suffix fixture (BL and Booking variants) matched by digit tail;
  digit-run-extension pin (`…-9bzut2` found by `4292`, not by the inner
  block's tail); soft-deleted booking-tail lot never offered (groups the
  or-branches — the bare `sql\`A or B\`` inside `and()` had let the booking
  branch bypass the tombstone filter).
- Frontend: `DepositRefundTrackerPage.test.tsx` — suggestion flow renders
  items + autofill, and lookup failure shows the error line instead of the
  no-match message.
- Removed `backend/src/services/deposit-bill-suggestions.service.ts` —
  orphaned duplicate of this service (zero importers since the F6
  consolidation) still carrying the old last-4-characters SQL.
