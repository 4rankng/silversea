# HANDOFF.md — four-role UI/UX polish wave (cus · dieuvan · laixe · ops)

**Updated:** 2026-09-30 01:55 (+08)
**Controller:** Claude Code session (user order: "polish UI UX of cus (chungtu), dieuvan, laixe, ops for all device sizes", plus "avoid long text filler text in the app" and "commit frequently after each logical chunk")
**Status:** LANDED — 6 commits on `prod` (8f9ab5ea, ccc6d5d9, e45588ea, fa0e6efc, 1cafa684, + this handoff). One card open on a PM question.

## Goal

The four operational roles read clean at every device size: no dead section, no
phantom finding, no pill in a data cell, no teaching copy, one "chưa" per record.

## Commit ledger

- `8f9ab5ea` fix(ops): a dangling expense-source link no longer kills the register read (card 213)
- `ccc6d5d9` fix(dispatch): status and direction are plain text, one "chưa" per record (card 215)
- `e45588ea` chore(frontend): the UI sweeps measure the 40px touch floor the law sets (card 217)
- `fa0e6efc` fix(ui): drop long instructional copy on the four roles' surfaces (card 216)
- `1cafa684` fix(ops): wallet balances ride the shared rail; fund book stops crashing (card 218)
- `617bffb7` fix(cus): debit workspace stops asking for a catalog its role cannot read (card 214 → 220)

## Board

- **DEV_COMPLETED:** 213, 215, 216, 217, 218 (dated evidence blocks + verify steps inside).
- **IN_PROGRESS:** 220 (was 214; renumbered after a number collision with another
  lane's 214) — `CẦN THÔNG TIN`: may CUS read the active quotation fee catalog?
  The FE no longer calls it; the chi-hộ dedicated columns stay absent for CUS
  until the PM rules.
- Filed this wave: 213–218 (213 = ops wallet 404, 214 = CUS debit 403, 215 =
  dispatch pill/duplicate, 216 = filler copy, 217 = sweep floor, 218 = wallet
  density).

## QA

- Sweep (390/768/1440, 4 roles): 0 overflow, 0 clipped, 0 sub-11px, 0 sub-40px;
  only remaining finding is the CUS debit 403 (now fixed in the FE).
  `qa/2026-09-30_role-sweep_*`.
- Frontend `tsc -b` 0 · vitest scoped sets green (dispatch 362, ops 50, copy-trim
  trees 379) · `pnpm design:lock` 200/201 · `pnpm design:drift` no growth.
- Backend `tsc --noEmit` 0 · card 213 red→green logs in `qa/`.
- **Not run:** full backend suite, `make build`, E2E — no schema/RBAC/shared
  change landed; the backend edit is a read-path guard with its own regression test.

## Decisions

- A dangling `expense_accounting_sources` link (polymorphic, no FK) is debris: a
  LIST read skips it and logs a warning; a read-by-ref still 404s.
- The touch floor is 40px (2026-09-27 ruling: the ceiling IS the floor) — both
  sweeps now read it from the same law `scripts/design-lock.mjs` uses.
- Filler copy is deleted on sight (law §8); messages carrying a decision
  (blockers, permissions, errors, destructive confirmations) stay.
- UI copy is asserted through seams (`data-testid`), never by pinning a sentence.

## Open items

- 28 DRIVER links whose source row exists but whose `trips`/`drivers` join no
  longer resolves (28 of 152 measured) — not deleted, needs a decision on the
  legacy `drivers` table.
- `pnpm check:ui` exits 1 on three pre-existing files
  (AccountingWorkspacePage.css, CustomersPage.css, PhoiPhieuControlPage.css) —
  none touched by this wave.
- `filters/customers/w768/max-two-rows` design-lock fails (3 rows) — pre-existing,
  /customers untouched here.
- `OpsExpenseFormModal.containers.test.tsx` A1 is borderline (≈5.3s vs a 5s
  timeout) — pre-existing flake class card 20260928_185.
