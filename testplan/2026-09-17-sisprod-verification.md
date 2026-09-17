# Production polish patch verification — 17 September 2026

This report records a local audit of the production branch. It is not a claim
that every component state, production integration or physical device was tested.
Base: `cfa0753fa85764e829e60bb8fdf5993482885f33` (`prod`).
The patch is uncommitted and has not been pushed or deployed. Clean-apply
validation compares the applied file bytes and modes with the working tree
and checks that the real Git index remains unchanged.

## Scope and design

Earlier uncommitted source changes were compared file by file with fetched
production and were already present upstream. They were backed up before the
fast-forward. This patch contains only subsequent fixes, regressions and QA
runner corrections. It adds no schema migration or deployment configuration.

- Calendar month/year changes use one atomic state transition. This fixes a
  reproduced January-to-December jump by two years under React StrictMode.
- Notification failures preserve the loaded feed and expose retry/error states
  for pagination, refresh and read mutations. Phone feedback remains compact.
- Customer identity searches and optional monthly trip statistics use separate
  queries. CUS no longer makes forbidden trip requests; supported roles request
  only the current month. Export waits for complete statistics.
- Authentication distinguishes invalid credentials (401) from unavailable
  PostgreSQL/Redis checks (503). Protected handlers remain denied during an
  outage, while the browser retains the session for explicit retry. An ended
  Redis client can reconnect after the service recovers.
- Customer form template selection follows finance edit capabilities. CUS no
  longer sends the observed forbidden template read. Existing template state is
  retained; the backend already ignores governed-field edits by intake roles.
- Appointment copying fills only truly empty destinations: partial date/time
  drafts and complete existing appointments survive. The copied-count message
  reflects actual targets. Keyboard and compact/touch layouts expose a 44px
  control below the inputs; it is disabled during submission.
- Configuration dialogs preserve their close lifecycle so keyboard focus can
  return to the trigger. Existing reset-on-open logic resets cancelled drafts.
- CUS container permissions match the existing save authority: linked-trip
  routes/ports remain read-only, unlinked plans remain editable, and permitted
  container-number corrections remain available. No write authorization changes.
- Supplier row menus have accessible names and expand state; native Enter opens
  the menu without triggering the containing row navigation.
- QA runners report incomplete/failed execution as nonzero and discover both
  driver suites. Exact destination/content/API checks replace false-positive
  navigation results; stale selectors are aligned with current rendered UI.

These bounded changes address observed defects. A broader backend rewrite would
increase regression risk without a demonstrated benefit for this audit.

## Local environment and evidence

Frontend: `http://localhost:7175`; API: `http://localhost:3001`.
PostgreSQL: local Docker port 5441; Redis: local port 6391.
Full backend integration tests use a separate cloned database and Redis DB 14.
The API was restarted after authentication changes before final browser reruns.
Canonical account definitions remain in `testplan/testaccounts.txt`; credentials
and local data are excluded from the patch.

Raw evidence remains in `qa/2026-09-17-sisprod/` on the authoring machine.
Lane reports remain in `plans/260917-sisprod/reports/`. Those large local artifacts
are deliberately excluded from the portable source patch. Reproduction steps
are included in the adjacent SISPROD test plans.

## Browser coverage

The broad automated suites began on a980c53c before the final small fixes. The
newly fetched production commits were integrated while that baseline run was
finishing; final affected-file reruns and static/build gates bind the delivery
to cfa0753f plus this patch. No baseline result is described as a clean full run
of every final-source permutation.

The root inventory navigated 59 Admin route paths at 390, 820 and 1440 pixels
(177 states), plus 15 parameterized record routes at the same widths (45 states).
A separate operational-role sweep covers 56 role/route targets at the same
three widths (168 states), including CUS, DISPATCHER, DRIVER, OPS, ACCOUNTANT,
MANAGER and CUSTOMER. The configuration sweep also clicked 50 create/edit
controls across phone and desktop layouts. Route screenshots establish navigation and
layout coverage only; actual dialog/filter/retry/save actions are recorded
separately. The linked CUSTOMER fixture is used for portal detail checks.

- Calendar: selected January 2026 in Salary, clicked Previous and Next; headings
  and period requests showed December 2025 and January 2026.
- Notifications: real local driver notification records; forced failed reads and
  mutations before the API; clicked retry/read-all; checked retained feed,
  unchanged count on failure, successful read state and backing DB records.
  Exact fixture records were deleted and previous read flags restored afterward.
- Draft preservation: typed a CUS customer-create draft and clicked Save while
  exactly one local POST was intercepted with 503 before reaching the API. The
  same modal, both entered names and token remained; the visible error appeared
  and Cancel closed the unsaved form. The final run had no unexpected 403.
- Session recovery: locally forced `/auth/me` 503; clicked `Thử lại` and loaded
  configuration using the retained token. Real dependency refusal/recovery is
  separately exercised by backend HTTP/Redis tests.
- Customer catalog: typed/cleared search at three widths; held and failed the
  optional statistics request; clicked retry and checked retained search,
  independent request counts and export availability.

## Gate results

| Gate | Result and evidence |
|---|---|
| Backend full baseline | 219 unit + 2,159 integration PASS; zero failures/skips; `root/backend-full.log` |
| Backend final CUS permission change | Entire workspace file 90/90 PASS; `backend/cus-workspace-final.log` |
| Shared | 219/219 PASS; `root/shared-tests.log` |
| Frontend full baseline | 381 files: 2,456 PASS, 4 FAIL at default one-second asynchronous waits; original stacks retained in `root/frontend-full-final.log` |
| Frontend final affected coverage | Latest per-file evidence: 21 files/228 cases PASS. Initial affected run 226/227; new supplier test had an ambiguous `Sửa` selector across responsive layouts. Scoped to the opened row without changing keyboard assertions; entire supplier file 4/4 PASS. Notification-bell file 1/1 PASS separately. All four original failure files passed unchanged with one worker. `root/frontend-affected-final.log`, `roles/supplier-tests-isolated-after.log`, `root/notification-bell-final.log` |
| Static/build | Final root lint, frontend and backend TypeScript, production build and context validation EXIT 0; `root/final-static-gates.json` |
| Runner contracts | Python 11/11 and SPA verdict Node 14/14 PASS; shell syntax PASS; `root/final-{python,smoke}-contracts.log` |
| Knowledge metadata | Official refresh for 463 scoped source files; zero hash drift/validation issues; `knowledge-final/final-audit.json` |
| E2E | Latest per-suite: 324 PASS, 0 FAIL, 1 SKIP across 19 suites; final CUS suites 18/19 passed 37/37 and 54/54; `route-inventory/latest-e2e-evidence.json` |
| Final role smoke | All eight roles PASS with strict destination, content, guard and API checks; `route-inventory/latest-spa-smoke-evidence.json` |

The E2E initial full run was 298 PASS, 7 FAIL, 1 SKIP. All seven failures were
corrected test-driver timing/selector/fixture assumptions. Five affected scripts
then passed 131/131 cases; the final runner positive/negative integration passed
eight cases and retained the missing-workbook SKIP/nonzero exit. This is assembled
per-suite evidence, not a claim of one entirely green full invocation. Original
failures and corrective reruns remain available. A final CUS rerun also exposed
a fixed-delay fixture check: the screenshot and subsequent focus proved the row
was present after the early boolean had been sampled. The harness now waits for
the exact owned row before checking visibility/overflow, retaining all assertions.
The entire affected suite then passed 37/37, and the final accessibility matrix
passed 54/54. The all-role smoke completed with eight strict PASS verdicts, API
200 responses and no captured browser/API errors. An earlier invocation omitted
the API base suffix and failed at login; its configuration-error log remains.
Two owned Chromium processes required cleanup after completing their assertions
because browser teardown hung. The corrected smoke process ultimately exited 0;
the artifact lineage and teardown note distinguish this from assertion failures.

The broad frontend run occurred under substantial concurrent host load. Its four
failures were loading/close waits, not payload mismatches; the unchanged complete
files passed in the final single-worker run. No assertion, business invariant or
Testing Library wait deadline was relaxed. One early run with Vitest's default
five-second test deadline was interrupted after scheduling timeouts; it is not
counted as a completed gate. Final runs used a 30-second per-test outer deadline.

The isolated backend database and its temporary dump were removed after the 90-case
final regression. Only local application and QA fixture data were used.

## Known coverage limits

`docs/quytrinh/29.7 - DATA PM.xlsx` is absent, so the workbook-dependent dispatch
suite cannot establish its 48-row parity. The runner explicitly reports SKIP and
nonzero exit. No workbook was fabricated to produce a pass.

Physical iOS/Android/Safari, camera/IME/push behavior, external OCR/storage/email,
production load and deployment rollback were not exercised. Not every financial
mutation, data permutation or error/recovery combination was driven through UI.
Local Chromium responsive emulation does not establish real-device behavior.

## Verification coverage

| Claim / bug | Rung | Evidence | Not covered |
|---|---|---|---|
| Calendar year rollover | UI DRIVEN | `root/year-boundary.json`, Previous/Next screenshots and StrictMode regressions | Physical devices, every financial period consumer, production |
| Notification failure/retry without blanking existing records | UI DRIVEN | `root/notifications-results.json`, post-click screenshots, exact fixture DB proof | Push delivery, real lost response after server commit, all notification routes |
| CUS catalog and independent monthly statistics | UI DRIVEN | `roles/customer-recheck-settled.log`, `roles/customer-export-recovery-results.json` | Exported workbook content, every finance role/month permutation |
| Session retention and dependency denial/recovery | UI DRIVEN plus DB/API VERIFIED | `root/auth-recovery.json`; `backend/auth-and-recovery.log` | Redis cluster/TLS, production load, real infrastructure failover |
| CUS linked-trip route/port edit consistency | UI DRIVEN plus DB/API VERIFIED | `roles/ports-permissions-results.json`, linked CSQU3054383 and unlinked container 8200 at 390/1440 | Saving a new port in browser, every legacy fulfillment shape, staging |
| Appointment copy preserves partial/complete values and supports keyboard/touch | UI DRIVEN | `roles/appointment-copy-after-results.json`: 6/6 cases at 390/1440, exact copied counts, native Enter, pointer, 44px/no overlap | Submission-pending disabled state is code-reviewed only; physical devices, concurrent remote edits |
| Supplier keyboard menu and route/supplier focus return | UI DRIVEN | `roles/supplier-after-*.png/json`, `roles/ADMIN-route-focus-*.png/json` | Screen-reader certification, Safari/iOS, every dialog consumer |
| Broad role/page layout inventory | UI DRIVEN navigation inventory | Admin/role/detail screenshot and DOM inventories | Every subcomponent state, physical devices, all data permutations |

## Applying the source patch

The exporter uses a temporary Git index and a clean archive of the exact base.
`git apply --check` and actual application must succeed; applied file bytes and
executable modes must match the candidate tree, and the real Git index must be
unchanged. The manifest records the full base, file list, size and SHA-256 under
`qa/2026-09-17-sisprod/package/manifest.json` on the authoring machine. Raw QA
artifacts, credentials, uploads, build outputs and local HANDOFF are excluded.

Use the exact base recorded in the final delivery before applying. On the other
machine, run `git apply --check /path/to/sisprod.patch`, then
`git apply /path/to/sisprod.patch`. Follow the repository's normal build and
release checks. This work is uncommitted and has not been pushed or deployed.
