# Accountant and financial backend audit — 22 September 2026

Baseline: production commit `43d6ed6b4f403052bdbfede65251880ee7f5970a`.
Scope: local ACCOUNTANT workflows and their financial read/write authorities.
Use only owned `QA22-ACCOUNTING` fixtures and repository-native Drizzle. No
production or staging writes, schema changes, approval-policy changes, commits,
pushes or deployments. Root owns broad gates and runtime lifecycle.

The September 20 handoff is a lead, not evidence that those defects remain.
Each row begins CODE-READ ONLY until executed. Add a precise reproduction and
expected outcome before any demonstrated defect is changed.

| Case | Action / invariant | Expected evidence |
| --- | --- | --- |
| SIS22-ACC-001 | Open accountant overview and tabs; switch date/customer filters and open a lot | Actual controls, readable amounts, stable filters, no denied API calls or runtime errors. |
| SIS22-ACC-002 | Open debit summary and the same lot detail after multiple freight freezes | Superseded snapshots never count; each active trip grain contributes once; displayed summary/detail money agree. |
| SIS22-ACC-003 | Inspect OPS payable cost and negotiated customer charge independently | Cost affects payable; zero charge never increases receivable; entered charge contributes exactly once. |
| SIS22-ACC-004 | Inspect per-container and common-lot payable buckets | Container plus common totals conserve the lot amount, including unclassified categories; missing data remains unknown. |
| SIS22-ACC-005 | Edit a permitted debit amount/note; repeat or retry the same command | One financial effect and audit trail; native idempotency and optimistic versions retain their contract. |
| SIS22-ACC-006 | Lock lot costs, read summary/detail and export; try a subsequent edit | Frozen monetary totals remain stable, edit denial is actionable, export matches the locked authority. |
| SIS22-ACC-007 | Accountant confirms/withdraws debit adjustment and retries | Current confirmation semantics preserved; pending state blocks export where required; confirmation never changes rates. |
| SIS22-ACC-008 | Open receivable/payable details and payment/allocation controls | Valid scoped objects; decimal precision and outstanding balance preserved; retry does not double-post. |
| SIS22-ACC-009 | FCL intake with container route and freight preview/freeze | Current authoritative route produces one live grain; preview is read-only and frozen data is non-retroactive. |
| SIS22-ACC-010 | Dependency/configuration error path if demonstrated | Invalid development configuration does not silently select the wrong DB/Redis; no relaxed authentication. |

### SIS22-ACC-010 reproduced: invalid optional config changes the DB

A fresh config-only subprocess with `NODE_ENV=test`, an explicit local probe
database, Redis database 14 and `DB_POOL_MAX=-1` exits 0 and exports development
mode, database `silversea` and Redis port 6392. It imports no DB client. Evidence:
`accounting-backend/config-fallback-before.log`. Any invalid configuration must
now exit nonzero before exporting a runtime config in every environment. Valid
development defaults and valid explicit process values remain unchanged.
Subprocess regressions cover invalid pool limit/port/URL/environment, production
required values, normal dev defaults and explicit test configuration.

### SIS22-ACC-011 reproduced: frozen customer debt versus issued note

Create an owned lot with a trip freight snapshot, OTHER cost different from
customer charge, actual PS and OPS negotiated charge. Open its debit summary,
lock costs using the real control and export a Debit Note. Compare frozen
`receivableTotal` to issued nonexcluded billing-line gross totals and the actual
download. Expected: identical customer debt and one issued claim on retry;
company costs must not replace agreed customer charges. Capture the baseline
before any change. Both single-lot and batch service entry points are in scope.

Baseline reproduced through local ketoan UI on lot 270 / bill
`QA22-ACCOUNTING-before-mucbofog`: expand → lock → select → export. Frozen
receivable is 1,500,000; issued line gross totals 1,200,000; document net/gross/
inclusive totals are all zero. Evidence: before-exported screenshot/DOM and
readback-before-export.log. Regressions cover both issuing paths, zero customer
charge, positive residual charge, discount below freight, fractional rounding,
numeric/string values, explicit-null unknown versus absent legacy key, matching
line/header VAT values, immutable issued data and repeated/concurrent claims.
Existing empty snapshots retain zero-line behavior; nonempty explicit-null
receivable must reject with 409 instead of guessing debt from cost. Old issued
documents remain unchanged; missing-key legacy snapshots use frozen old
components only. No new VAT policy is inferred from absent tax data.

### SIS22-ACC-012 reproduced: payable HQGS cost displayed as customer revenue

The same owned UI fixture shows 250,000 in both Bảng 2.1 Hải Quan (revenue)
and Bảng 2.3 HQGS (payable), although OPS cost is 250,000 and the separately
agreed customer charge is 150,000. The displayed 2.1 total is therefore
1,300,000 instead of 1,200,000; with the 300,000 OTHER charge, only the latter
reconciles to the 1,500,000 summary. The newly supplied cost document section1
also explicitly separates actual OPS spending from recoverable customer charge.

Add an explicit optional customer-charge wire field; keep the existing HQGS
cost wire and payable calculation unchanged. The revenue table must use only
the customer-charge field, including an explicit zero; absent older producer
data remains unknown and must never fall back to company cost. Verify multiple
HQGS rows sum once, non-HQGS costs do not leak into this customs bucket, and
container-specific zero/unknown are preserved. Before/after component tests,
real service contract tests, and original browser click/DOM at1440/390 plus
unchanged DB values establish the correction. Section3b freight-only accounting
close is a separate flow and is not redefined by this CUS settlement correction.

### SIS22-ACC-013 / DOC008 reproduced: duplicate invoice save doubles cost

In the accountant invoice tracker, choose owned lot390/trip235, enter invoice
1,200,000 and supplier cost270,000. Hold the first request and click the still
enabled Save again. Baseline creates two tracker rows and two linked expenses,
each270,000, for one user submission. Evidence: invoice-before pending/saved
DOM/screenshots and two HTTP201 responses. Fix the form's synchronous pending
guard and disable controls while saving. A retry after a lost response must
reuse the same command key for unchanged payload; edited payload must get a new
key. Verify create and edit, rejection preserves entries, close/Escape cannot
unmount a pending save, and one actual UI save produces one linked expense.
Extract the460-line page's form for focused lifecycle tests rather than raise
the existing structure ceiling.

### Focused suite harness corrections

Keep all monetary assertions. Restore exact pre-test financial-policy rows in
the final Q01 fixture before deleting its owned payroll unit; the old teardown
persisted its test unit ID then deleted the unit, poisoning later credit tests.
Pin exact18 invoice-required seed codes introduced by the current catalog,
including per-code invoice/substitute-evidence policy. Replace workstation-only
absolute source paths with import-relative URLs and include existing structural
common-fee keys in the exact payable-contract assertion. For phơi-phiếu ID-space
collision proof, construct a deterministic nonmatching native/source fixture;
do not assume sequences remain ordered on a seeded database.

### SIS22-ACC-014 / SH009: durable accountant commands

The material-write registry baseline reports seven uncovered accountant routes.
The rate-adjustment create path's INSERT/NOT EXISTS can race and reports every
existing pending row as newly requested. Phơi-phiếu metadata/delete/voucher only
check for a key without persisting its result; assignment does not check it.
Wire each through the existing durable transaction envelope and pass its real
transaction into the canonical service. Serialize rate requests per sorted lot
with the existing uniqueness lock and native Drizzle queries; preserve confirmed
and withdrawn semantics and all existing role/version/financial gates.

Regression checks: absent key rejects; unchanged keyed retry returns the exact
original result and no second effect; same-key payload drift rejects409; different
keys racing for one lot produce one pending request with accurate requested versus
alreadyPending counts. Explicit surrounding-transaction rollback leaves neither
metadata, source void/audit, assignment, request nor treasury effect behind.
Existing service callers remain supported with an optional transaction argument.

## Artifact contract

Save exact commands, full output and exit status under
`qa/2026-09-22-sisprod/accounting-backend/`. Every UI DRIVEN claim requires an
after-click screenshot, DOM assertion, driver log and native Drizzle readback
of its financial effect (or proof that a read/denied command did not write).
Record local username and exact fixture identity. Desktop, phone, other roles,
concurrency, rollback and deployment coverage remain explicit per claim.

## Execution order

1. Resolve current source, accepted decisions and existing regressions.
2. Capture baseline through real local accountant actions using owned fixtures.
3. Add precise failed cases before the smallest source correction.
4. Run focused regression tests and repeat the original real browser action.
5. Obtain independent review; report all gaps to root for broad QA and patch.

### SIS22-ACC-015: invoice lookup races and narrow debit text collisions

Hold a real lot-search response, clear the search below four characters, then
release it: stale results must remain absent and loading stop. Hold lot A's detail,
select lot B and finish its detail, then release A: the selected lot, trip choices
and submit payload must all remain B. Repeat with a rejected stale A response.
No accounting write is needed to reproduce the cross-lot UI mismatch; unit
regressions also assert the submitted lot/trip pair. Cancel or replacing a picker
selection must invalidate pending generations rather than rely on timing.

At390px the long owned bill code in the settlement identity cell currently
paints into the adjacent bill column. Use real text range rectangles before/after
and desktop/phone screenshots. Wrap unbroken identifiers inside their own cell;
retain horizontal scrolling and all monetary columns. No generated business
labels or fixture-specific CSS.

### SIS22-ACC-016: phơi chi-hộ draft identity and delete/write consistency

Open the released owned trip's chi-hộ detail. Change only its customer-charge
input: the payable total must retain the existing company cost. With distinct
native entry and accounting source IDs, editing one row must never populate a
second row whose native ID equals the first source ID. Save only changed rows
with the matching native entry/version and preserve the other monetary side.
An unconfirmed OPS row must allow the existing void action; confirmed rows must
remain disabled because the authoritative writer rejects their deletion. Drive
the unconfirmed deletion and read back its VOIDED source/native record, with no
physical deletion or treasury change. Confirmed correction rules remain intact.

The same baseline dialog incorrectly calls140k agreed customer charge minus130k
company cost an actual10k overpayment/refund before cash was posted. Remove that
fee-editor warning; retain actual-cash overpayment annotations in settlement
reports. Regression asserts unequal independent prices produce no refund claim.

### SIS22-ACC-017: add a real chi-hộ fee with an explicit payer

Actual click '+ Thêm dòng' on owned trip196 returned400: the current shortcut
submits USER without payerUserId and guesses both money fields as1000. Replace
that shortcut with the existing validated expense-create drawer in OPS context.
Require a configured fee, real cost, independent agreed charge and selected
active OPS payer; no hidden default charge. Existing general expense creation
continues to support company, driver and supplier paths. Cancel writes nothing;
a valid save creates one real OPS source, refreshes the chi-hộ dialog and stays
retry-safe. Follow with edit, metadata save and source void through real controls,
then assert native/source identity, amount preservation and no treasury movement.

### SIS22-ACC-018: durable UI retry uses the same command identity

Phơi helpers currently generate new explicit UUIDs on every call, bypassing the
shared API client's retained identity after an unknown result. Omit default keys
and keep explicit caller overrides; use the existing session-scoped retention
for identical method/path/body. Apply to existing phơi helpers and adjustment
commands. In a real financial UI, allow the first voucher POST to commit then
replace its response body with truncated JSON. Retry the unchanged selection:
request keys must match and the original result must return, with exactly one
voucher/allocation/treasury posting. Repeat an assignment where available and
check one version/history transition. A changed payload remains a new command.

### QA-ACC-REPEAT-01 — repeatable native/source ID divergence

Run the phoi/phieu integration suite twice against the same seeded local database. Its voucher fixture must allocate native OPS and accounting-source IDs from their own sequences, guarantee those IDs differ, and assert the allocation targets the selected source. It must not insert a high explicit native ID that a later sequence allocation can collide with. Preserve exact amount assertions.

### QA-ACC-UPSTREAM-01 — current prod replay compatibility

After integrating the latest prod changes, preserve deployed durable endpoint names, payload hashing and stored response shapes. Replays must return the stored result without repeating domain writes; same key with changed payload must still reject. Retain the shared frontend client's pending key after lost/malformed responses.

### SIS22-ACC-019: voided OPS fees leave live financial totals

Create active and voided OPS fees at both container and whole-lot scope, with
independent cost/customer-charge amounts and categorized/common buckets. The
actual phơi void action keeps native/source history but every live debit detail,
summary and payable total excludes voided amounts, including an older linked
trip-expense projection whose native status was not synchronized. A new cost
lock freezes only the remaining live totals. Existing frozen locks and issued
notes must remain unchanged. Zero active rows retain the existing unknown/null
contract. Repeat the real accountant void action then inspect debit UI and native
rows; preserve evidence of the original stale amount.

### SIS22-ACC-020: latest-production command replay compatibility

The fetched production boundary uses runIdempotent endpoint constants, payloads
including userId and plain JSON results. Preserve those persisted formats for
all seven adjustment/phơi commands. Precreate genuine outcomes through that
boundary, then retry each existing key through its HTTP route: exact result,
status and no repeated write. Keep missing-key/payload-drift rejection,
competing-key request uniqueness and outer-transaction rollback assertions.

### SIS22-ACC-021: OPS billing projections do not duplicate debit revenue

Real accountant confirmation on lot273 changed displayed receivable185000 to
325000 with the same140000 negotiated OPS charges plus45000 PS. Confirmation
creates trip-expense projections; summary then counted both native charges and
those projections. Keep native OPS customer charges authoritative in the live
summary, retaining projection rows for billing/edit history. Real confirmation
must conserve the pre-confirmation amount, explicit zero stays zero, unrelated
legacy/driver expenses still contribute, and the next lock captures the same
value. Existing frozen locks remain unchanged. Repeat the actual debit read on
the confirmed owned lot and compare source/projection/lock amounts.
