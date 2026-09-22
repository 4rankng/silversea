# SISPROD shared UI and role audit — 22 September 2026

Base: `43d6ed6b4f403052bdbfede65251880ee7f5970a` (`prod`).
Target: local frontend `http://localhost:7175`, API `http://localhost:3002`.

## Acceptance and scope

Deliver an uncommitted portable `~/Downloads/sisprod.patch`, with clean apply,
reverse apply, exact contents/modes and index preservation checks. Fix defects
demonstrated by source and execution; preserve accepted business rules and the
existing design system. No commit, push or deployment.

Inventory current routes, subpages and primary actions across ADMIN, MANAGER,
ACCOUNTANT, CUS/document staff, DISPATCHER, OPS, DRIVER and CUSTOMER. Exercise
320/390/820/1024/1440px layouts, including coarse-pointer and keyboard controls.
Navigation evidence is recorded separately from complete action workflows.

For changed user behavior, capture the action, post-action DOM/screenshot,
request outcome and native database readback when a mutation is expected.
Test cancellation, invalid input, repeat submission, error recovery, reload,
role boundaries and cross-role handoffs where applicable. Use local QA-owned
records for mutations. Preserve failing evidence and document the specific fix
and rerun; do not weaken an assertion to obtain a pass.

## Planned shared cases

| ID | Steps | Expected |
|---|---|---|
| SIS22-SH-001 | Navigate every reachable static ADMIN route and record/detail routes at five widths; open primary dialogs and inspect keyboard focus, geometry and controls. | Correct page, no render failure or unexpected API denial, no viewport overflow; dialogs retain usable actions. |
| SIS22-SH-002 | Login, logout and switch role; navigate forbidden URLs and browser back; exercise shared account/navigation controls. | Correct home and authorization, no prior-user data, usable keyboard and phone navigation. |
| SIS22-SH-003 | As CUSTOMER, search/filter shipments, open an owned detail, debit notes and statement; export where offered. | Consistent customer scope and totals; empty/error/loading states have clear recovery. |
| SIS22-SH-004 | As ADMIN/MANAGER, create/edit/cancel representative catalog records, validate invalid input, reload saved records and delete only owned disposable fixtures. | Correct values persist exactly once, invalid input does not save, cancel preserves stored data. |
| SIS22-SH-005 | Run lint, package types, relevant frontend/backend/shared tests, build and E2E; inspect all failures and rerun corrected paths. | All affected checks pass with explicit evidence and any external-fixture limits recorded. |

Lane-specific cases live in the adjacent dispatch, driver/OPS and accounting
test plans. The final report will enumerate actual coverage and remaining gaps;
this plan alone is not evidence that a path passed.

## Reproduced backend layering regression

SIS22-SH-006: On the production base, run the backend unit suite. The existing
shrink-only architecture gate rejects direct database imports in
`routes/config/customers.routes.ts` and `routes/expense-accounting.ts`.
Move the customer history/bulk database operations and the accountant-assignment
transaction entrypoint into their domain services. Keep HTTP validation, RBAC,
idempotency namespaces/payloads, transaction boundaries, responses and audit
behavior unchanged. Re-run the existing customer drawer/bulk and accountant
assignment integration cases, then drive customer history and assignment UI
with database readback. The architecture baseline must not grow.

## Reproduced keyboard defects

SIS22-SH-007: On `/config/app-settings`, focus and activate **Tạo chính sách đầu
tiên**, then press Escape. The prompt closes but focus lands on the document
body. Keep the confirmation component mounted during its closed transition so
the shared overlay lifecycle restores focus. Test cancel, confirm, Escape,
reopening and one resolution per prompt; preserve the message during exit.

SIS22-SH-008: On `/customers`, Space on a row checkbox leaves it unchecked and
opens customer details; Enter on the row action menu also opens details. The
custom details drawer does not close on Escape. Limit row keyboard handling to
the row itself and use the established Drawer component for focus trapping,
Escape, focus restoration and responsive geometry. Verify child controls, row
activation, history loading, full-detail navigation and all five widths in the
browser, plus regression tests for the keyboard boundaries.

SIS22-SH-009: The existing exhaustive material-write gate finds ten mounted
accounting mutations missing from the registry. Deposit creation has no retry
boundary; several phoi-phieu handlers demand a command key but never use it.
Run these mutations through the established durable transaction command and
register the routes. Preserve permissions and response shapes. Verify same-key
replay, conflicting payload rejection, atomic rollback, concurrent adjustment
requests, and that corrections cannot duplicate a voucher or refund. Do not
exempt a financial mutation just to satisfy the architecture gate.

SIS22-SH-010: Deposit HTTP validation exposes the shared ID parser accepting
`123oops` as record123. Reject partial, fractional, signed, exponent and unsafe
IDs before any lookup/mutation. Preserve valid positive integer IDs and the
optional helper's absent/null/empty semantics. Run parser units plus affected
deposit HTTP and broader endpoint regressions.

SIS22-SH-011: Full E2E role-pill assertion still expects the old `CUS` label,
while the canonical shared role label and actual Users screen say `Chứng từ`.
Update that exact expectation while retaining all eight role assertions and
repeat the real Users UI suite. Any login timeout must be investigated and
rerun on stable sources rather than converted to a pass or skipped.

The CUS E2E filter also targets the retired ambiguous label `Trạng thái`;
the current screen distinguishes `Trạng thái điều xe` from `Trạng thái dữ
liệu`. Keep its response, URL and warning assertions and select the current
dispatch-status field by its full visible label.

### UI-ACC-CONTROLS-01 — accounting controls use the shared design system

The debit board and phoi/phieu surfaces used retired single-dash button classes, which render as bare text because Button.css only defines btn plus btn-- variants. Open the debit board at320,390,820,1024,1440; inspect date inputs, customer/carrier dropdowns, disabled/enabled actions and table scrolling. Open chi-ho and driver-cost dialogs on the control board; confirm actions retain visible boundaries, disabled states, keyboard focus and narrow-screen containment. Business commands and labels remain unchanged.
