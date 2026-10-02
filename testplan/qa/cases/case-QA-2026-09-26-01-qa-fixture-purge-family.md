# Case QA-2026-09-26-01 — QA fixtures must never surface on business pages (family _41–_45)

- **Case ID:** QA-2026-09-26-01
- **Reported:** 2026-09-26, Director drain order — cards 20260925_41..45 (agy #4 audit haul, CHIEF
  26/09), one root cause ordered by the Director: fixtures on staging were never purged; per-page
  verification, not five page patches.
- **Root cause (scout-verified):** prod is CLEAN (0 QA rows on all surfaces, read-only census); QA
  API runs create fixture rows directly on staging and nothing purges them. Exposure = 12 surfaces /
  ~190 rows (121 QA-pattern shipments, 8 customers, 5 suppliers, 9 QA users, 3 treasury accounts,
  7 treasury movements, 1 payment receipt, 2 invoice_tracking rows, 2 deposit_refund_trackers rows,
  11 trip_expenses, 8 advance_requests, 7 ops_expense_entries QA fee names) plus the 8
  forwarder_expense_types rows purged separately earlier tonight (case QA-2026-09-25-01).
- **Surface:** the five audit pages and every other business page that lists the 12 surfaces.
- **Mutation surface:** none (read-only retest). The purge run itself mutates staging fixture rows
  declared in `qa/2026-09-26_qafixture-purge_staging-purge.log`.

## Steps

1. Census (pre): run the registry census on staging → the 12 surfaces return the counts above.
2. Dry-run: `make qapurge-dry` (script --dry-run) → prints per-surface would-purge counts,
  deletes nothing.
3. Backup: registry census + full row dump of the ~190 fixture rows → qa/ artifact.
4. Purge: `make qapurge` → per-surface deleted counts, all-zero re-census, exit 0.
5. Per-page API verification on staging (rung 2):
   - _41 dispatch-detail: shipments list API returns no bl/booking ref matching the registry.
   - _42 phoi-phieu: trip/expense surfaces backing the page return no QA strings.
   - _43 invoice-tracking: `GET /api/accounting/invoice-tracking` → rows contain no QA invoice
     codes (table was 100% fixtures; page shows the empty state).
   - _44 treasury: `GET /api/treasury/accounts` (or bootstrap) → no QA17/QA0922 accounts.
   - _45 deposit-tracker: `GET /api/accounting/deposit-refund-trackers` (page endpoint) → no QA
     customer/bill rows.
6. UI rung (browser window, board-verify pass): screenshot each of the five audit pages after the
   next staging cut — no QA-pattern strings anywhere on screen.
7. Recurrence guard: every future `make demo`/`make stgdb` runs the purge automatically
   (Makefile wiring); the registry grows whenever QA recipes add new fixture patterns.

## Expected behavior

| # | Expectation |
|---|---|
| 1 | After the purge, the registry census on staging returns 0 rows on all 12 surfaces. |
| 2 | The five audit pages' APIs return no QA-pattern strings (rung 2); after the next cut the pages render clean (rung 3, board-verify). |
| 3 | Purge is idempotent: a second run deletes 0 and exits 0. |
| 4 | Purge never touches non-fixture rows: predicates are anchored on the QA-prefix class verified by enumeration, not bulk name matching (no real "Quang" user, no real customer fee ever matches). |
| 5 | Dry-run deletes nothing and prints the same counts the real run then deletes. |
| 6 | Treasury QA fixtures leave the Sổ quỹ view (accounts status flip), movement rows for QA fixtures removed with reference guards, receipts only when unreferenced. |
| 7 | Local dev DB purged the same way on next sync (`make devdb` runs staging→local of an already-purged staging). |

## Regression guard

Before any wave close on staging: run `make qapurge-dry` — must print 0 everywhere. Any non-zero
re-adds the surface to the registry (data class grows, same script).
