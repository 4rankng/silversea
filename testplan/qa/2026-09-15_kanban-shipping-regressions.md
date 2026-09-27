# Kanban shipping reimplementation regressions

> **Current criteria note (2026-09-17):** dated execution notes below are historical. Current no-approval behavior is defined by [NO-APP regressions](2026-09-17-no-approval-workflows.md) and current PRDs. A recorded advance request is not cash funding; legacy approval codes may remain in history but never gate a new action. Re-run changed cases rather than carrying forward old PASS.

Read requirements from all 81 assigned Kanban-PROD documents regardless of their folder status. Completion claims are not acceptance evidence.

| Case | Requirement | Reproduction and expected behavior |
|---|---|---|
| KSHIP-001 | QA-066 | Open an editable trip with no stored journey legs; change notes and save. No generated or required empty journey blocks the update. A deliberately entered incomplete leg still fails with field feedback; removing the final optional row returns to no journey. |
| KSHIP-002 | QA-131 | In one open online form select multiple trip/container photos. Fail the first or middle upload or omit the URL. Successful previews become server URLs; failed and unattempted files remain usable for explicit retry. Saving cannot navigate away while unresolved uploads remain. No local persistent queue or reconnect replay. |
| KSHIP-003 | QA-030/131 | Create a trip then fail an attachment/child write. Retry after editing the open form: retain the created trip and container identities, do not create a second trip. Invalid draft legs/container identifiers reject before the first create. |
| KSHIP-004 | QA-134 | Two editors open the same original version. B changes revenue; A changes notes. Reconciliation must retain B's revenue and A's draft; overlapping changes require explicit review. A non-version409 must not trigger a retry; a second concurrent update remains guarded. |
| KSHIP-005 | Driver image204/QA025 | Driver detail contains one combined contact field, container-number/type pairs, import return depot under Hạ, distinct stages, uppercase tasks and separate notes. Factory invoice party is distinct from customer; each missing factory billing field is explicit, never silently borrowed. |
| KSHIP-006 | QA-064/067/137 | Direct authorized completed-trip changes use action/result wording that reflects immediate saves; revenue drawer preserves numeric amount/version and does not create NaN or approval wording. |
| KSHIP-007 | QA-128/129/130 | Zero manual allowance persists as zero; final route/trailer rates determine totals; actual driver completion synchronizes business-date attendance atomically and idempotently. |
| KSHIP-008 | KP058/QA060 | Every driver, CUS and batch container boundary rejects malformed IDs before writes, normalizes accepted values, retains numbers on seal-only edits, and rolls back mixed-invalid batches. |

Verification must record each requirement's actual source, executable checks and browser coverage separately. A green unit check is not UI-driven evidence. Current task does not deploy or commit.

| KSHIP-009 | QA-047 | When accepting a trip fails because the vehicle is busy, retain the blocking trip code and link only to an active fulfillment returned by the authenticated driver board. Otherwise explain that dispatch must resolve the assignment. |
| KSHIP-010 | POD direct completion | Submit both physical proofs, then complete only after the server acknowledges their save. A failed submission must not call completion; either failure must retain the current screen. Success uses recorded wording without review or approval. |

| KSHIP-011 | Online direct expense and settlement | Authorized validated expense creation immediately records; no maker/reviewer action exists. Incomplete migrated evidence remains DRAFT and cannot be settled. Recorded settlement has exact balances, unique allocations and reversals. Audit retains legacy state and actors; ownership, accounting locks and stale versions still reject. |

## Final execution evidence

The latest complete boundary/direct-recording group passed124/124 (`qa/2026-09-15_shipping-final-all-repaired.log`); immutable terminal/correction/reversal proofs passed7/7; final driverUI41/41 and concurrency/photos/dialog28/28. Driver terminal orders with missing historical acceptance events now hide both accept CTA and instructions. Actual Chrome134 two-session independent and overlapping edits are recorded in the shipping report, including selected local-value persistence on fresh trip1362. See `plans/260915-kanban-reimplementation/reports/shipping.md` and its81-document matrix for exact source and coverage limits.

| KSHIP-012 | No approval workflow, final discovered close boundary | An accountant completes an evidence-ready shipment with a SUBMITTED e-POD and no reviewer, or a historical ACCEPTED e-POD reviewed by the same accountant. Missing original physical POD, missing expense scopes, invalid role and stale versions still reject. The retired shipment change-review endpoint returns410 for apply/reject/retries and cannot change shipment/container/request rows or emit decision notifications. The material-write inventory exempts only explicitly named, statically proven response-only410 handlers; all active writes retain durable boundaries. |

| KSHIP-013 | Remove fuel OCR approval queue | Saving driver pump evidence preserves its photo, ownership, OCR values and anomaly/uncertainty without assigning an accountant approval. Driver labels say OCR is unverified, not waiting. Office evidence view has no confirmation/rejection controls. Former decision endpoint returns410 without requiring idempotency, invoking OCR quota checks or altering evidence/version/ledger. Existing historical reviewer facts remain read-only; no result is automatically confirmed. |

KSHIP-013 execution: backend8/8 (`qa/2026-09-15_shipping-ocr-retirement.log`), frontend35/35 (`qa/2026-09-15_shipping-ocr-ui.log`), both typechecks and scoped lint passed. Actual retired-route HTTP probes cover both old decisions twice, no idempotency key, saturated recognition quota, unchanged evidence/version/trip/ledger. Supplemental implementation details live on driver-detail matrix entry2 and in the shipping report.

| KSHIP-014 | Direct-recording wording consistency | Submitted e-POD describes saved evidence; cost notes request data reconciliation; trip bulk-edit result reports saved/failed rows only; settlement eligibility describes recorded advances, and retained actors describe recording/history. No remaining pending-approval copy in these five screens/components. Reuse existing POD, cost-entry and trip-list regressions; no financial behavior changes. |

KSHIP-014 execution: existing POD/cost-entry/trip-list regressions **17/17** passed; scoped lint has zero errors and two untouched TripListPage dependency warnings. Exact logs: `qa/2026-09-15_shipping-final-copy-tests.log`, `qa/2026-09-15_shipping-final-copy-lint.log`.
