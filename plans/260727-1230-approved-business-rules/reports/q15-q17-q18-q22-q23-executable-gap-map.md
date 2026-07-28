# Executable closure map — Q15, Q17, Q18, Q22 and Q23

**Audit date:** 2026-07-28  
**Mode:** read-only, evidence-first audit of the current reachable production boundary  
**Authority:** accepted clauses in `docs/prd/business-logic-qa-proposals.md:178-209,245-261`  
**Scope:** Q15, Q17, Q18, Q22 and Q23 only  
**Change boundary:** this report is the only file created by this audit. No source, test, migration, QA artifact, deployment state or `HANDOFF.md` was changed.

## Evidence rule

`PROVED` requires current production code plus saved executable evidence at the public boundary. A service unit test or implementation report is supporting evidence, not sufficient proof by itself. The proof must cover the applicable normal, invalid, stale/concurrent, RBAC/scope and replay paths. `MISSING` means the clause is absent or only partly proved. `CONTRADICTED` means current production behavior conflicts with the accepted clause.

The final green release artifacts (`qa/2026-07-28_release-final2_backend-test.log`, `..._backend-typecheck.log`, `..._frontend-typecheck.log`, `..._build.log`, `..._e2e.log`) establish integration health only. They do not close a clause whose required boundary cases are absent.

## Executive verdict

| Question | Verdict | Closure reason |
|---|---|---|
| Q15 | **MISSING** | The reusable three-actor policy is real and several high-risk slices use it, but reachable money, price, debt, exception and close surfaces still include two-actor and direct-apply paths. |
| Q17 | **MISSING** | Shipment dossier editing, dual scope and post-dispatch change requests are strong. Explicit public-boundary proof is still absent for every named dossier subtype and for the complete price/cost/debt/salary denial matrix. |
| Q18 | **MISSING** | Trip, debit-note and salary locked paths are strong, but approved expenses, approved fuel invoices, approved settlements and several other final financial records have no universal adjustment/reversal contract with the required history and authority. |
| Q22 | **MISSING** | The seven-pair source catalog exists and important trip/expense/debit-note propagation paths are implemented, but shipment provenance, issued-note AR authority, cost reporting and receipt/allocation authority are not proved end to end. |
| Q23 | **CONTRADICTED** | Many writes replay correctly, but transaction keys remain optional on the shared server helper and several endpoint classes do not use it. More decisively, conflict-attempt audit is emitted after response completion through a best-effort in-process listener, so “every attempt/conflict is stored” is false. |

---

## Q15 — maker / checker / approver / viewer

### Accepted-clause matrix

| Accepted clause | Status | Current evidence | Exact gap |
|---|---|---|---|
| Money, price, debt, exception, period close and adjustment use distinct maker/checker/approver stages | **MISSING** | `backend/src/services/governance-policy.ts:51-252` catalogs 17 governed kinds; actor separation is enforced at `:314-331`. Focused QA exists for direct money, debit notes, pricing tables, salary confirmation and salary close (`qa/2026-07-27_q15-*`). | The catalog does not govern every reachable class below. Trip-expense approval, debt offset, advance request, fuel invoice and credit override remain maker/approver; company expense, profit distribution, trip financial/lifecycle effects and many financial configurations still apply directly or use a domain path without a checker. |
| Creator cannot approve own data | **MISSING** | Generic governance rejects maker-as-checker and maker/checker-as-approver (`governance-policy.ts:314-331`); advance settlements persist three distinct actors; focused Q15 artifacts prove the governed slices. | The accepted rule is universal across the governed envelope. Direct-apply and two-actor classes have no checker/approver pair on which to enforce it. |
| Ordinary operational progress/evidence may be saved directly | **PROVED** | Driver progress/evidence and CLERK dossier updates stay on role/scope-guarded operational routes; Q17 shipment tests and `qa/2026-07-28_q23-operational-evidence_backend-test.log` prove normal, invalid and scope behavior. | None for this clause; later monetary or locked-state transitions remain governed separately. |
| A change to money or a locked state must be checked and approved | **MISSING** | Locked trip AR/reopen, debit-note issue/adjustment, salary confirmation/reopen and salary close/reopen use governed stages. | Approved expense corrections, fuel invoice finalization/correction, debt-offset cancel, company-expense financial edits, trip complete/lock/cancel and several pricing/policy changes do not all traverse a three-actor envelope. |
| Viewer may not mutate, check or approve | **MISSING** | `canViewGovernanceAction` and `getGovernanceAllowedActions` return no actions to roles without capabilities (`governance-policy.ts:334-374`); DRIVER/FORWARDER/CUSTOMER/CLERK have empty capability sets (`:45-48`). | No exhaustive public-route viewer matrix proves all governed and still-direct financial/configuration endpoints. Coarse Casbin proof is not stage-level proof for every reachable class. |

### Reachable production surface inventory

| Surface class | Current control | Verdict |
|---|---|---|
| Receipts, refunds, vendor/carrier payments, driver payout, commissions, penalty create/cancel | Generic governed action kinds with saved focused tests | **PROVED** for the named slices |
| Trip AR adjustment and exceptional reopen | Generic M/C/A, source version, reason/evidence and atomic apply | **PROVED** |
| Debit-note issue and adjustment | Generic M/C/A, expected version, immutable issued source | **PROVED** |
| Pricing tables | Governed price-change route | **PROVED** only for `/api/pricing-tables` |
| Salary confirmation/reopen and salary-period close/reopen | Generic/domain M/C/A with distinct actors and reopen blockers | **PROVED** |
| Advance settlement and salary period adjustment/exclusion | Domain-native three-actor flow | **PROVED** only where public tests cover normal, invalid, actor separation and concurrent winner |
| Trip expense approve/reject; debt-offset approve; advance-request approve/reject | Maker/approver with self-approval denial, no checker | **MISSING** |
| Fuel invoice approve; credit-override approve/reject | Status winner and role gate, no proved three-actor flow | **MISSING** |
| Company expense create/update/delete; profit distribution | Direct financial effect | **MISSING** |
| Trip revenue/cost/salary figures and complete/lock/cancel | Version/status controls, but no universal checker/approver before financial effect | **MISSING** |
| Debt-offset cancel | Conditional first-winner reversal exists, but no three-actor cancellation workflow and incomplete cancellation authority metadata | **MISSING** |
| Generated financial configuration: road allowances, fuel norms, weight/lift pricing, ancillary revenue, management fees, cap table, truck cap, customer payment terms, forwarder expense policy, penalty/expense categories | Generic CRUD has required request key and stale timestamp, but applies changes directly | **MISSING** |
| Singleton road/fuel/company config, salary-period definitions, debit-note templates | Direct dedicated routes; not covered by `PRICE_CONFIG_CHANGE` | **MISSING** |

**Smallest Q15 closure:** extend the existing policy/action envelope; do not build a second workflow engine. Add only the missing action kinds and domain adapters, preserve mature domain-native three-actor settlement/salary flows, and add one generated-config hook that routes financially material fields through governance instead of direct application.

---

## Q17 — CLERK dossier authority

### Accepted-clause matrix

| Accepted clause | Status | Current evidence | Exact gap |
|---|---|---|---|
| CLERK can create/edit shipment dossier, BL, container, seal, declaration, delivery order, pickup/delivery and document files | **MISSING** | Shipment routes and `ClerkShipmentDocsPage` cover shipment fields, containers including `sealNumber`, document attach/replace and declaration create/update. `backend/src/tests/shipment-routes.test.ts` and `frontend/src/pages/ClerkShipmentDocsPage.test.tsx`, saved under `qa/2026-07-27_q17-*`, exercise these surfaces. | Public proof does not explicitly exercise a `DO` delivery-order document as a named subtype, every seal/document replacement variant, and a complete create/edit matrix for each accepted subtype. Generic `type='DO'` support is code evidence, not boundary proof. |
| Before dispatch, direct edit is allowed | **PROVED** | `classifyClerkShipmentPatch` treats `DRAFT` changes as direct (`backend/src/services/shipment-edit-boundary.service.ts:113-160`); current route tests prove draft update/container/document/declaration flows. | None. |
| After dispatch, only non-plan information is direct; customer/container/time/location changes create a versioned request and notify dispatch | **PROVED** | Direct and request fields are classified at `shipment-edit-boundary.service.ts:33-46,141-160`; container changes become requests at `:163-180`; request plus notification is one transaction at `:192-225`. Shipment tests cover post-dispatch plan requests, stale source versions and dispatch notification. | None. |
| Scope is simultaneously responsible unit AND assigned customer/shipment | **PROVED** | `backend/src/services/clerk-shipment-scope.service.ts:25-138` enforces the conjunction. `shipment-routes.test.ts` exercises list/detail/update/container/document/declaration denial across unit/customer/shipment mismatches. | None. |
| CLERK cannot edit price, cost, debt or salary | **MISSING** | Casbin and `backend/src/tests/shipment-rbac.test.ts:58-81` deny broad financial/trip/user mutations; the CLERK shipment route explicitly denies transition, dispatch and delete. | There is no exhaustive authenticated public HTTP matrix covering representative price config, trip/forwarder/company cost, AR/debt and salary mutation endpoints. A resource-level policy test is insufficient where dedicated routers have separate role middleware. |

### Q17 accepted-surface inventory

| Accepted object | Production representation | Current direct/request rule | Evidence verdict |
|---|---|---|---|
| Shipment dossier/customer/pickup/delivery/time | `shipments` fields | DRAFT direct; post-dispatch customer/time/location requested; non-plan BL/contact direct | **PROVED** |
| Bill of lading | `blNumber` and shipment document type `BL` | DRAFT/direct metadata; replacement is immutable version chain | **PROVED** |
| Container | `shipment_containers` | Initial/direct; post-dispatch replacement requested and versioned | **PROVED** |
| Seal | `shipment_containers.sealNumber` | Follows container rule | **MISSING** explicit subtype boundary test |
| Declaration | shipment declaration rows | Scoped create/update | **PROVED** |
| Delivery order | document type `DO` | Generic document attach/replace | **MISSING** explicit `DO` boundary test |
| Document files | shipment document rows with immutable replacement link | Scoped attach/replace with expected version | **PROVED** |
| Forbidden finance domains | dedicated price/cost/debt/salary routers | Must be denied | **MISSING** full public denial matrix |

**Smallest Q17 closure:** test-only unless the matrix reveals a bypass. Add a table-driven public route suite for all named dossier subtypes plus representative price/cost/debt/salary denials; add matching frontend tests for `DO` and seal editing. Do not modify the shipment service unless those tests expose an actual boundary defect.

---

## Q18 — definitive locked/approved-surface inventory

### Accepted-clause matrix

| Accepted clause | Status | Current evidence | Exact gap |
|---|---|---|---|
| Approved/locked data cannot be edited directly | **MISSING** | Strong guards exist for LOCKED trips, issued debit notes, confirmed salary, closed salary periods, approved trip expenses and approved settlements. | The rule is cross-cutting and not proved across every final state below. Company expenses and some final financial/config states lack a uniform final-state contract. |
| Correction is an adjustment or reversal; reopen is exceptional and only pre-issue/pre-posting | **MISSING** | Trip AR/reopen, debit-note adjustments, salary reopen/period adjustment and payment/penalty reversals implement this model. Salary period reopen blockers are enforced in `salary-period-close.service.ts:763-831,1176-1190`. | Approved office expenses, approved fuel invoices, approved advance settlements and approved credit overrides lack a general post-approval adjustment/reversal path. |
| Reason, before/after, actor and approver are retained | **MISSING** | Generic governance actions persist reason, snapshots and stage actors; salary adjustments and settlement corrections preserve linked history. | Debt-offset cancel, fuel-invoice correction, approved-expense correction and several domain-native final states do not all retain the complete accepted metadata. |
| Operational data is handled by business manager; money by finance lead; period reopen by director/delegate | **MISSING** | Capability catalog distinguishes finance, price and period-close approval; trip reopen and salary period reopen are narrowed. | The product has role mappings rather than authoritative persisted job-title/delegation grants on every final-state class; several domain-native routes allow broad ADMIN/MANAGER/ACCOUNTANT roles without the accepted stage distinction. |

### Locked/approved production inventory

| Final/locked surface | Direct-edit guard | Correction/reopen path | Required history/authority | Verdict |
|---|---|---|---|---|
| Trip `LOCKED` | Financial/status direct mutation rejected | `TRIP_AR_ADJUSTMENT`, `TRIP_REOPEN` | Generic snapshots, reason, M/C/A, expected version | **PROVED** |
| Debit note issued/sent/confirmed/partially paid/paid | Lines/source/delete immutable after issue | `DEBIT_NOTE_ADJUSTMENT`; governed issue | Original/source diffs, expected version, M/C/A | **PROVED** |
| Salary confirmation `CONFIRMED` | Workday mutation blocked | Governed salary reopen | Reason and stage history | **PROVED** |
| Salary period `CLOSED` | Period writes/late data protected | Governed reopen only before issue/post; linked salary-period adjustment afterward | Close/reopen actors, version, adjustment linkage | **PROVED** |
| `period_locks` for SALARY/FUEL/DEBIT_NOTE | Closed-period overwrite rejected | Reopen or linked late-data adjustment | actor/reason/original period | **PROVED** for the focused Q21/Q18 paths |
| Payment receipt/allocation | No mutable receipt overwrite | Governed refund/reversal and reallocation history | command/receipt/allocation history | **PROVED** |
| Penalty `ACTIVE` then `CANCELED` | Conditional first-winner cancellation | Governed append-only cancellation/reversal | governed actors/reason | **PROVED** |
| Debt offset `APPROVED`/`CANCELED` | Conditional status guard | Append-only cancel reversal | cancellation M/C/A and complete reason/snapshots not universal | **MISSING** |
| Trip expense `APPROVED` | Update/delete rejects approved row | Settlement-linked correction exists only for settlement-owned expense | No general approved office-expense adjustment/reversal | **MISSING** |
| Advance settlement `APPROVED` | Final status blocks direct edit | Pre-approval correction history exists | No general post-approval reversal/adjustment | **MISSING** |
| Advance request `APPROVED`/`REJECTED` | First-winner status/version | No general reversal of a mistaken approval | Incomplete three-actor correction authority | **MISSING** |
| Fuel invoice / linked fuel expense `APPROVED` | Final transition/status guard | No general approved-invoice correction/reversal contract | Missing adjustment record and M/C/A evidence | **MISSING** |
| Credit override `APPROVED`/consumed | First transition wins | No proved reversal/supersession contract | Missing three-actor correction history | **MISSING** |
| Company expense after ledger/payment effect | Transactional reversal/repost on mutable update/delete | Direct update/delete rather than approved adjustment object | No uniform final state, snapshots or approver | **CONTRADICTED** where a finalized financial effect remains directly mutable |
| Pricing table approved governance result | Direct table bypass removed for dedicated pricing route | New governed price change | Governance snapshots and M/C/A | **PROVED** |
| Other financial configuration used by posted calculations | Generic stale-safe CRUD, but no approved/locked lifecycle | Direct overwrite creates new current authority | No approved adjustment/version history across all policy rows | **MISSING** |
| Issued/official salary posting milestone | Reopen blocked after issue/post | Linked salary-period adjustment | Adjustment actor chain exists | **PROVED** for salary |

**Smallest Q18 closure:** introduce one reusable “final financial record correction” contract (reason, before/after, source version, maker/checker/approver, application/reversal reference), then adapt approved expense, fuel invoice, settlement, debt offset, credit override and company expense. Avoid one bespoke correction table per domain unless an existing domain history already satisfies the contract.

---

## Q22 — source authority and propagation

### Accepted-clause matrix

| Accepted clause | Status | Current evidence | Exact gap |
|---|---|---|---|
| Shipment owns customer, cargo and container facts | **MISSING** | Catalog pair `SHIPMENT_TO_TRIP` declares the three field families (`shared/src/governance/source-authority.ts:108-122`). Q17 shipment versioning is implemented. | Dispatch/trip snapshots and later reads are not proved to derive from immutable shipment provenance for every field; no end-to-end normal/change/race test proves the authority boundary. |
| Trip owns vehicle, driver, actual time and actual status | **PROVED** | Catalog and trip status/actual mutation services make trip authoritative; trip source propagation tests cover draft-note recompute and issue race. | None for this isolated authority statement. |
| Approved expense owns cost | **MISSING** | Catalog restricts expense authority to `APPROVED_ONLY` (`source-authority.ts:148-168`); source-change service reacts to approved expense. | `EXPENSE_TO_COST_REPORTING` is catalogued but lacks a public end-to-end reporting proof, including pending/rejected exclusion and approved correction. |
| Issued debit note owns receivable due | **MISSING** | Issued document lines/source are immutable and source drift creates an adjustment need; catalog at `source-authority.ts:170-179`. | No end-to-end proof shows every AR balance/aging/stat surface reading issued-note authority rather than trip-derived revenue. |
| Receipts and allocations own paid/outstanding | **MISSING** | Q03 allocation service and immutable receipt replay exist; catalog at `source-authority.ts:180-188`. | No Q22 public chain test proves allocation, reallocation/reversal and all outstanding/aging consumers from the same authority. |
| Pre-lock source changes recompute dependents and warn stakeholders | **MISSING** | `source-change.service.ts` recomputes draft debit notes for trip/expense changes; focused Q22 tests prove trip and expense draft propagation. | Shipment→trip and expense→cost-reporting propagation are not proved; stakeholder warning/notification is not proved for every pair. |
| Post-lock/issue source changes version/adjust/reverse without overwrite and preserve full history | **MISSING** | Issued debit notes remain immutable and create adjustment need; trip/salary governed adjustments preserve history. | Full history and adjustment/reversal behavior are not proved across all seven catalog pairs, especially cost reporting, issued-note AR and receipt allocation. |

### Seven-pair executable chain inventory

| Catalog pair | Pre-milestone behavior | Post-milestone behavior | Boundary evidence | Verdict |
|---|---|---|---|---|
| `SHIPMENT_TO_TRIP` | recompute trip plan snapshot | version | Catalog + Q17 change request only | **MISSING** |
| `TRIP_TO_DRAFT_DEBIT_NOTE` | recompute | adjust after issue | Public source-change and send-vs-change tests | **PROVED** |
| `TRIP_TO_ACCOUNTS_RECEIVABLE` | recompute | adjust after issue | Trip/debit-note slices, no universal AR-consumer proof | **MISSING** |
| `EXPENSE_TO_COST_REPORTING` | approved-only recompute | adjust | Catalog only plus reporting implementation fragments | **MISSING** |
| `EXPENSE_TO_DRAFT_DEBIT_NOTE` | approved-only recompute | adjust after issue | Focused Q22 propagation tests | **PROVED** |
| `ISSUED_DEBIT_NOTE_TO_ACCOUNTS_RECEIVABLE` | issued note is milestone | adjust/reverse | Immutability/source-diff proof, not all AR readers | **MISSING** |
| `RECEIPT_ALLOCATION_TO_PAID_OUTSTANDING` | receipt/allocation is milestone | adjust/reverse | Q03 service evidence, no Q22 consumer-chain matrix | **MISSING** |

**Smallest Q22 closure:** make provenance/version identifiers explicit at each edge, then add one table-driven chain suite that exercises all seven pairs through their public writes and read consumers. Each case must assert pre-milestone recompute/notification, post-milestone non-overwrite, linked adjustment/reversal, and history.

---

## Q23 — definitive mutation endpoint inventory

### Universal controls

| Accepted clause | Status | Current evidence | Exact gap |
|---|---|---|---|
| Every submit has a unique transaction code | **CONTRADICTED** | Frontend transport supplies keys broadly; generated CRUD requires a key (`backend/src/routes/utils/crud-factory.ts:109-121`). | Shared server helper explicitly accepts no key and executes normally (`backend/src/services/idempotency.service.ts:247-253`). Many dedicated endpoints do not call the helper. |
| Same key and payload replay original result with no duplicate | **MISSING** | `runIdempotent` uses an advisory lock, payload hash and immutable response snapshot (`idempotency.service.ts:256-317`). Shipment, trip, money, advance, governance, generated CRUD, expense and operational-evidence focused artifacts prove named classes. | The helper is not universal and several classes below have no replay proof. |
| Shipment, trip and document numbers are unique | **MISSING** | Database uniqueness exists for shipment/trip codes and selected active debit-note period identities. | There is no public normal/duplicate/concurrent proof matrix for all named business identifiers and all document types. Natural uniqueness also cannot replace request replay. |
| Stale editor must reload; no automatic overwrite | **MISSING** | Shipment/trip versions and generated CRUD `If-Unmodified-Since` are proved. | Billing-document edits, driver/forwarder operational replacements, dedicated settings/config and several salary/fuel/credit paths lack a consistent required version. |
| First valid approval wins; later approval is rejected | **MISSING** | Governance, advance, trip-expense, debt-offset and customer debit-note races use row/version/status winners and have focused tests. | Fuel invoice, credit override and newer salary exclusion/adjustment transitions lack the complete concurrent approve/reject matrix. |
| Every attempt and conflict is stored | **CONTRADICTED** | Middleware classifies success, replay, 403, 409 and other failure outcomes (`backend/src/middleware/audit.ts:127-255`). | It emits only after response `finish` (`:148-151`) and `initAuditService` writes through an async event listener that catches/logs failure (`backend/src/services/audit.service.ts:211-236`). Process failure or DB failure loses the attempt; the write is neither awaited nor durable. |

### Exhaustive mounted mutation classes

This is the definitive current route-class inventory. Generated CRUD is expanded logically; paths separated by `|` denote alternative suffixes on the same mounted router. Preview/notification/onboarding state writes remain audited but are not business-material replay targets.

| Class | Reachable mutation paths | Current Q23 status |
|---|---|---|
| Authentication, identity, units | `/api/auth/login|logout|me|change-password`, `/api/auth/users`, `/api/auth/users/:id`, `/api/auth/business-units`, `/api/auth/business-units/:id` | Login intentionally non-material; logout/profile/password/user/unit writes lack universal replay/version proof — **MISSING** |
| Shipments | `/api/shipments`, `/quick`, `/:id`, `/:id/transition|dispatch|documents|containers|change-requests`, document replacement, declaration create/update | Replay/version/race strongly proved, but server key is not required on every call — **MISSING** universal key clause |
| Trips | `/api/trips`, `/:id` lifecycle/copy/delete/reassign/departure/containers/instructions/pre-departure/actuals, bulk figures, expense create/update/delete/approve/reject, AR adjustment/reopen | Broad replay/race proof exists; trip-expense mutable stale-write coverage remains incomplete — **MISSING** |
| Direct money and financial governance | `/api/payments/*`, `/api/drivers/:driverId/payouts`, `/api/commissions`, `/api/penalties`, `/api/finance/debt-offsets*`, `/api/adjustments`, `/api/governance-actions/:id/*`, `/api/reports/distribute-profit` | Replay and winner tests cover most named paths; `/api/adjustments` creation and universal required-key/audit durability remain — **MISSING** |
| Advances | `/api/forwarder/me/advance-requests|advance-settlements`, `/api/advance-requests/:id/approve|reject`, `/api/advance-settlements/:id` plus check/approve/reject and expense correction | Focused replay/version/race proof exists — **PROVED** for class behavior, not universal audit |
| Billing/debit notes | `/api/finance/billing-documents`, `/:id`, issue/adjustment actions, `/api/portal/debit-notes/:id/confirm|dispute` | Replay/transition proof exists; mutable billing document stale-version requirement is incomplete — **MISSING** |
| Company/trip/forwarder expenses and photos | `/api/expenses`, `/:id`, `/:id/photos`, `/api/forwarder/me/expenses*`, expense-completion and photo routes | Company expense replay is proved; forwarder expense/photo routes lack universal replay/stale proof — **MISSING** |
| Driver operational evidence | `/api/driver/me/trips/:tripId/progress|incidental-costs|containers`, container update/seal replacement, photo delete | Progress/incidental covered; container/seal/photo replacement lacks required key/version matrix — **MISSING** |
| Fuel invoice and credit override | `/api/fuel-invoices*`, `/api/credit-overrides*` | Status guards exist; replay/stale/concurrent approval matrix absent — **MISSING** |
| Salary confirmation/workdays | `/api/salary/:driver/:year/:month/workdays|confirm|unconfirm` and confirm/unconfirm action check/approve | Governed slices have actor/version proof; all creates/transitions do not require key — **MISSING** |
| Salary close/issue/post/adjustment/exclusion | `/api/salary/periods/:period/close|reopen|issue|post|adjustments`, action check/approve; salary exclusion writes; `/api/salary-periods/default` and definition create/update/delete | Several action transitions and definition writes lack replay; issue/post and exclusions need stale/race proof — **MISSING** |
| Generated CRUD — 24 resources | For each of `customers`, `business-calendar`, `trucks`, `trailers`, `routes`, `cargo-types`, `container-types`, `seal-types`, `ports`, `forwarder-expense-types`, `road-allowances`, `fuel-norms`, `weight-pricing-tiers`, `lift-pricing`, `ancillary-revenue`, `penalty-reasons`, `management-fees`, `cap-table`, `truck-cap`, `suppliers`, `expense-categories`, `tire-positions`, `drivers`, `fleet/tires`: `POST /api/<resource>`, `PUT /api/<resource>/:id`, and `DELETE /api/<resource>/:id` except disabled driver delete | Required key, atomic replay and required stale timestamp are implemented in `crud-factory.ts:109-158,189-318`; focused config QA covers normal/replay/different-payload/concurrency/stale/RBAC — **PROVED** |
| Governed pricing tables | `/api/pricing-tables` create/update/delete through dedicated router | M/C/A and versions exist; routes lack the same complete required-key matrix as generated CRUD — **MISSING** |
| Dedicated config/templates | `/api/road-config`, `/api/fuel-config`, `/api/company-info`, `/api/debit-note-templates` create/update/delete | No universal key/version proof — **MISSING** |
| Admin settings/content | `/api/admin/app-settings`, `/email`, `/api/admin/gps-settings`, `/api/admin/llm-settings`, `/api/admin/onboarding-settings`, `/api/admin/faq-entries` create/update/delete | No universal key/version proof — **MISSING** |
| Tire lifecycle | `/api/fleet/tires/:id/install|remove|dispose|transfer` | Generic tire CRUD is covered; lifecycle transitions lack replay/stale/concurrent proof — **MISSING** |
| Upload/OCR/geotag | `/api/upload*`, `/api/ocr`, `/api/ocr/persist-only`, `/api/ocr/pump`, `/api/geotag` | Upload, base OCR, persist-only and geotag focused proof exists; `/api/ocr/pump` remains outside the proved wrapper — **MISSING** |
| GPS reconstruction | `/api/admin/gps/backfill`, `/api/admin/gps/recapture/:tripId` | Repeatable jobs lack durable command/result identity — **MISSING** |
| Non-material state/preview | notification read/archive/delete state, onboarding progress/analytics, advance-settlement preview, billing draft generation | Common audit applies; excluded from business-material replay only if they cannot create an authoritative domain effect | **PROVED** only under that exclusion |

### Q23 closure condition

Q23 cannot be closed by adding more client keys alone. The public server boundary must:

1. reject a missing key for every material mutation before domain lookup;
2. atomically persist command state/result with the business effect, or use a durable command state machine for object storage/jobs;
3. require a current version on every destructive/mutable write;
4. enforce conditional first-winner transitions;
5. synchronously persist a sanitized attempt/conflict record before returning, with an outbox only for secondary enrichment;
6. run the full required matrix: normal, exact replay, different-payload key conflict, concurrent first submit, stale editor, approval loser, natural-ID collision, RBAC/scope denial and durable audit.

---

## Non-overlapping implementation lanes

The lanes below are concrete file-ownership boundaries. Lanes marked **serialized** must land before dependent parallel work because they own shared schema or policy infrastructure.

### Lane 0 — shared durable command/audit boundary (**serialized first**)

**Owns:** `backend/src/db/schema.ts`, the next coordinated Drizzle migration and journal metadata, `backend/src/services/idempotency.service.ts`, `backend/src/middleware/audit.ts`, `backend/src/services/audit.service.ts`, new shared material-write middleware/helper, and focused Q23 foundation tests.

**Changes:** required-key middleware; durable command result supporting action/multi-row/job responses; awaited/transactional sanitized attempt record or durable outbox; explicit success/replay/conflict outcomes.

**Acceptance:** missing key 400; same-key replay; different payload 409; concurrent submit one effect; durable success/replay/403/409/rejected attempts survive simulated secondary enrichment failure.

### Lane 1 — Q15 policy expansion (**serialized after Lane 0**)

**Owns:** `backend/src/services/governance-policy.ts`, governance action adapters/routes/schema additions not already owned by Lane 0, shared governance schemas/types, and Q15 policy/public-route tests.

**Changes:** add missing action kinds/adapters for expense, debt/advance/fuel/credit/company/profit/trip-financial and financially material configuration; preserve existing settlement/salary native three-actor flows.

**Acceptance:** table-driven public tests for M/C/A separation, self-check/self-approve rejection, stage RBAC, viewer no-actions, stale source, concurrent approve and exact replay for every policy kind.

### Lane 2 — Q17 proof and CLERK boundary

**Owns:** shipment/CLERK backend and frontend tests only initially; `backend/src/routes/shipments.ts`, shipment/CLERK services and `ClerkShipmentDocsPage` only if a new test proves a defect.

**Changes:** explicit BL/DO/container/seal/declaration/pickup/delivery/document matrix; complete price/cost/debt/salary denial matrix; no speculative service rewrite.

**Acceptance:** normal, invalid, stale, dual-scope, post-dispatch request/notification and forbidden-domain tests at desktop/mobile frontend plus public backend.

### Lane 3 — locked financial corrections

**Owns:** approved office-expense, fuel-invoice, debt-offset, credit-override, company-expense and advance-settlement domain services/routes/tests. Does not edit generic governance policy or shared schema until Lane 1 lands.

**Changes:** adapt each final state to the shared correction contract; remove direct mutation of finalized company-expense effects.

**Acceptance:** final-state direct edit rejected; correction/reversal requires reason and source version; before/after and M/C/A retained; concurrent correction one winner; RBAC and replay proved.

### Lane 4 — Q22 source chain (**serialized schema phase after Lane 0**)

**Owns:** source provenance/version schema and migration, `shared/src/governance/source-authority.ts`, `backend/src/services/source-change.service.ts`, shipment→trip dispatch snapshot, billing/AR/payment-allocation read consumers and the Q22 chain suite.

**Changes:** persist source version/provenance at all seven edges; make issued note and receipt allocation authoritative for AR/outstanding reads; stakeholder warnings; linked history.

**Acceptance:** one public table-driven case per pair covering pre-milestone recompute + warning and post-milestone non-overwrite + version/adjust/reverse + history, including send/change and allocation/reversal races.

### Lane 5 — identity, settings and configuration replay

**Owns:** auth identity/unit routes, singleton config, debit-note templates, app/GPS/LLM/onboarding settings, FAQ and tire lifecycle routes/tests. Does not edit Lane 0 helper.

**Changes:** adopt required command helper and expected version; retain generated CRUD behavior.

**Acceptance:** normal/replay/key-conflict/concurrent/stale/RBAC matrix for each route class.

### Lane 6 — field operations and durable jobs

**Owns:** driver/forwarder container/seal/photo routes and services, OCR pump, GPS backfill/recapture, object-storage/job command tests. Does not edit shipment CLERK files.

**Changes:** stable evidence/job identity, expected evidence/container version, durable pending/succeeded/failed command state, compensating cleanup.

**Acceptance:** byte/checksum replay, same-key/different-bytes conflict, stale replacement/delete, scoped RBAC, concurrent job submit and recoverable retry.

### Lane 7 — salary/fuel/credit concurrency completion

**Owns:** salary action/issue/post/exclusion routes and tests, fuel-invoice routes/services/tests, credit-override routes/services/tests. Shared governance changes come from Lane 1.

**Changes:** adopt required key/version contract on every remaining transition; close approval-loser and stale-editor gaps.

**Acceptance:** normal/invalid/RBAC/replay/stale/concurrent approve-vs-reject and final-state correction tests.

## Landing order and final gate

1. Freeze migration ownership; land Lane 0.
2. Land Lane 1 policy additions.
3. Run Lanes 2, 3, 5, 6 and 7 in parallel with strict file ownership.
4. Land Lane 4 after its schema slot is assigned.
5. Run a generated route census and fail CI if a new material mutation lacks required-key, stale-write and durable-attempt declarations.
6. Run root lint, backend/frontend typecheck and tests, build and full E2E; save red-to-green artifacts under `qa/`.
7. Re-run authenticated role/mobile visual QA only after the backend closure matrix is green.

No question in this audit may be declared complete from a green full suite alone. Closure requires every `MISSING`/`CONTRADICTED` row above to have current public-boundary evidence.

Status: DONE
Summary: Current code was mapped against every accepted clause, all Q18 final-state classes and all Q23 mounted mutation classes. The report identifies exact residual behavior and a dependency-safe implementation/test split.
Concerns/Blockers: Shared schema, idempotency/audit infrastructure and governance policy are serialization points. The current worktree already contains unrelated user/agent edits in those files, so implementation lanes must coordinate ownership and preserve them.
