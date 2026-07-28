# Q09–Q17 accepted-rule completion audit

Date: 2026-07-28
Mode: read-only production-readiness audit
Verdict: **not complete**

## Code Review Summary

### Scope

- Accepted authority: `docs/prd/business-logic-qa-proposals.md:116-203`
- Plan surfaces: phase 02 (Q15–Q17) and phases 05–06 (Q09–Q14)
- Reviewed current schema/migrations, service and HTTP boundaries, focused tests, and QA artifacts. Prior reports were used only as navigation pointers.
- Fresh verification run:
  `cd backend && npx tsx --test --test-concurrency=1 src/tests/q09-payroll-unit-scope.test.ts src/tests/m73-salary-period-close.test.ts src/tests/q11-salary-post-close.test.ts src/tests/m47-no-invoice-disbursement.test.ts src/tests/q12-q13-no-invoice-boundary-routes.test.ts src/tests/q15-governance-foundation.test.ts src/tests/q15-price-config-governance.test.ts src/tests/customer-user-link.test.ts src/tests/customer-portal-routes.test.ts src/tests/shipment-routes.test.ts src/tests/shipment-rbac.test.ts`
- Fresh result: **189 passed, 0 failed, exit 0**. The shipment suite emitted a partial fixture-cleanup warning after its assertions. This aggregate green is regression evidence only; it does not prove clauses for which no assertion exists.

### Overall assessment

| Rule | Verdict | Reason |
|---|---|---|
| Q09 | **PROVED** | Configured company/unit scope, per-driver readiness, empty/invalid unit rejection, immutable close provenance, and scoped totals are asserted. |
| Q10 | **PARTIAL** | Default block and governed exclusion work, but an invalid supplementary exclusion can be approved and used to close while being impossible to complete. |
| Q11 | **PARTIAL** | Reopen blockers and adjustment path work; accepted office/delegation authority is not represented faithfully. |
| Q12 | **PARTIAL** | Category/evidence policy is implemented, but an “onsite photo” has no location metadata and therefore cannot satisfy the accepted time-and-location requirement. |
| Q13 | **PARTIAL** | Thresholds and normal aggregation work, but the same-person/day/category aggregate is not serialized across trips. |
| Q14 | **PARTIAL** | Return/tier/self-approval/reason rules work in sequential flows; the Q13 race can route concurrent daily totals to an under-authorized tier. |
| Q15 | **PROVED** | Current common governance and domain-specific boundaries enforce distinct actors, no pre-approval effect, viewer denial, stale/concurrent decisions, and ordinary-operation exceptions. |
| Q16 | **CONTRADICTED** | Explicit per-entity scoping works, but any customer account may receive multiple entities; no corporate/group/agency eligibility exists and the default is not 1:1. |
| Q17 | **PROVED** | Editable dossier matrix, pre/post-dispatch boundary, notifications/version review, dual scope, concurrency, and financial denials are asserted over HTTP. |

Result: **3 PROVED, 5 PARTIAL, 1 CONTRADICTED**.

## Blocking findings

### High — Q10 accepts supplementary exclusions that can never be completed

The accepted rule requires an excluded driver to remain visible and then be handled by a supplementary period or adjustment (`business-logic-qa-proposals.md:125-132`).

- The create service validates `targetPeriod` only when it happens to be present; it does not require it and does not reject the source period: `backend/src/services/salary-period-close.service.ts:1325-1341`.
- The HTTP boundary silently maps every unknown/missing handling mode to `SUPPLEMENTARY_PERIOD` and permits a null target: `backend/src/routes/config.ts:1668-1703`.
- Such an action can pass three-actor approval and becomes an approved close exclusion: `salary-period-close.service.ts:1395-1550`.
- Completion later rejects null or same-source targets: `salary-period-close.service.ts:1617-1625`.
- The existing Q11 fixture itself creates same-source supplementary exclusions at `backend/src/tests/q11-salary-post-close.test.ts:197-221`, closes successfully, and never proves their completion.

Impact: a driver can be removed from the main payroll close with a permanently uncompletable follow-up. The record is visible, but the accepted lifecycle is not executable.

Required closure:

1. Reject `SUPPLEMENTARY_PERIOD` unless `targetPeriod` is present, valid, and differs from the source period.
2. Reject unknown `handlingMode` instead of coercing it.
3. Add public-route tests for missing target, same-source target, unknown mode, and valid adjustment mode.
4. Add a close invariant proving every approved exclusion has completable handling metadata.
5. Run:
   `cd backend && npx tsx --test --test-concurrency=1 src/tests/q10-salary-exclusion-routes.test.ts src/tests/m73-salary-period-close.test.ts src/tests/q11-salary-post-close.test.ts`

### High — Q12 cannot prove onsite-photo location

The accepted evidence is an onsite photo “with time and location” (`business-logic-qa-proposals.md:147-154`).

- `trip_expense_photos` stores only id, expense id, storage key, uploader, and upload time: `backend/src/db/schema.ts:1564-1574`.
- Approval checks only whether at least one photo row exists: `backend/src/services/no-invoice-disbursement.service.ts:165-169,196-226`.
- `backend/src/tests/m47-no-invoice-disbursement.test.ts:232-270` proves photo presence, not capture time/location.

Impact: any uploaded image, including an unrelated or later image, satisfies the “onsite photo” evidence type.

Required closure:

1. Persist capture timestamp and validated location (coordinates plus accuracy/source, or an accepted authoritative location reference).
2. Validate those fields when `ONSITE_PHOTO` is selected; upload time alone is not capture location.
3. Test missing timestamp, missing location, invalid coordinates, and a valid geotagged photo.
4. Run:
   `cd backend && npx tsx --test --test-concurrency=1 src/tests/m47-no-invoice-disbursement.test.ts src/tests/q12-onsite-photo-evidence.test.ts`

### High — Q13/Q14 daily anti-splitting and approval tier are raceable

The accepted rule aggregates same person/day/category to prevent splitting (`business-logic-qa-proposals.md:156-172`).

- Aggregation is a plain `SUM` over committed PENDING/APPROVED rows: `backend/src/services/no-invoice-disbursement.service.ts:172-194`.
- Final approval locks only the current expense row: `backend/src/services/approval.service.ts:55-87`.
- Expense creation locks a trip/container scope, not the normalized payee/date/category key: `backend/src/services/forwarder.service.ts:250-271`.
- Existing `m47-no-invoice-disbursement.test.ts` asserts sequential aggregation and tiering, but has no two-trip concurrent approval case.

Two approvers can therefore evaluate different expenses on different trips before either transaction commits, each observe an aggregate below the director threshold, and both approve with finance-lead authority.

Impact: split disbursements can bypass both the configured daily cap (Q13) and director approval (Q14).

Required closure:

1. Serialize creation/update/final approval on a stable hash of category + expense date + normalized payee, or maintain an atomically locked aggregate record.
2. Recompute the aggregate inside the final approval transaction after acquiring that lock.
3. Add two-trip concurrent tests at the 5M and 10M boundaries, including normalized whitespace/case variants.
4. Run:
   `cd backend && npx tsx --test --test-concurrency=1 src/tests/q13-no-invoice-concurrency.test.ts src/tests/m47-no-invoice-disbursement.test.ts src/tests/q15-trip-financial-governance.test.ts`

### Critical — Q16 violates the accepted default and exception eligibility

The accepted contract is default 1:1, with multi-entity access only for corporate/group or agency accounts explicitly linked by an administrator (`business-logic-qa-proposals.md:187-194`).

- Active customer creation requires **at least one** link but has no maximum and no corporate/agency eligibility check: `backend/src/services/user.service.ts:430-455,496-513`.
- Admin-only link mutation is enforced at the route boundary: `backend/src/routes/auth.ts:250-279,282-325`; that proves who may link, not which accounts qualify for multiple links.
- The current regression test explicitly turns an ordinary customer into a two-entity account: `backend/src/tests/customer-user-link.test.ts:252-260`.
- No customer-account subtype, corporate/group flag, agency flag, or eligibility relation exists in the reviewed user/customer-link schema or service.

Impact: an administrator can accidentally grant cross-legal-entity access to any customer account, contrary to the accepted least-privilege default.

Required closure:

1. Add authoritative account eligibility (`SINGLE_ENTITY`, `CORPORATE_GROUP`, `AGENCY`, or equivalent) with admin-only governance.
2. Enforce exactly one active link for the default subtype; allow multiple only for eligible subtypes.
3. Preserve explicit links and selected-entity isolation.
4. Add same-email-domain negative tests to prove no inferred authorization.
5. Run:
   `cd backend && npx tsx --test --test-concurrency=1 src/tests/customer-user-link.test.ts src/tests/customer-portal-routes.test.ts src/tests/q16-customer-account-eligibility.test.ts`

## Clause-by-clause evidence

### Q09 — PROVED

| Material clause | Status | Current evidence |
|---|---|---|
| Close company-wide or one configured payroll unit, never one driver independently | **PROVED** | Scope resolution and unit-filtered cohort: `salary-period-close.service.ts:262-323`; persisted close scope/provenance: `:655-772`; schema: `backend/src/db/schema.ts:2699-2737`; migrations `0147_loving_la_nuit.sql`, `0148_elite_tattoo.sql`. |
| Every in-scope driver is READY or PENDING before close | **PROVED** | Readiness and blocking IDs: `salary-period-close.service.ts:325-468`; focused assertion `q09-payroll-unit-scope.test.ts:131-250`. |
| Empty/invalid configured unit cannot silently become company scope | **PROVED** | `q09-payroll-unit-scope.test.ts:131-250`; artifact `qa/2026-07-28_q09-payroll-unit_backend-test.log` (1/1, exit 0). |
| Historical close retains authoritative unit/included/excluded driver provenance | **PROVED** | Persisted columns above and replay assertion in `q09-payroll-unit-scope.test.ts:131-250`. |

Concurrency is covered by the per-period advisory lock at `salary-period-close.service.ts:672-695`; RBAC and actor separation are covered by Q15’s governed close route.

### Q10 — PARTIAL

| Material clause | Status | Current evidence |
|---|---|---|
| Money-affecting driver error blocks the whole period by default | **PROVED** | Readiness rejects pending drivers without an approved exclusion: `salary-period-close.service.ts:440-468,697-702`; `m73-salary-period-close.test.ts:172-307`. |
| Partial close requires explicit reason and distinct maker/checker/approver | **PROVED** | Create/check/approve state machine: `salary-period-close.service.ts:1325-1550`; `m73-salary-period-close.test.ts:248-307`. |
| Excluded driver remains visible as pending follow-up | **PROVED** | `applicationResult.followupStatus='PENDING'`: `salary-period-close.service.ts:1504-1549`; completion is row-locked and first-writer authoritative: `:1571-1677`; `m73-salary-period-close.test.ts:309-397`. |
| Follow-up is necessarily executable as supplementary period or adjustment | **PARTIAL** | Valid paths are asserted, but invalid supplementary metadata can be approved and close the period; see blocking finding. |
| Never silently omit the driver | **PROVED** | Close row stores included/excluded driver IDs and exclusion governance provenance: `salary-period-close.service.ts:723-762`; Q09/Q10 focused tests. |

Existing artifacts: `qa/2026-07-28_q10-salary-exclusion-followup_backend-test.log`, `qa/2026-07-27_q09-q11-q20-payroll_backend-test.log`.

### Q11 — PARTIAL

| Material clause | Status | Current evidence |
|---|---|---|
| Prefer adjustment into an open period | **PROVED** | Source and target validation, source closed/target open, locked/versioned workflow: `backend/src/services/salary-period-adjustment.service.ts:230-440`; `q11-salary-post-close.test.ts:401-567`. |
| Reopen only before payslip, payout, and official posting | **PROVED** | Blocker mapping and guarded reopen: `salary-period-close.service.ts:539-555,780-855`; issue and payout assertions in `q11-salary-post-close.test.ts:401-567` and `m73-salary-period-close.test.ts:398-448`. |
| Post-issue/payment/posting uses adjustment/reversal only | **PROVED** | Reopen returns 409 with adjustment direction: `salary-period-close.service.ts:815-824`; governed adjustment test above. |
| Accountant prepares; finance lead closes | **PARTIAL** | Policy uses generic `GOVERNANCE_CREATE`/`FINANCE_CHECK`/`PERIOD_CLOSE_APPROVE`: `backend/src/services/governance-policy.ts:351-361`. ADMIN and MANAGER also have maker/checker capability, so “accountant prepares” is not an enforced office assignment: `:24-45`. |
| Only director or explicit delegate reopens | **PARTIAL** | Reopen is limited to ADMIN/MANAGER (`salary-period-close.service.ts:780-790`) and three distinct capable actors (`governance-policy.ts:362-371`), but every MANAGER has director-level capability; no explicit delegation authority exists. |

The state machine is technically sound and the fresh Q11/Q15 tests pass. Completion still requires a documented, enforceable mapping of organizational titles/delegations to capabilities, or an accepted clarification that every MANAGER is a director delegate and every ADMIN/MANAGER may prepare payroll actions.

### Q12 — PARTIAL

| Material clause | Status | Current evidence |
|---|---|---|
| Configured allow-list and accepted default category taxonomy | **PROVED** | Defaults `shared/src/constants/index.ts:290-335`; policy schema `backend/src/db/schema.ts:1337-1365`; migrations `0140_*` and `0149_q12_q13_policy_titles.sql`; trust-boundary rejection `no-invoice-disbursement.service.ts:268-283`; `q12-q13-no-invoice-boundary-routes.test.ts:158-283`. |
| Accepted evidence taxonomy is configurable | **PROVED** | Policy snapshot and allowed-evidence validation: `no-invoice-disbursement.service.ts:98-139,196-226`; `m47-no-invoice-disbursement.test.ts:182-270`. |
| Amount/date/payee/trip-or-shipment/reason/at least one evidence are mandatory | **PROVED** | Trip expense has authoritative non-null trip link; create validation `backend/src/services/forwarder.service.ts:190-323`; approval revalidation `no-invoice-disbursement.service.ts:196-226`; public route `backend/src/routes/trips.ts:836-915`. |
| Onsite photo includes time and location | **MISSING** | Photo presence/upload time only; no location field or validation. |

Existing green artifacts: `qa/2026-07-28_q12-q13-final_m47-backend-test.log` (32/32) and `qa/2026-07-28_q12-q13-final_routes-backend-test-rerun3.log` (4/4).

### Q13 — PARTIAL

| Material clause | Status | Current evidence |
|---|---|---|
| Default 1M/item and 5M/person/day | **PROVED** | Seeded constants/policy plus `m47-no-invoice-disbursement.test.ts:272-317`. |
| Limits configurable by category and approval title | **PROVED** | Schema/migration and HTTP config tests `q12-q13-no-invoice-boundary-routes.test.ts:158-283`; configurable-title assertion `m47-no-invoice-disbursement.test.ts:319-406`. |
| Same person/day/category aggregation prevents splitting | **PARTIAL** | Normalized sequential sum is correct (`no-invoice-disbursement.service.ts:172-194`; `m47...` same-payee assertion), but concurrent cross-trip approvals are not serialized. |

### Q14 — PARTIAL

| Material clause | Status | Current evidence |
|---|---|---|
| Missing minimum evidence returns for supplementation, not approval | **PROVED** | `no-invoice-disbursement.service.ts:329-343`; durable status/provenance `approval.service.ts:125-155`; `m47...:232-270,398-468`. |
| Complete over-threshold expense routes to finance lead ≤5M/item, director >5M/item or >10M/day | **PARTIAL** | Sequential calculation and role enforcement: `no-invoice-disbursement.service.ts:345-390`; configuration tests pass. Concurrent daily aggregation can under-route; see Q13 finding. |
| Creator cannot self-approve | **PROVED** | Final row-locked guard `approval.service.ts:103-123`; Q15 trip-expense governance test `backend/src/tests/q15-trip-financial-governance.test.ts:264-484`. |
| Every exception has an explicit reason | **PROVED** | Missing explicit exception reason returns for evidence: `no-invoice-disbursement.service.ts:368-376`; `m47...` assertion. |

### Q15 — PROVED

| Material clause | Status | Current evidence |
|---|---|---|
| Distinct maker/checker/approver for money, price, debt, exceptions, period close, and adjustments | **PROVED** | Capability catalog and pairwise checks: `governance-policy.ts:24-55,351-390`; DB actor-separation invariant; `q15-governance-foundation.test.ts:209-365,498-535`; direct-money matrix `q15-direct-money-governance.test.ts:350-650`; generated material config matrix `q15-price-config-governance.test.ts:788-1001`; salary tests `q15-salary-period-routes.test.ts` and `q11-salary-post-close.test.ts:166-399`; trip money `q15-trip-financial-governance.test.ts:264-810`. |
| No creator self-approval | **PROVED** | Common transition tests and final domain guards above. |
| Ordinary operational/document updates may be direct | **PROVED** | Ordinary customer edit remains direct while debt fields are governed: `q15-price-config-governance.test.ts:965-1001`; Q17 draft dossier tests. |
| Money or locked-state mutation waits for check and approval | **PROVED** | No pre-effect, reject/return unchanged, and rollback assertions: `q15-governance-foundation.test.ts:279-424`; `q15-price-config-governance.test.ts:788-963`; trip close/completed mutation tests `q15-trip-financial-governance.test.ts:487-810`. |
| Viewer cannot modify or approve | **PROVED** | `q15-governance-foundation.test.ts:426-456`, `q15-price-config-governance.test.ts:841-905`, and public CLERK financial matrix `shipment-routes.test.ts:1718-1761`. |
| Concurrent/stale decisions have one authoritative winner | **PROVED** | `q15-governance-foundation.test.ts:341-365`; config stale/replay test; salary route and shipment review concurrency tests. |

Fresh Q15 foundation/config assertions passed. Relevant existing green artifacts include `qa/2026-07-28_q15-final_backend-test-rerun3.log`, `qa/2026-07-28_q15-price-config-governance_backend-test.rerun2.log`, `qa/2026-07-28_q15-trip-financial-governance-review-fixes_backend-test.rerun.log`, `qa/2026-07-28_q15-salary-authority_backend-test.log`, and `qa/2026-07-28_q15-debit-direct-money_backend-test.rerun2.log`. Force-exit-only artifacts were not treated as sole completion evidence.

### Q16 — CONTRADICTED

| Material clause | Status | Current evidence |
|---|---|---|
| Default one CUSTOMER account → one legal entity | **CONTRADICTED** | Service accepts any positive number of links; current test proves two ordinary links. |
| Multi-entity only for corporate/group or agency accounts, admin-linked explicitly | **MISSING** | Admin-only link mutation exists, but no eligibility type/flag or service invariant exists. |
| Data, documents, and debt stay separate per selected legal entity | **PROVED** | Explicit link helper `backend/src/lib/scoped-by-customer.ts:56-123`; foreign 404 and selected-entity list/detail/action/statement/PDF tests `customer-portal-routes.test.ts:247-309`; internal field leak check `:311-324`. |
| Never authorize by email domain | **PROVED by source, weak negative coverage** | Authorization resolves DB links, not domains, in `scoped-by-customer.ts:56-123` and token-scope validation tests `customer-user-link.test.ts:235-275`. Add an explicit same-domain negative regression before final closure. |
| Scope mutation invalidates stale credentials and survives concurrency | **PROVED** | `customer-user-link.test.ts:235-275,537-570`. |

### Q17 — PROVED

| Material clause | Status | Current evidence |
|---|---|---|
| CLERK can create/edit dossier, BL, containers, seals, declarations, DO, pickup/delivery, and files | **PROVED** | HTTP assertions `shipment-routes.test.ts:635-845,934-1284`; frontend desktop/mobile assertions `frontend/src/pages/clerk/ClerkShipmentDocsPage.test.tsx:301-412,493-620`. |
| Pre-dispatch direct; post-dispatch non-plan direct, plan fields create a new version/request | **PROVED** | Classifier `backend/src/services/shipment-edit-boundary.service.ts:116-183`; route assertions `shipment-routes.test.ts:700-845,1008-1069`. |
| Customer/container/time/location changes notify dispatch | **PROVED** | Transactional request + ADMIN/MANAGER notifications `shipment-edit-boundary.service.ts:195-228`; persisted-recipient assertion `shipment-routes.test.ts:1528-1549`. |
| Scope is responsible unit AND assigned customer/shipment | **PROVED** | SQL AND predicate and assertion `backend/src/services/clerk-shipment-scope.service.ts:90-138`; route matrix `shipment-routes.test.ts:480-592,766-772`. |
| No price/cost/debt/salary authority | **PROVED** | Casbin regression `shipment-rbac.test.ts:58-81`; representative public HTTP denial matrix `shipment-routes.test.ts:1718-1761`. |
| Concurrent updates/reviews have one winner | **PROVED** | Container/document/dispatch/change-review races `shipment-routes.test.ts:1008-1021,1148-1206,1405-1464,1606-1647`. |

Existing artifacts: `qa/2026-07-28_q17-final_backend-test.log` and `qa/2026-07-28_q17-final_frontend-test.log`. The fresh focused backend run also passed all Q17 assertions.

## Behavioral checklist

- Concurrency: **checked**; Q13/Q14 aggregate race is blocking. Q09, Q10 completion, Q15 decisions, Q16 scope mutation, and Q17 review races have explicit serialization/first-winner evidence.
- Error boundaries: **checked**; Q10 validates too late, at completion rather than exclusion creation.
- API contracts: **checked**; Q10 HTTP coercion contradicts the required supplementary contract.
- Backwards compatibility: **checked**; no reviewed evidence of an exported-interface break. Proposed Q16 eligibility needs a migration/backfill plan.
- Input validation: **red** for Q10 handling metadata and Q12 location evidence.
- Auth/authz: **red** for Q11 organizational authority ambiguity and Q16 multi-entity eligibility; technical route RBAC otherwise passes.
- Query efficiency: **checked**; Q13 aggregate has a matching category/date/payee index path in the trip-expense schema, but correctness requires locking, not merely indexing.
- Data leaks: **checked**; customer portal hides foreign entities with 404 and omits internal fields.
- Plan fact-check: phase/report completion prose was not accepted as evidence; current symbols, tests, and artifacts were verified.

## Recommended actions

1. Block Q16 release acceptance until default 1:1 and corporate/agency eligibility are modeled and tested.
2. Validate Q10 exclusion handling at creation and add route-level negative tests.
3. Add geotag/capture-time authority for Q12 onsite photos.
4. Serialize Q13/Q14 daily aggregate approval across trips and add a two-transaction test.
5. Resolve Q11 official-title/delegation semantics in code or obtain an explicit accepted clarification.
6. Re-run the focused commands above, save the red-to-green outputs under `qa/`, then repeat this clause audit. Do not mark phases 05–06 complete from aggregate suite results alone.

## Metrics

- Fresh focused assertions: **189 passed / 0 failed**
- Type coverage: not measured by repository tooling in this audit
- Test coverage percentage: not measured; clause coverage is reported above instead
- Lint issues: not rerun because this was a read-only audit with no source change
- Unresolved fixture issue: `shipment-routes.test.ts` reported partial user cleanup after all assertions; investigate separately because repeated runs may pollute a shared developer database.

## Unresolved questions

1. Is every `MANAGER` formally a Director delegate for payroll reopen, and may ADMIN/MANAGER prepare a close action, or must those authorities be explicit assignments?
2. What authoritative location format is acceptable for Q12 onsite evidence: device coordinates with accuracy, a signed provider location, or a managed site/location ID?
3. Which existing multi-customer accounts, if any, must be backfilled as corporate/group or agency before enforcing Q16?

Status: DONE_WITH_CONCERNS
Summary: Q09, Q15, and Q17 are proved; Q10–Q14 remain partial and Q16 contradicts the accepted default/eligibility rule.
Concerns/Blockers: four production defects plus unresolved payroll organizational authority prevent Q09–Q17 completion.
