# Kanban finance and direct-operation regressions

> **Current criteria note (2026-09-17):** dated execution notes below are historical. Current no-approval behavior is defined by [NO-APP regressions](2026-09-17-no-approval-workflows.md) and current PRDs. A recorded advance request is not cash funding; legacy approval codes may remain in history but never gate a new action. Re-run changed cases rather than carrying forward old PASS.

User decision: there are no internal approval workflows. Legacy ticket expectations of checker/approver stages are superseded; retain validation, authorization, audit, correct balances and real settlement state.

| Case | Requirement | Reproduction and expected result |
|---|---|---|
| KF-OPS-01 | QA114, QA053, QA040 | OPS saves a positive expense without receipt; reopen its editor, correct figures and attach/remove a receipt. Same expense persists, wallet reflects amounts once, invalid negatives retain sign and inline error, unsettled author-owned rows remain editable. |
| KF-OPS-02 | QA113/114 | Create an Ops settlement from valid recorded expenses. It finalizes directly, contains the exact entries and sum, blocks missing required evidence and duplicate linkage, and reports no invented cash transfer. |
| KF-FUEL-01 | QA117 | Authorized invoice save requires exact allocated litres and valid linked records; direct create/readback/edit works without approval action or status selection. Zero/missing/excess allocation, wrong customer/supplier and stale version remain errors. |
| KF-EXP-01 | QA115/086/087/089/088 | Create expense with invoice photo, direct save, reopen/reload; recorded expense and unpaid supplier debt agree. No reviewer/reason requirement, no image lock. Paid state only follows genuine supplier settlement. |
| KF-DELETE-01 | QA119 | Eligible shipment deletion confirms its identity then deletes once. Operational/financial references block with explanation; old request route cannot create approval records. |
| KF-CREDIT-01 | QA138 | Within-limit trip saves normally. Authorized excess credit uses a direct reasoned exception; unauthorized actor denied. Preserve scope, expiry, exposure maximum and single-use guards. No approved-request picker. |
| KF-PAY-01 | QA080/081/084 | Selected-driver attendance state advances once with visible feedback, rollback on error; calendar keyboard reachable, locked/trip dates immutable. Valid base salary edit persists to selected driver; negative salary rejected visibly. |
| KF-UI-01 | QA029/079/101/102 | Payroll default overview matches actual rule; negative earnings use neutral balance wording; empty accounting queue compact; account ledger/filter visible ahead of expandable aging at390/834/1440. |

Other assigned requirement acceptance criteria remain enumerated in plans/260915-kanban-reimplementation/reports/finance-matrix.json and receive per-item source and execution evidence.

KF-PAY-02 (QA129/084): confirm salary, then update driver rate and add late operational TRIP_DAY in the locked period. Driver completion must remain valid; confirmed individual salary and attendance snapshot must stay fixed, with explicit reconciliation guidance. Legacy confirmed rows without a stored snapshot must be labeled unavailable/reference only. Reopening an eligible unlocked confirmation discards the old snapshot and reconfirmation captures current values.

## Independent final review — KF-AUTH-01

With a loaded authenticated user and a mounted stateful unsaved input, force a background auth query to return 503. The retry gate must retain credentials and the same input value, isolate background interaction, offer Retry/local Logout, and restore the draft on successful retry. Cold-boot429/502/503 must still show recovery without rendering protected child routes. Use existing shared gate coordination at priority15 (connection10, application-upgrade20).

KF-AUTH-02: With multiple recovery gates mounted in either order, only the highest-priority panel is visible and interactive. Auth15 overrides connection10; upgrade20 overrides both. Removing upgrade restores auth without disabling its retry/logout controls; releasing every gate restores page display/focus.

KF-FINAL-03: Retired debt-offset approve endpoint returns410 and cannot change the source offset, ledger rows, balance, audit or idempotency state. Existing create/cancel financial tests must continue passing. Freight pricing route fixtures reserve a test-only date allocation window, choose four genuinely distinct unoccupied dates and clean up only IDs created by the test; the explicit duplicate-date case must still return409.

KF-SEED-01: On the isolated release-verification database only, resume an interrupted demo seed with nine existing trips, the two exact OPS expenses and four recorded advances but no settlement. The rerun must recover only those unlinked owned fixture expenses, record one balanced settlement (16,000,000 advances = 2,470,000 expenses + 13,530,000 refund), and a second rerun must not duplicate trips, expenses, advances, settlement or ledger entries. Wrong-owner, changed amount/note/type, unrelated expense and actively settled fixture rows must not enter selection. Same-reason advances and same-note settlements for another owner must not suppress this owner's seed.

KF-ADV-DRAFT-01: A legacy DRAFT advance may be explicitly recorded with corrected valid amount/reason, or voided with a reason, by its OPS owner or ADMIN/MANAGER/ACCOUNTANT. Preserve before/after audit; post exactly one OPS_ADVANCE ledger row only for record. Require expectedVersion and Idempotency-Key. Deny other OPS, driver/customer/CUS, stale version, RECORDED/VOIDED rows, pre-existing ledger or active settlement claim. Same-key replay repeats the result without effects; different-payload reuse409; generic update/delete/approve/reject remain404. Staff and forwarder aliases share one idempotency namespace without broadening OPS financial permissions. UI shows actions only on authorized drafts, supports cancel/retry and invalid-input feedback, refreshes list/balances and uses compact mobile/tablet/desktop controls.

KF-ADV-DRAFT-02 (actual browser regression): Real auth login and /me return `id`, while auth context consumers require `userId`. Normalize both wire responses into the canonical cached identity; retain compatibility with existing `userId` payloads. Drive real AuthProvider with id-only OPS login and /me wire DTO plus own/non-owned DRAFT advance rows (requesterId/version from actual list shape). Owned draft actions must appear and foreign-owned actions must remain hidden. All dialog controls must use shared `input` styling; mandatory fields and negative amount feedback must remain visible. Remove repeated create title and animated KPI label from forwarder list.
