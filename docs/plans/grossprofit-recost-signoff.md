# grossProfit Recost — Sign-Off Brief

**Status:** Dry-run analyzer delivered; **applying the recost requires Pete / audit sign-off.**
**Refs:** `backend/src/tests/pnl-invariant.test.ts` test `(a.div)` · A8 / GAP 8b · feedback202606.

## The divergence

There is a documented P&L divergence between the headline `adjustedGrossProfit`
(recomputed fresh each run from current `trips.revenue` / `trips.totalCost`) and
the Σ per-truck profit breakdown. The `(a.div)` invariant test pins it.

## Two causes

1. **Primary — stale denormalized columns.** `trips.gross_profit` and
   `trips.total_cost` are stored at write time and go stale when a trip's
   revenue/costs are edited (including the now-fixed A1 revenue-zeroing bug)
   without recomputing the denormalized totals. A data recost closes this
   component.

2. **Secondary — commission / serviceMargin asymmetry.** Inside
   `shared/src/calculations/tripTotals.ts` (`computeTripTotals`):
   - customer `commission` is subtracted from `freightExVat` → `recordedRevenue`
     → `grossProfit`, but the P&L headline `adjustedGrossProfit` does **not**
     subtract commission;
   - own-truck `serviceMargin` is **added** into `grossProfit` by
     `computeTripTotals`, but is stranded on the P&L side.

   So even a perfect `grossProfit` recost leaves a residual equal to
   **(Σ commission − Σ own-truck serviceMargin)** over the trip set. This
   residual is a **code** issue in `backend/src/services/pnl.service.ts`, not a
   data issue — it needs a separate signed-off fix, not a recost.

## What the script does

`backend/scripts/recost-gross-profit.ts` is **dry-run by default** and
read-only. It recomputes each non-canceled trip's `grossProfit` and `totalCost`
from the current row using the **same** `computeTripTotals` math (imported, never
reimplemented) and compares against the stored columns.

Flags (match `audit-revenue-splits.ts` style):
- no flags → read-only report (default)
- `--apply` → **still a dry run**; prints `DRY RUN — sign-off required`
- `--apply --i-have-signoff` → writes inside a single transaction, logging each row
- `--sample N`, `--period MONTH YEAR`, `--help`

Exit code: `0` if no STALE rows, `1` if any STALE rows exist (CI/ deploy gate).

The report explicitly quantifies both components and prints the residual so the
sign-off expectation is correct, e.g.:

> recosting grossProfit would close ≈X of the drift; the residual ≈Z is the
> commission/serviceMargin asymmetry, which needs a separate signed-off fix to
> `pnl.service.ts`.

## Sign-off ask

1. **Review the dry-run output** (`npx tsx scripts/recost-gross-profit.ts`).
2. **Approve the stale-row set** — confirm the drift is legacy/edit-corruption
   and not an active bug still writing bad values.
3. **Decide the residual**: accept the commission/serviceMargin asymmetry into a
   separate `pnl.service.ts` fix ticket, OR explicitly waive it.
4. On sign-off, run `--apply --i-have-signoff` against the target environment.

## Out of scope

- No change to `pnl.service.ts` (residual fix is a separate ticket).
- No change to `computeTripTotals`.
- CANCELED trips are excluded; CREATED trips are included (they are in the P&L
  scan but typically have zero revenue/cost, so classify as MATCH).
