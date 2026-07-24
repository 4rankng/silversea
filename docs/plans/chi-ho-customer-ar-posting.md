# Plan — Post "chi hộ" sell amounts to Customer AR ledger

> **STATUS: ⏸️ PENDING APPROVAL** (ralplan APPROVE + user decisions 2026-06-25).
> Decisions: scope = **full ledger reconciliation**; backfill = **Drizzle migration**; statement label = **"Phí chi hộ"**.
> No source code mutated yet. Execution awaits final go.

## 1. Customer question (answered) + scope note

Customer/staff ask: *"giấy báo nợ của KH tạo thế nào? Có những khoản chi hộ cũng được tính vào?"* + *"Chi hộ must be in giấy báo nợ."* → They want confirmation chi hộ is included.

**It already is.** Every approved chi hộ fee with `sellAmount > 0` appears as its own line on the debt notice (`billingDocument.service.ts:88-97`) using the fee's `billingLabel` ("Phí nâng container", "Phí hải quan"…), added to freight. So the literal ask is satisfied by current code.

**The deeper bug** (why we also do the ledger fix): the debt notice bills `freight + Σ chi hộ sellAmount`, but the customer's tracked AR ledger only records `freight` (`TRIP_REVENUE`). Chi hộ `sellAmount` is never posted to the customer ledger → **statement (sao kê) AR ≠ debt-notice total**; paying the debt notice leaves a phantom credit = Σ chi hộ. The debt notice is spec-compliant (`BOI_CANH…NePO.md:67`); **the ledger is the defect.** This plan fixes the ledger so the two reconcile.

## 2. Root cause (verified, file:line)

- `backend/src/services/ledger.service.ts:167-262` `postTripLock`: posts `TRIP_REVENUE` (freight only, `:180-190`) + fee **buy side** only (`VENDOR_EXPENSE`/`FORWARDER_ADVANCE`, `:232-261`). **Never posts `sellAmount` to CUSTOMER.**
- `backend/src/services/billingDocument.service.ts:49-101`: debt notice = FREIGHT + SERVICE_FEE lines; total (`:208`) = freight + Σ sellAmounts.
- `backend/src/services/statement.service.ts:93-110`: statement reads customer ledger rows → AR = freight only.

## 3. Schema facts that drive the design (verified 2026-06-25)

- **`txn_type` is a Postgres enum** (`schema.ts:12` `pgEnum`). Adding `SERVICE_FEE` **requires a migration** (`ALTER TYPE txn_type ADD VALUE IF NOT EXISTS 'SERVICE_FEE'`). *(The earlier "no migration needed" claim was wrong — corrected.)*
- **Ledger is running-balance by `id`**, and reads use the **stored `balance` column** (`postEntry` `:130-156`; `getBalance` `:405`; `getBalancesBatch` `:449`; statement `:500/:571`; `getTopOverdueCustomer` `aging.service.ts:219`). Not summation.
- `postEntry` never sets `timestamp` → it's always `defaultNow()` (`schema.ts:349`). **Therefore backfill rows must use `timestamp = NOW()`** so the running balance stays coherent with id order. *(The earlier "timestamp = lockedAt" was wrong — corrected: it would insert a May-dated row carrying a July-computed balance, breaking the statement's chronological display.)* Consequence: backfilled AR ages from correction date, not trip date — acceptable for a one-time correction entry.

## 4. ADR

- **Decision:** Add `SERVICE_FEE` customer-AR posting (debit = `sellAmount`) at trip LOCK, mirror at UNLOCK, label "Phí chi hộ" on the statement, and backfill historical LOCKED trips via Drizzle migration.
- **Drivers:** accounting correctness (phantom-credit-on-payment is a real money defect); statement ↔ debt-notice reconciliation; spec compliance.
- **Alternatives rejected:** B reconcile-only (can't satisfy single-source-of-truth); D labeling-only standalone (doesn't fix phantom credit — folded in as the subtotal); C exclude chi hộ (violates spec + drops revenue); parallel service-fee-receivable ledger (doubles surface, itself violates spec).
- **Consequences:** customer AR balances increase by Σ historical chi hộ sellAmounts (retroactive, **no dry-run gate** with the all-migration choice → mitigate via staging-first, §7). Aging/DSO/top-overdue now include chi hộ (intentional, tested). Two migration files (enum-add, then backfill).
- **Follow-ups:** Pete picks backfill cutoff (baked into migration WHERE) or "all"; verify prod journal health before deploy (see §7).

## 5. Implementation steps

**Step 0 — READ-ONLY audit.** Confirm no trip posts `sellAmount` into `TRIP_REVENUE` today; confirm `sellAmount>0 ∧ APPROVED ∧ trip LOCKED` is the population; confirm P&L `serviceMargin` (`tripTotals.ts:147-155`) is ledger-independent (it is). Grep prod access logs for any external caller of `/api/finance/debit-note/:customerId/export` before Step 4.

**Step 1 — Shared + schema enum + statement label.**
- `shared/src/constants/index.ts:35-51` → add `SERVICE_FEE = 'SERVICE_FEE'` to the `TxnType` enum.
- `backend/src/db/schema.ts:12` → append `'SERVICE_FEE'` to `txnTypeEnum`. Run `pnpm db:generate` → produces **migration A** `ALTER TYPE txn_type ADD VALUE IF NOT EXISTS 'SERVICE_FEE'`.
- `backend/src/services/statement.service.ts:60-69` → add `SERVICE_FEE: 'Phí chi hộ'` to `TXN_LABELS` (closes XLSX `:517` + HTML `:581` fallbacks).
- (Frontend renders backend labels — no frontend label map change.)

**Step 2 — Post sell AR at lock.** `ledger.service.ts` `postTripLock`, after the buy-side fee loop (~`:261`): for each fee where `approvalStatus==='APPROVED' && Number(fee.sellAmount)>0`, `postEntry({ txnType: SERVICE_FEE, txnId: fee.id, entityType:'CUSTOMER', entityId: trip.customerId, debit: Number(fee.sellAmount), credit: 0, note: 'Phí chi hộ '+label })`.

**Step 3 — Mirror reversal at unlock.** `ledger.service.ts` `postTripUnlock` (~`:333-360`): **identical fee predicate** (`sellAmount>0 ∧ APPROVED`) → `postEntry({ txnType: UNLOCK_REVERSAL, debit:0, credit: sellAmount, txnId: fee.id, entityType:'CUSTOMER', entityId: trip.customerId })`. Same predicate as lock → no orphan reversals (guaranteed by LOCKED-fee-immutability, `forwarder.service.ts:78,161`).

**Step 4 — Delete legacy dead path.** Remove `backend/src/services/debitNote.service.ts` + `backend/src/routes/financial/debit-notes.routes.ts`; unmount at `financial/index.ts:11,37`. Verified frontend-unused (`DebtDetailPage.tsx:110` "button was removed"; `financialClient.ts` exposes only billing-documents API).

**Step 5 — Backfill via Drizzle data-migration (migration B).** Hand-authored SQL file (drizzle-kit won't generate data). **Must run AFTER migration A commits** (PG won't let a row use an enum value added in the same transaction). Properties:
- INSERT one `SERVICE_FEE` row per `(trip LOCKED, fee APPROVED, sellAmount>0)`, `entity_type='CUSTOMER'`, `entity_id=trip.customerId`, `debit=ROUND(sell_amount)`, `credit=0`, `timestamp=NOW()`.
- **Idempotent:** `WHERE NOT EXISTS (SELECT 1 FROM ledger WHERE txn_type='SERVICE_FEE' AND txn_id=fee.id AND entity_type='CUSTOMER' AND entity_id=customer_id)` — composite key (`txnId=fee.id` is already used by the buy-side on another entity).
- **Running balance computed per customer:** base = each customer's current latest `balance` (row with MAX(id)); each new row's `balance = base + cumulative Σ debit` over that customer's new rows, ordered by `fee_id`. The outer `INSERT … SELECT` **must `ORDER BY entity_id, rn`** so assigned serial `id`s rise with the cumulative balance — otherwise `getBalance` (latest-by-id) could read a mid-cumulative row. (Top implementation risk — see §7.)
- Optional cutoff: if Pete specifies a date, add `AND t.departure_date < 'YYYY-MM-DD'` to the candidate WHERE. Otherwise backfills **all** historical LOCKED trips.
- Reference SQL skeleton:
  ```sql
  WITH candidates AS (
    SELECT te.id AS fee_id, t.customer_id, ROUND(te.sell_amount::numeric) AS debit
    FROM trip_expenses te JOIN trips t ON t.id=te.trip_id
    WHERE t.status='LOCKED' AND t.deleted_at IS NULL
      AND te.approval_status='APPROVED' AND te.sell_amount::numeric > 0
  ),
  not_yet AS (       -- idempotency guard
    SELECT c.* FROM candidates c
    WHERE NOT EXISTS (SELECT 1 FROM ledger l
      WHERE l.txn_type='SERVICE_FEE' AND l.txn_id=c.fee_id
        AND l.entity_type='CUSTOMER' AND l.entity_id=c.customer_id)
  ),
  ranked AS (
    SELECT n.*,'Phí chi hộ' AS note,
      COALESCE((SELECT balance::numeric FROM ledger
        WHERE entity_type='CUSTOMER' AND entity_id=n.customer_id
        ORDER BY id DESC LIMIT 1),0) AS base,
      SUM(n.debit) OVER (PARTITION BY n.customer_id ORDER BY n.fee_id) AS cum
    FROM not_yet n
  )
  INSERT INTO ledger (txn_type,txn_id,entity_type,entity_id,debit,credit,balance,note,timestamp)
  SELECT 'SERVICE_FEE', fee_id, 'CUSTOMER', customer_id, debit, 0, base+cum, note, NOW()
  FROM ranked
  ORDER BY customer_id, fee_id;   -- preserve id↔cumulative-balance order
  ```

**Step 6 — Debt-notice labeling (fold Option D).** `frontend/src/components/billing/BillingDocumentBuilder.tsx`: render a **"Phí chi hộ" subtotal** above the SERVICE_FEE block + a footer note ("các khoản chi hộ đã thanh toán hộ khách"). Line descriptions keep using `fee.billingLabel`.

**Step 7 — Tests.** (a) lock posts customer debit for both FORWARDER_ADVANCE & COMPANY_DIRECT fees; (b) `sellAmount=0` → no post; (c) non-APPROVED → no post; (d) unlock nets the trip's CUSTOMER balance to 0; (e) reconciliation (window-scoped: trips whose `departureDate AND lockedAt` both in `[from,to]`): `Σ(TRIP_REVENUE+SERVICE_FEE customer rows) == debt-notice totalInclVat`; second test asserts expected signed divergence for one cross-boundary trip; (f) **backfill migration idempotency**: re-run inserts 0 rows; `timestamp=NOW()`; balances correct (latest-by-id == base+Σ); (g) statement XLSX cell for a SERVICE_FEE row == "Phí chi hộ"; (h) LOCKED-immutability prerequisite test (`forwarder.service.ts:78,161`); (i) `getTopOverdueCustomer` includes chi hộ AR (assert expected `days`); (j) aging/DSO caller audit — grep-confirm no caller assumes freight-only (`getEntityBalances` `ledger.routes.ts:29`, credit-limit path).
**Gate:** `pnpm --filter shared build`; `cd backend && pnpm exec tsc --noEmit && npm test`; `pnpm db:generate` (clean diff = migration A only) + `pnpm db:migrate` on a scratch DB; frontend `tsc` (parse text) + `pnpm exec vite build`.

## 6. Risks & mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| **Backfill running-balance id-ordering** (migration B) | **HIGH** | `ORDER BY customer_id, fee_id` on INSERT; test (f) asserts latest-by-id balance == base+Σ; **staging-first** (run on vantai, verify balances before prod). Fallback: switch this one step to a TS script reusing `postEntry` if SQL ordering proves unreliable. |
| **No dry-run / sign-off gate** (all-migration choice) | HIGH | Deploy to staging/vantai first; diff per-customer balances before/after; get Pete's OK on the delta before prod. |
| Prod journal drift (memory: stops at 0049) | HIGH | Verify `_journal.json` + applied migrations on prod before deploy; apply via SSH (`make deploy-backend` / `drizzle-kit migrate`) if CI is blocked. |
| Retroactive customer balance shifts | HIGH | Same as above — staging-first + Pete sign-off. |
| External caller of deleted `/debit-note/` route | LOW | Grep prod logs (60-90d); if non-zero, deprecate one cycle instead of hard-delete. |
| Orphan reversal on unlock | HIGH | Identical `sellAmount>0 ∧ APPROVED` predicate + LOCKED-immutability test (h). |
| Aging/DSO/top-overdue behavior change | MEDIUM | Documented intentional AR-broadening + tests (i)(j); pre-notify finance. |
| Append-only ledger violation | HIGH | Migration B is INSERT-only; no UPDATE/DELETE. |

## 7. Residual implementer notes (non-blocking)

1. `ALTER TYPE ADD VALUE` must be its own migration (A) and commit before migration B uses `'SERVICE_FEE'`. Use `IF NOT EXISTS` for idempotency.
2. Cross-boundary reconciliation test must **assert** the divergence value, not print it.
3. `getTopOverdueCustomer` test should assert expected `days`, not just inclusion.
4. Confirm PG version ≥12 if any tooling wraps migrations in a single transaction.

## 8. Open questions (Pete)

1. Backfill **all** historical LOCKED trips, or cutoff at a date? (Cutoff baked into migration B's WHERE.)
2. Statement UI: chi hộ lines inline chronologically, or grouped under a "Phí chi hộ" subtotal?

## 9. Handoff

On final go, route to `/oh-my-claudecode:team` (parallel, recommended) or `/oh-my-claudecode:ralph` (sequential). Backend ledger + migration B warrant **opus** (financial precision, append-only, running-balance ordering). **Do NOT merge until:** Step 7 tests green; migration B run on staging/vantai and per-customer delta approved by Pete; prod journal verified; prod-log grep confirms no external `/debit-note/` caller.
