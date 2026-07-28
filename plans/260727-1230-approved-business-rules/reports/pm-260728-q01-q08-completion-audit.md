# Q01-Q08 Evidence-Based Completion Audit

**Audit date:** 2026-07-28
**Scope:** Accepted clauses Q01-Q08 only; current source, schema, migrations, focused tests, and saved QA evidence.
**Method:** A clause is `PROVED` only when the current production path and focused executable evidence cover the material rule. `PARTIAL` means the implementation is present but boundary, configuration, concurrency, invalid-input, or production-scale proof is incomplete. Aggregate suite totals were used only as a regression backstop, never as clause proof.

## Executive verdict

| Requirement | Verdict | Reason |
|---|---|---|
| Q01 | PROVED | Both configured threshold paths and all three exposure components are exercised through the live credit decision path. |
| Q02 | PARTIAL | Tiering exists and route/RBAC/concurrency behavior is proved, but no focused test isolates the configured amount cap from the 10% ratio rule or checks the equality boundaries. |
| Q03 | PROVED | Explicit and oldest-due allocation, unapplied credit, governed refund, replay, rollback, RBAC, and concurrent submission are directly exercised. |
| Q04 | PARTIAL | Calendar roll, 09:00 roll time, dedupe, recurrence, and stop conditions are exercised, but exact 08:00/17:30 boundaries and concurrent one-summary claiming are not. |
| Q05 | PROVED | Email/in-app separation, retry cadence, terminal escalation, retry suppression, and crash repair are focused and executable. |
| Q06 | PARTIAL | Financial rules and approval/RBAC/concurrency are proved, but the production list endpoint is unpaginated and performs per-invoice allocation/correction queries (N+1). |
| Q07 | PARTIAL | Multi-type, primary type, and reporting-only behavior are proved, but external supplier input accepts arbitrary strings and silently drops invalid categories instead of rejecting them at the API boundary. |
| Q08 | PROVED | Canonical partner convergence, separate ledgers, manual governed offset rules, validation, RBAC, reversal, and first-winner behavior are exercised. |

Fresh verification run during this audit:

```text
cd backend &&
npx tsx --test --test-concurrency=1 \
  src/tests/m53-credit-limit.test.ts \
  src/tests/q01-credit-override-routes.test.ts \
  src/tests/final-q01-q02-q07-q08-coverage.test.ts \
  src/tests/m56-payment-allocation.test.ts \
  src/tests/q03-payment-refund-governance.test.ts \
  src/tests/q03-payment-refund-route.test.ts \
  src/tests/m57-receivable-reminder.test.ts \
  src/tests/m61-fuel-ap-recon.test.ts \
  src/tests/q06-fuel-invoice-routes.test.ts \
  src/tests/m62-supplier-types.test.ts \
  src/tests/m64-debt-offsets.test.ts \
  src/tests/q23-approved-financial-idempotency.test.ts
```

Result: **123 tests passed, 0 failed, exit 0**. This controller-only run was not written to `qa/` because this audit assignment permits creation of this report only. Saved regression backstop: `qa/2026-07-28_release-final7_backend-test.log` (1,801/1,801).

## Q01 — Early-warning threshold

| Material clause | Status | Current evidence |
|---|---|---|
| Default early warning is 80%; limit threshold is 100% | PROVED | `shared/src/schemas/app-settings.ts:3-5,18-23` defaults the warning threshold to `0.8`; `backend/src/services/credit-limit.service.ts:279-317` calculates `exceedsWarning` at configured threshold and `exceedsLimit` at the full limit. `backend/src/tests/m53-credit-limit.test.ts:183-224` fixes the default at 0.8 and exercises exposure beyond the limit. |
| Shared default is configurable and a customer may override it | PROVED | `backend/src/services/credit-limit.service.ts:228-245` gives customer configuration precedence over app settings. `backend/src/tests/final-q01-q02-q07-q08-coverage.test.ts:318-408` updates the governed shared value to 0.67 through HTTP, proves a new customer consumes it, then updates the customer to 0.92 and proves the live override snapshot consumes that. Saved focused proof: `qa/2026-07-28_final-q01-q02-q07-q08_backend-test.log`. |
| Exposure includes posted AR, approved/uncollected commitments, and proposed shipment/trip value | PROVED | `backend/src/services/credit-limit.service.ts:183-225,279-317` sums customer-ledger AR, live CREATED/IN_TRANSIT trip revenue, unused approved shipment reservations, and the proposed amount. `backend/src/tests/m53-credit-limit.test.ts:183-224` proves all components in one decision. |

Schema/migration support: `backend/src/db/schema.ts:273,2494-2562`; `backend/drizzle/0121_yellow_molecule_man.sql:25`; `backend/drizzle/0140_credit_fuel_no_invoice_controls.sql:1-44,117-132`.

## Q02 — Tiered over-limit approval

| Material clause | Status | Current evidence / exact weakness |
|---|---|---|
| CUS and dispatch cannot continue service or approve their own exception | PROVED | `backend/src/services/credit-limit.service.ts:98-112` restricts request/decision roles; canonical trip creation enforcement is exercised in `backend/src/tests/m53-credit-limit.test.ts:286-349`. HTTP denials for CUSTOMER, DRIVER, FORWARDER, and CLERK across list/detail/create/approve/reject are in `backend/src/tests/final-q01-q02-q07-q08-coverage.test.ts:410-458`. |
| Finance tier 1 applies only when excess is no more than 10% **and** within the configured VND cap | PARTIAL | The exact conjunction exists in `backend/src/services/credit-limit.service.ts:320-330`, and the cap is governed configuration (`shared/src/schemas/app-settings.ts:21-23`). `backend/src/tests/q01-credit-override-routes.test.ts:195-314` proves a within-ratio/within-cap tier-1 case, but no test isolates `ratio <= 10% && amount > cap`, and no test pins equality at exactly 10% or exactly the cap. |
| Larger cases escalate to director | PARTIAL | `backend/src/services/credit-limit.service.ts:325-329` does so and `backend/src/tests/q01-credit-override-routes.test.ts:367-454` proves a director case, but that fixture exceeds both ratio and cap, so it cannot detect accidental removal of either individual branch. |
| Repeat exceptions escalate to director | PROVED | `backend/src/services/credit-limit.service.ts:262-269,325`; `backend/src/tests/m53-credit-limit.test.ts:242-284`. |
| Approval applies to one shipment/trip or a future expiry and requires a reason | PROVED | `backend/src/services/credit-limit.service.ts:332-394` validates reason and exclusive scope; `backend/drizzle/0140_credit_fuel_no_invoice_controls.sql:36-42` backs this with checks. Shipment single-use and expiry enforcement are exercised at `backend/src/tests/m53-credit-limit.test.ts:286-416`. |
| Maker cannot self-approve; stale/concurrent decisions have one winner | PROVED | `backend/src/tests/q01-credit-override-routes.test.ts:195-314,316-454` proves distinct actors, approve-vs-reject first-winner, replay, and stale-version loss. |

Required closure test:

```text
Add focused cases to backend/src/tests/m53-credit-limit.test.ts:
1. excess ratio 5%, excess amount cap+1 => DIRECTOR;
2. excess ratio exactly 10%, amount exactly cap => FINANCE_TIER_1;
3. ratio 10%+minimal representable delta with amount within cap => DIRECTOR.
Run: cd backend && npx tsx --test --test-concurrency=1 \
  src/tests/m53-credit-limit.test.ts src/tests/q01-credit-override-routes.test.ts
```

## Q03 — Payment allocation and excess receipt handling

| Material clause | Status | Current evidence |
|---|---|---|
| Customer instruction takes priority | PROVED | `backend/src/services/payment-allocation.service.ts:120-153,626-658`; explicit caller order and authoritative outstanding validation are exercised in `backend/src/tests/m56-payment-allocation.test.ts:326-455`. |
| Otherwise allocate oldest effective due date, then oldest issue time | PROVED | `backend/src/services/payment-allocation.service.ts:156-174,659-680`; `backend/src/tests/m56-payment-allocation.test.ts:268-324`. Immutable allocation ordering snapshots are in `backend/src/db/schema.ts:2613-2663` and migration `0158_payment_allocation_due_date_snapshots.sql`. |
| No proportional split or freight-priority default | PROVED | Default path is a deterministic ordered loop applying `min(outstanding, remaining)` (`backend/src/services/payment-allocation.service.ts:659-705`), not a proportional/category allocator. The oldest-due focused case would fail if freight/category priority replaced ordering. |
| Excess stays as unapplied customer credit | PROVED | `backend/src/services/payment-allocation.service.ts:707-735`; `backend/src/tests/m56-payment-allocation.test.ts:326-375`. Database conservation constraints: `backend/drizzle/0138_careful_shape.sql:12-29` and `0146_powerful_proteus.sql:18-32`. |
| Refund only after request and approval | PROVED | `backend/src/tests/q03-payment-refund-governance.test.ts:60-165` proves over-refund rejection, distinct maker/checker/approver, immutable refund/ledger rows, and amount conservation. `backend/src/tests/q03-payment-refund-route.test.ts:139-193` proves HTTP validation, allowed/denied roles, replay/conflict, and one active request. |
| Double-submit/flaky network/concurrency creates one business effect | PROVED | `backend/src/tests/m56-payment-allocation.test.ts:457-817` covers receipt replay, payload drift, rollback, bounded allocation, and pool-sized concurrency. Refund route race is covered at `q03-payment-refund-route.test.ts:187-193`. |

Saved focused evidence: `qa/2026-07-27_q03-payment-allocation.review-fix-2_m56-backend-test.log`, `qa/2026-07-27_q03-payment-allocation.review-fix-2_q03-route-test.log`, `qa/2026-07-28_q03-payment-refund_backend-test.log`.

## Q04 — Reminder cadence, working window, holidays, and stop rules

| Material clause | Status | Current evidence / exact weakness |
|---|---|---|
| Default cadence is T-3, due date, T+3, then every seven days | PROVED | Constants and recurrence generation are at `backend/src/services/receivable-reminder.service.ts:69-87,1359-1375`. Current focused output exercises due, T-3, T+3 collision, T+10, T+17, and later seven-day recurrences; focused suite is `backend/src/tests/m57-receivable-reminder.test.ts:576-713`. |
| New reminders only from 08:00 through 17:30 on working days | PARTIAL | Source gating is explicit at `backend/src/services/receivable-reminder.service.ts:219-246,870-902`, but the focused test has no 07:59/08:00/17:30/17:31 boundary assertions. |
| Weekend/holiday occurrences move to 09:00 next working day | PROVED | Calendar overrides are loaded at `backend/src/services/receivable-reminder.service.ts:782-796`; `backend/src/tests/m57-receivable-reminder.test.ts:635-674` exercises weekend + configured holiday rollover and 08:59/09:00. |
| At most one summary per customer per day | PARTIAL | Production uses a customer/date advisory lock and recheck (`backend/src/services/receivable-reminder.service.ts:1103-1133`). `backend/src/tests/m57-receivable-reminder.test.ts:598-612` proves sequential rerun dedupe only; there is no simultaneous-run race proof. |
| Stop when paid, disputed, or suspended | PROVED | `backend/src/tests/m57-receivable-reminder.test.ts:500-574` proves LOCKED, paid, not-due, and obligation-scoped dispute suppression; retry-after-payment suppression is at `823-857`. |

Required closure tests:

```text
Add to backend/src/tests/m57-receivable-reminder.test.ts:
- 07:59 => no send; 08:00 => send;
- 17:30 => send; 17:31 => no send;
- ordinary weekend run => no send;
- Promise.all([runReceivableReminders(now), runReceivableReminders(now)])
  => exactly one customer email log and one customer notification.
Run: cd backend && npx tsx --test --test-concurrency=1 \
  src/tests/m57-receivable-reminder.test.ts
```

## Q05 — Channel priority, retry, and fallback

| Material clause | Status | Current evidence |
|---|---|---|
| Customer email is primary; customer in-app fallback/audit evidence is created independently | PROVED | Customer fallback is durable and occurrence-deduped at `backend/src/services/receivable-reminder.service.ts:1041-1065,1103-1133`; missing email and provider failure are exercised at `backend/src/tests/m57-receivable-reminder.test.ts:614-633,716-755`. |
| Internal users receive in-app evidence as primary internal channel | PROVED | Internal evidence targets financial users at `backend/src/services/receivable-reminder.service.ts:513-527`; focused assertion at `backend/src/tests/m57-receivable-reminder.test.ts:576-596`. |
| Retry after 15 minutes, 2 hours, and 24 hours | PROVED | Delay table and retry claim are `backend/src/services/receivable-reminder.service.ts:69-73,427-506`; exact retry counts/times are exercised at `backend/src/tests/m57-receivable-reminder.test.ts:761-821`. |
| Terminal failure is marked and escalated to CUS | PROVED | CUS is explicitly mapped to the repository's CLERK role with ADMIN/ACCOUNTANT fallback at `backend/src/services/receivable-reminder.service.ts:59-62,1020-1038`; focused test proves one alert to each role. |
| In-app evidence never masquerades as email success; retry-side exceptions are recoverable | PROVED | Missing/provider-failed logs remain FAILED while portal evidence exists (`m57` lines 614-633, 716-755); paid retry suppression, successful retry fallback, crash repair, stale PENDING recovery, and 200-row retry bounding are exercised at `823-1065`. |

Saved focused evidence: `qa/2026-07-27_q04-q05-reminders_backend-test-final-rerun.log`, `qa/2026-07-28_q05-cus-terminal-escalation_backend-test.log`.

## Q06 — Multi-truck fuel invoices

| Material clause | Status | Current evidence / exact weakness |
|---|---|---|
| Store one invoice header with multiple per-truck allocation rows | PROVED | `backend/src/db/schema.ts:1481-1557`; migration `0140_credit_fuel_no_invoice_controls.sql:45-86,123-138`; `backend/src/services/fuel-invoice.service.ts:401-430`. Multi-truck persistence and one-time reconciliation are exercised in `backend/src/tests/m61-fuel-ap-recon.test.ts:510-608`. |
| Use actual truck/date/litre voucher evidence and compute amount as litres × invoice unit price | PROVED | Boundary validation and authority matching are at `backend/src/services/fuel-invoice.service.ts:176-246,309-398`; route schema at `backend/src/routes/financial/fuel-invoices.routes.ts:21-50`. Invalid type/trip/date/litres/reference and removed-photo revalidation are exercised at `backend/src/tests/q06-fuel-invoice-routes.test.ts:415-688`. |
| Never equal-split; incomplete evidence stays pending and cannot be approved | PROVED | Server computes each row independently and approval requires nonempty exact reconciliation at `backend/src/services/fuel-invoice.service.ts:587-620` and following total checks. `backend/src/tests/m61-fuel-ap-recon.test.ts:610-699` proves pending replacement and approval rejection. |
| RBAC, maker/checker, replay, and first-winner approval | PROVED | Route role guards: `backend/src/routes/financial/fuel-invoices.routes.ts:98-150,199-233`; focused route tests at `backend/src/tests/q06-fuel-invoice-routes.test.ts:337-477,690-1069`. |
| Production-scale list operation | PARTIAL | `backend/src/services/fuel-invoice.service.ts:490-508` loads the full table without pagination, then runs allocation and correction queries per invoice through `Promise.all`. This is an unbounded `1 + 2N`-style query path and can exhaust DB connections/latency as invoices grow. No focused test asserts bounded query count or pagination. |

Required closure work:

```text
Replace per-invoice loading with batched allocation/correction queries and add
limit/cursor pagination at the HTTP boundary. Add a query-count integration test
with at least 50 invoices proving query count remains constant.
Run: cd backend && npx tsx --test --test-concurrency=1 \
  src/tests/q06-fuel-invoice-routes.test.ts src/tests/m61-fuel-ap-recon.test.ts
```

## Q07 — Supplier categories and reporting primary

| Material clause | Status | Current evidence / exact weakness |
|---|---|---|
| Supplier supports multiple categories | PROVED | `backend/src/db/schema.ts:196-215`; normalization/persistence behavior is exercised at `backend/src/tests/m62-supplier-types.test.ts:46-226`. |
| One primary category is a default/reporting value and must belong to selected types | PROVED | `backend/src/routes/config.ts:696-724` rejects a non-member primary; `backend/src/services/supplier-types.service.ts:56-69` returns stable types + primary. |
| Changing primary category does not reclassify an existing transaction | PROVED | Production governed CRUD plus persisted trip-expense invariant is exercised at `backend/src/tests/final-q01-q02-q07-q08-coverage.test.ts:460-527`; saved proof `qa/2026-07-28_final-q01-q02-q07-q08_backend-test.log`. |
| Invalid external category input fails at the boundary | CONTRADICTED | `shared/src/schemas/index.ts:874-888` accepts arbitrary strings. `backend/src/routes/config.ts:669-724` normalizes them, and `backend/src/tests/m62-supplier-types.test.ts:59-93` explicitly expects invalid strings and non-string entries to be silently dropped. A typo can therefore return success while losing the requested classification. |

Required closure work:

```text
Change supplierSchema types/primaryType to the canonical SupplierType enum and
return HTTP 400 for unknown entries. Preserve case normalization only if the
public contract intentionally accepts lowercase. Add route tests for an unknown
type and a primary not present in types.
Run: pnpm --filter @tingting/shared test
Run: cd backend && npx tsx --test --test-concurrency=1 \
  src/tests/m62-supplier-types.test.ts \
  src/tests/final-q01-q02-q07-q08-coverage.test.ts
```

## Q08 — Shared legal partner and manual AR/AP offset

| Material clause | Status | Current evidence |
|---|---|---|
| Customer and supplier converge on one canonical partner by normalized tax code | PROVED | `backend/src/services/legal-partner.service.ts:21-68`; unique DB authority is `backend/src/db/schema.ts:169-180` and `backend/drizzle/0140_credit_fuel_no_invoice_controls.sql:87-97,139-146`. Production governed CRUD convergence is exercised at `backend/src/tests/final-q01-q02-q07-q08-coverage.test.ts:529-590`. |
| AR and AP ledgers remain separate | PROVED | Offset approval posts one CUSTOMER credit and one VENDOR debit at `backend/src/services/debtOffset.service.ts:287-320`; `backend/src/tests/m64-debt-offsets.test.ts:241-294` proves both balances change separately. |
| Offset is manual, same legal entity/currency, has minutes, is approved, and cannot exceed smaller AR/AP | PROVED | Input omits caller-controlled amount and requires VND/minutes (`shared/src/schemas/index.ts:1118-1127`). Creation locks both entities and computes `min(AR, AP)` (`backend/src/services/debtOffset.service.ts:176-244`); approval relocks and revalidates current balances (`254-328`). Invalid entity/zero balance/minutes/currency cases are at `backend/src/tests/m64-debt-offsets.test.ts:189-240`. |
| RBAC, maker/checker, replay, reversal, and first-winner behavior | PROVED | HTTP create/decision role guards are `backend/src/routes/financial/debt-offsets.routes.ts:38-112`; CLERK denial is exercised at `backend/src/tests/shipment-routes.test.ts:1718-1760`. Direct financial invariants and concurrent approve/cancel are at `backend/src/tests/m64-debt-offsets.test.ts:241-524`; full governed HTTP replay and single-winner application are at `backend/src/tests/q23-approved-financial-idempotency.test.ts:550-664`. |

## Schema and migration assessment

- Q01/Q02/Q06/Q07/Q08 additive authority is concentrated in `backend/drizzle/0140_credit_fuel_no_invoice_controls.sql`, with positive amounts, nonblank references, canonical partner uniqueness, FK/index coverage, and credit-scope checks.
- Q03 conservation and uniqueness are enforced in `0138_careful_shape.sql`, refund conservation in `0146_powerful_proteus.sql`, source provenance in `0151_q22_source_provenance.sql`, and due-date snapshots in `0158_payment_allocation_due_date_snapshots.sql`.
- Saved migration evidence cited by the implementation reports is historical proof, not a current replay. The latest full backend suite proves the migrated local schema is usable, but this audit did not run a destructive fresh-database migration replay.

## Production-readiness checklist

- **Concurrency:** Proved for Q02 decisions, Q03 submission/refund request, Q06 approval, and Q08 approval/cancel. Q04 simultaneous dedupe remains weak.
- **Error boundaries:** Focused rollback/failure-path tests exist for Q02, Q03, Q05, and Q06. No swallowed financial exception was found.
- **API contracts:** Material money/scope/version contracts match their callers. Q07's permissive string schema contradicts fail-fast boundary validation.
- **Backwards compatibility:** Changes are additive in the reviewed migrations. No silent exported-interface removal was found.
- **Input validation:** Strong for Q02/Q03/Q06/Q08; contradicted for Q07 unknown category values.
- **Auth/authz:** Focused denials exist for sensitive Q02/Q03/Q06/Q08 operations. Q04/Q05 are scheduler-owned rather than user mutation routes.
- **N+1/query efficiency:** Q06 list is an unbounded N+1 production path and blocks full production-readiness.
- **Data leaks:** No secret, PII, raw stack trace, or provider credential exposure was found in the reviewed Q01-Q08 paths or saved evidence.

## Plan-state follow-up

The phase files do not reflect current evidence:

- `phase-03-ar-credit-and-reminders.md:39-40,52-54` still leaves Q01/Q02 and their success criteria unchecked.
- `phase-04-ap-fuel-suppliers-and-offsets.md:38-44` leaves every Q06-Q08 criterion unchecked.

Do not mark both phases complete yet. First close the Q02 isolated-cap proof, Q04 boundary/concurrent dedupe proof, Q06 list-query scalability, and Q07 strict input validation. Then rerun focused suites plus required project gates and update plan state through the controller/project-manager.

Status: DONE_WITH_CONCERNS
Summary: Q01, Q03, Q05, and Q08 have clause-level production evidence. Q02, Q04, Q06, and Q07 retain specific proof or production-readiness gaps despite the fresh 123/123 focused pass.
Concerns/Blockers: Q06 unbounded N+1 list behavior and Q07 silent invalid-category acceptance are implementation defects; Q02 and Q04 require focused boundary/concurrency tests before completion claims.
