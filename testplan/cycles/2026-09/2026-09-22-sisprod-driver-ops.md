# Driver and Ops local workflow audit — 22 September 2026

Status: inventory and CODE-READ ONLY preparation. Current baseline: `43d6ed6b4f403052bdbfede65251880ee7f5970a`. Historical September17 evidence is not current verification.

## Scope and acceptance

Exercise the current driver and Ops pages, their meaningful actions and error recovery using local frontend7175/API3002 and owned fixtures. Preserve production business rules and financial calculations. No commits, branches, worktrees, remote writes, deployment, external providers, schema changes, shared primitives or global harness changes. Use native Drizzle for fixture setup and post-click persisted-state proof. Screen widths:320,390,820,1440;1024 where a breakpoint or dense table needs checking. Real-device camera, GPS, Safari and production-load behavior remain outside emulated-browser proof.

## Cases

- **DOPS-001 — Current route and control coverage.** Confirm `laixe` is DRIVER and `giaonhan` is OPS using local auth and DB. Click navigation and actual page controls across the inventory; verify usable content, intended route, no page-level overflow, reachable actions and no uncaught errors. Exercise tabs, date/search filters, empty-result clear and back actions. Record screenshots/DOM per role and viewport.
- **DOPS-002 — Driver lifecycle and handoff.** On an owned dispatched order, click acceptance (the current contract starts the trip here; the older pickup/loading/delivery milestone controls were intentionally removed); verify the exact trip/fulfillment event and rendered state. Premature/duplicate/blocked actions must retain their reason without duplicate effects. Inspect pair/two-orders handoff, completed history, and cancel or reassignment behavior with separately owned fixtures. Canonical `laixe` has active bulk seed trips, so the positive lifecycle uses an isolated owned driver with the same DRIVER role; preserve existing trips.
- **DOPS-003 — Driver evidence and completion.** Open e-POD and evidence controls, cancel without mutation, reject invalid/missing input, upload local non-sensitive files, retry a deliberately interrupted local upload, submit and complete only when the current real contract permits it. Confirm file/submission/events and final state with Drizzle. Provider OCR and real phone camera/GPS are not implied.
- **DOPS-004 — Driver expense entry.** Open the actual expense form on an owned trip; test invalid amount/date, cancel, valid save, explicit network failure/retry and duplicate protection. Confirm the exact amount/date/actor and one persisted expense. Check read-only/closed-trip feedback and saved evidence presentation.
- **DOPS-005 — Ops day plan, personal pin and failure.** Filter the owned lot by date and business key, pin/unpin it, reload and confirm persistence and actor isolation. Interrupt the local pin request and observe whether the UI restores the persisted state and visibly explains failure. Rapid repeat actions must not produce an unintended final pin state. Evidence includes shipmentPins rows before/after.
- **DOPS-006 — Fleet tracking.** Refresh and read the owned assigned truck before/after driver progress; verify status and update time against persisted rows/events. Combined time/date must use the current shared `HH:mm DD/MM/YYYY` display contract with full year at every width. A missing or stale value must not masquerade as current activity.
- **DOPS-007 — Ops expenses, receipts, advances and wallet.** Open expense entry from the owned lot, test invalid/cancel/valid flows, add/remove/retry local receipt images, and verify one persisted expense with correct wallet effect. Open advance request, test invalid/cancel/valid/retry, and confirm a request alone does not count as cash received. Exercise visible history filters and details.
- **DOPS-008 — Ops settlement and export.** Use only owned eligible expense records (or a dedicated isolated Ops account if the workflow batches all user expenses). Open/create/detail/finalize or reopen the allowed local settlement, inspect invoice groups/totals, download the actual Excel and open print UI. Confirm settlement membership and unchanged cash balance unless an explicit cash operation occurs. Preserve blocked reasons.
- **DOPS-009 — Permission and state boundaries.** Drive each role into the other portal and an unowned detail; confirm guarded navigation/feedback and no unauthorized mutation. Revoke only an owned assignment fixture to check stale open forms/evidence access if supported by the current flow.
- **DOPS-010 — Loading, errors and retries.** Use scoped browser interception only for owned local requests to provoke network failure, then click the displayed retry. Keep entered data, prevent duplicates, and distinguish a failed request from an empty result. Capture the failing baseline before any fix and rerun the same control after regression coverage.

## Evidence and gates

Store exact commands, exit statuses, browser logs, screenshots, DOM assertions and Drizzle query/output under `qa/2026-09-22-sisprod/driver-ops/`. Every claimed mutation needs post-click database proof. Focused frontend tests and scoped checks follow any correction; root owns global lint/typecheck/build/full suites. Independent review is required for non-trivial changes. Report each claim separately as CODE-READ ONLY, DB/API VERIFIED or UI DRIVEN with explicit remaining gaps.

## Reproduced correction — DOPS-005

`pin-baseline-ready.log` and `visual/pin-baseline-failed-request.*` reproduce a failed PUT for shipment273 through the actual giaonhan pin button. Optimistic state reverts after query invalidation but no alert/toast appears. The page swallows `mutateAsync` rejection. Add a failure toast, restore the previous query snapshot, and serialize pin updates while pending to prevent repeated clicks from queuing conflicting state. Regression cases must first fail on baseline: failed request restores unpinned state with visible feedback and can retry; repeated click while pending sends exactly one PUT. Preserve existing optimistic ordering and successful persistence/isolation. Product files owned: `frontend/src/pages/OpsOrdersPage.tsx`, `frontend/src/pages/OpsOrdersPage.test.tsx`.

## Reproduced correction — DOPS-006

`fleet-baseline-ready.log` and `visual/fleet-baseline-timestamp.*` show own truck9/trip196 update as `15:12 22-09` on an Asia/Singapore host. Inline browser-locale formatting both omits the year and renders host timezone rather than current product Vietnam time. Reuse canonical `formatDateTimeShort` instead of maintaining a second formatter. Regression expects `08:02 07/09/2026` for `2026-09-07T01:02:03Z`, and an em dash for missing/invalid values. Recheck actual fleet after driver acceptance at320/390/820/1024/1440. Owned files: `frontend/src/pages/OpsFleetTrackingPage.tsx`, `frontend/src/pages/OpsFleetTrackingPage.test.tsx`.

## Cost document supplement

Read current supplied cost-rules.txt sections1/2/3a and comments. Verify driver entered amounts remain editable suggestions (road50k/100k/200k), invoice metadata and shipment/road grouping persist; road costs never become customer receivables. OPS actual paid and expected customer recovery are separate, requests/settlements do not create funded cash. Section3a unfinished reports/proposal questions do not create new behavior requirements. Missing driver expense edit/remove control is reported for coordination; no irreversible deletion introduced.

## Driver own-cost correction — DOPS-004 / document section2

Actual driver UI saved two own costs on trip196, then offered only evidence controls. The browser harness also demonstrated why a correction path matters: its triple-click number-input clearing appended to the100000 suggestion; it saved10000110000 instead of intended110000. This is retained as a QA harness failure, not an app amount-validation defect (the amount is within contract). Use the existing audited `expense-accounting/entries/DRIVER/:id/update` path to correct this owned record via UI. Backend already authorizes owner DRIVER, checks expectedVersion/current assignment/financial lock and reason, and forbids payer/customer-charge changes. Add a small driver-specific editor for own unconfirmed cost amount/name/date/invoice/note and mandatory reason; never send forbidden financial fields. Confirmed/reconciled/voided records show a blocked reason; no deletion API is invented. Regressions: validation, pending duplicate/close guard, failed save retains draft/manual retry, conflict reload takes current version, locked/confirmed no update, successful refresh. The original driverEnteredAmount/audit must remain traceable. Owned files: `DriverExpenseCorrection.tsx/.test.tsx` and `ShipmentCostEntryForm.tsx` integration.

## Config-driven driver norms and narrow header — DOPS-001/004

User explicitly asked that customer/location/document-specific defaults stay in seed/config. Current driver choices consume a static shared norm array even though `/driver/me/fee-norms` already exposes active database configuration. Migrate suggested road choices to that API, submit its unchanged `feeNormCode`, preserve manual categories and error/retry when config cannot load. Account catalog must return the same code/label/numeric-amount shape from DB; remove static shared norm defaults. Generic labels replace embedded location examples; persisted old names/codes stay unchanged. Regressions cover a custom configuration label and non-default amount, unavailable catalog/manual save, authoritative norm reference, and existing expense semantics. Native owned config fixture plus real driver selection must prove current values display.

320px own driver name overlaps the month selector (`visual/pod-ready-320.png`). Permit the identity flex child to shrink and ellipsize text; keep full name in DOM and title. Verify bounding rectangles do not intersect at320/390/820/1024/1440 and month control remains actionable. Owned shell files: layout/Topbar.tsx, topbar.css and Topbar.styles.test.ts.

## Reproduced correction — DOPS-007 removal recovery

`ops-delete-baseline-ready.log` and `visual/ops-delete-failed-baseline.*` reproduce cancel (zero DELETE) then confirm of owned expense25 with a deliberately failed DELETE. Row remains but rejection is silently swallowed by OpsExpenseHistory. Add error toast and a synchronous pending lock through confirmation/mutation; retain row and allow deliberate retry. Existing server action voids source/native record rather than hard-deletes and enforces owner/financial-state rules. Regression: failed deletion explains error and leaves row; pending repeated click sends one delete. Owned files: OpsExpenseHistory.tsx and OpsWalletPage.test.tsx.

## Reproduced correction — DOPS-007 receipt access

Actual owned OPS15 attached a receipt to cost23 on shipment273 through the authorized expense UI; the image GET returned403 (`ops-settlement-final-partial.json`). OPS write scope already accepts live truck assignment or the operator's saved non-voided expense, but photo authorization only accepts a manual user-shipment link. Reuse the authoritative existing scope for exact-key native OPS and accounting evidence, retaining active owner checks and strictest-match collision denial. Do not grant unrelated operators access or alter fixture links. Add isolated regressions first: active owner without manual link can read own saved-cost receipt; same shipment/assignment alone never grants another owner's receipt; disabled owner/other roles denied; voided-only owner without remaining grant denied; accounting evidence follows same scope. Parent authorized backend photo-authz/scope helper and focused test ownership. Verify real images load after static API restart; preserve403 baseline.

## Current focused gate results

All frontend owned files stable:6 focused files/56 tests pass (`frontend-final-focused.log`). Catalog backend7 tests pass with explicit registered fixture cleanup (`card7-fee-norms-cleanup.log`); legacy/new receipt authorization18 tests pass (`photo-scope-green.log`). Browser route survey70 current role×width rows; positive trip/cost/POD/OPS expense/settlement flows and native proof described in `plans/260922-sisprod/reports/driver-ops.md`. Receipt fix actual image200/nonzero dimensions passed on API round5. Parent owns global gates.

## Reproduced correction — driver/accountant confirmation handoff

The accountant tiền đường dialog sends expectedVersion1 for every cost, while the driver correction increments its existing normalized source version. Corrected drivercost1 therefore cannot be confirmed through the actual UI. Add the current normalized version to the existing read DTO and submit it; legacy rows with no normalized source retain version1 because the existing command creates their first source. Keep409 on genuinely stale data and preserve unconfirmed financial state. Test DTO version after correction, stale rejection with no confirmation/cost change, current confirmation and legacy fallback; frontend tests verify the sent current version, pending guard, visible rejection/reload and current-value display if authorized. Coordinate actual owncost1 confirmation only after baseline409/native no-effect proof.

## Current E2E20 visual-state regression

Full current E2E at `qa/2026-09-22-sisprod/e2e/20260922-160533-51392` failed TC2051/TC3051 with body12/useful[]. Baseline screenshots show the fixture already moved to Đã nhận1, then the visual step reloads `/my-trips` into default Lệnh mới0. Select the accepted tab and await the exact owned trip card before measuring route/footer type. Keep body/useful>=12px and all existing overflow/touch/sidebar assertions unchanged; no app font edits. Own bounded harness edits `e2e/test_20_driver_flow_e2e.py`, `e2e/test_20_visual_driver.py`; both full suite20 scripts rerun serial against isolated7176/3003 E2E DB with current runner, preserving original failures.

Final driver confirmation handoff passed actualUI version3→4 with one110000payable and zero cash allocations; confirmed correction is blocked. Additional frontend4/backend1 tests pass. Complete E2E20 rerun33+37=70PASS,0FAIL,0SKIP and11runner contract tests pass. Fresh current artifacts/lineage recorded in the report; source frozen after these fixes.

## Canonical accounting projections in the debit editor

Final review of the single-count receivable repair found that the debit editor
still permits changing/deleting a linked trip-expense copy. Its direct writer
updates only that copy, bypassing the native OPS/driver/invoice source and its
confirmation rules. Keep non-TRIP canonical projections visible but read-only,
explain that corrections belong to the source accounting workflow, and reject
direct edits/removals with409 before any write. Preserve native manual trip rows
and TRIP self-links. Use an optional response flag for wire compatibility.

Regression: OPS/DRIVER/INVOICE copies have the flag, reject buy/sell/note/delete
and leave source/copy/manual mixed-request rows unchanged; legacy/manual and
TRIP-self edits still save. Frontend must disable managed input/delete and omit
stale managed draft edits/removals while allowing ordinary rows. Actual lot273
click/DOM/API readback must prove the confirmed copies are protected. Existing
frozen-lock and projection single-count tests remain unchanged.

### Projection guard narrow-screen layout follow-up

The first final browser proof passed its financial/control assertions, but the320px screenshot showed the new source-correction hint squeezed vertically by the existing non-wrapping fee-row flex layout. Restrict wrapping to managed rows, keep name/hint on their own lines, retain readable amount/control widths, and repeat all five viewports plus the unchanged readonly/409/no-effect assertions. Preserve original screenshots as baseline.
