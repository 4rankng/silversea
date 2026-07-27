# Approved business-rule coverage baseline

**Authority date:** 2026-07-27  
**Scope:** Q01-Q23, O01, O02  
**Authority:** all TingTing proposals accepted as written  
**Implementation status:** independent of authority

| ID | Baseline | Primary evidence | Gap to close |
|---|---|---|---|
| Q01 | PARTIAL | `credit-limit.service.ts`, `m53-credit-limit.test.ts` | Add proposed-value/approved-commitment exposure and enforce it on a production create/dispatch boundary. |
| Q02 | PARTIAL | `credit-limit.service.ts`, `m53-credit-limit.test.ts` | Tiered, scoped, expiring approval workflow. |
| Q03 | PARTIAL | `payment-allocation.service.ts`, `m56-payment-allocation.test.ts` | Order by immutable due date then issue date and make receipt replay database-safe. |
| Q04 | PROVED | reminder service/tests plus independent GO review | Preserve exact T-3/due/T+3/7-day cadence, working window, calendar rollover and obligation-scoped dispute suppression. |
| Q05 | PROVED | email/reminder tests and immutable-repair independent GO review | Preserve honest provider state, customer-scoped fallback, retry lease/repair idempotency and ADMIN+ACCOUNTANT terminal escalation. |
| Q06 | PARTIAL | `fuel-ap-recon.service.ts`, `m61-fuel-ap-recon.test.ts` | Multi-truck invoice allocation model and approval gate. |
| Q07 | PARTIAL | `supplier-types.service.ts`, `m62-supplier-types.test.ts` | Add a validated primary reporting type without rewriting transaction classifications. |
| Q08 | PARTIAL | `debtOffset.service.ts`, `m64-debt-offsets.test.ts` | Explicit legal-entity/currency/minutes approval contract. |
| Q09 | PARTIAL | salary close service/tests | Add configured company/payroll-unit scope and per-driver Ready/Pending close readiness. |
| Q10 | PARTIAL | salary close/period services | Default whole-period block on money-affecting driver errors. |
| Q11 | PARTIAL | salary close service/tests | Gate reopen on issue/payment/posting and use a linked current-period adjustment after those milestones. |
| Q12 | PARTIAL | no-invoice and invoice-required services/tests | Add versioned category evidence policy plus payee, actual date, reason and typed evidence. |
| Q13 | PARTIAL | no-invoice service/tests | Config-driven per-person/day/category aggregation. |
| Q14 | PARTIAL | no-invoice and approval services/tests | Separate missing-evidence return from over-limit approval on every surface. |
| Q15 | PARTIAL | RBAC, scoping and approval tests | Maker/checker/approver is proved for advances, settlements and debt offsets; extend it to price, expense, close and adjustment surfaces. |
| Q16 | PROVED | explicit user-customer links, portal scope tests and responsive admin/customer UI | Preserve deny-by-default legal-entity isolation as later portal work changes. |
| Q17 | PARTIAL | CLERK pages and shipment routes | Central editable-boundary policy and assigned-scope proof. |
| Q18 | PARTIAL | lifecycle, billing, trip and financial services | Universal append-only adjustment metadata after lock. |
| Q19 | PROVED | shared business calendar, immutable obligation snapshots, exports, configuration UI and tests | Preserve original and processing due dates on all later AR work. |
| Q20 | PARTIAL | trip, financial and salary services | End-to-end completion-period/event-date attribution proof. |
| Q21 | PROVED | shared period locks, salary close mirroring, fuel/debit-note guards and fresh-database migration proof | Preserve adjustment links to the original locked period. |
| Q22 | PARTIAL | trip/billing/financial lifecycle services | Explicit source-authority and recompute/adjustment contract. |
| Q23 | PARTIAL | idempotency service, shipment routes, offline queue | Material-write coverage, conflict audit and first-approve-wins proof. |
| O01 | PARTIAL | dispatch handoff schema/service/tests | Blocking schedule/location/capacity/cargo inputs and pairing API/UI. |
| O02 | PARTIAL | audit API, route and page | Category scoping plus ACCOUNTANT navigation discoverability. |

## Execution consequence

No approved item is completely absent, but most rules and both O-items remain
partial. Phases 2-7 must preserve the proved Q16, Q19 and Q21 authorities and
close only verified gaps. The corrected rule-by-rule audit is
`remaining-domain-gap-map.md`; a service name, roadmap checkbox or reachable
URL is not sufficient evidence.

## Independent evidence

The full read-only audit and plan review is stored at
`plans/260727-0908-staging-customer-handover-qa/reports/approved-q01-q23-research.md`.
