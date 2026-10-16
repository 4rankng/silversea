# Driver cost UX (cost-doc wave B) — frontend panel redesign

- Controller: opencode agent "cost-doc wave B: driver cost UX (lái xe)", worktree
  `/Users/dev/.paseo/worktrees/1njkloyy/dreamy-eel`, branch `feat/driver-cost-ux`
  @ `111bc2f7`, pushed to origin. Last updated: 2026-10-15 ~08:45 +0700.
  (Previous handoff in this file was the completed FB-086 re-file verdict from
  the `melodic-sloth` worktree — its deliverable lives at
  `testplan/cycles/2026-10/2026-10-14-fb086-refile-stale-verdict.md`; nothing
  of it is pending here.)
- Goal: accountant-doc driver cost UX — end-of-lot panel restructure, FRONTEND
  driver cost components only; shared `LotCostForm` base for waves C/D.
- Status: **wave slice 1 COMMITTED + PUSHED.** Delivered: two record tables
  (Chi phí lô hàng + Tiền đường, per-table add), người chi column removed,
  số hóa đơn/ngày hóa đơn fields removed, "Chứng từ kèm theo" Hóa đơn/Phiếu thu
  segmented (catalog-classified fees locked, per cards 20260928_163/164),
  receipt capture block in the shared base, road entry slimmed to
  picker + amount, shared base `components/costs/LotCostForm.tsx`.
  NOTE: an external consolidation pass created the single commit `111bc2f7`
  ("feat: wave deliverables — dreamy-eel") from this worktree at 08:22 +0700
  and pushed it; per §4 append-only it was not split into per-feature commits.
- NOT yet implemented (remaining waves of this task): (a) receipt photo
  REQUIRED gating for lot rows (capture UI exists; the save button does not yet
  block without a photo for non-ROAD_REPAIR fees); (b) Tiền đường SYSTEM-AUTO
  read-only rows (Tiền đường = trip total_road_allowance; Nâng/Hạ Lạch Huyện =
  `LIFT_DROP_ALLOWANCE` fee norm); (c) continuous entry (staged rows + single
  save). Regression cases DCUX-03/04/05 in
  `testplan/2026-10-14-driver-cost-ux-redesign.md` cover them.
- Cross-wave dependency (reported, not fixable frontend-only): backend
  `insertDriverIncidentalCostTx` (backend/src/services/driver-fulfillment.service.ts
  ~line 354) still rejects catalog-INVOICED fees without an invoice number
  ("Phí có hóa đơn phải kèm số hóa đơn."). The redesign moves invoice-number
  capture to accountant reconciliation; until a backend wave lifts that gate,
  an invoiced-class driver save surfaces the server's own 400. No client-side
  fabrication was added.
- Files owned: `frontend/src/components/costs/LotCostForm.{tsx,css}`,
  `frontend/src/components/trip/ShipmentCostEntryForm.{tsx,css,test.tsx}`,
  `frontend/src/features/driver/useDriverExpenseEntry.ts`,
  `testplan/2026-10-14-driver-cost-ux-redesign.md`.
- Unrelated/concurrent: the audit-recovery consolidation commit itself;
  `qa/` artifacts are git-ignored as designed.
- Gates: fe `tsc -b` 0 errors; focused suite 26/26; affected batch green
  (trip/driver/driver-pages/styles; 4 timeout casualties of my own job
  concurrency re-run green); `pnpm build` OK; `pnpm check:ui` PASS; root
  `pnpm lint` 0 errors. Full fe suite 4778/4788 — the 10 failures are all in
  files byte-identical to base `b47fffc5` (load-induced timeouts + 3 quiet-rerun
  stragglers in RoleWorkInbox/OpsExpenseCatalogRecovery/TripListPage sort +
  dev-port-contract scanning `testplan/qa/scripts`, untouched by this diff).
  PRE-EXISTING at base, not introduced here: `pnpm design:drift` baseline stale
  vs recent merges (identical growth with the diff stashed); `pnpm size-check`
  script points at the retired `structure.guard.test.ts` (e54504bf).
- QA artifacts: `qa/2026-10-15_driver-cost-ux_*.log` (tsc, cost-panel suite,
  affected batch + concurrency rerun, build, full suite, check:ui via transcript,
  design-drift, root lint).
- Blockers/next: owner routes DCUX-03/04/05 (photo-required gate, system-auto
  rows, continuous entry) and the backend invoice-gate wave; UI drive at
  375/1280 as driver still pending for the delivered slice (needs
  `VITE_API_PROXY_TARGET` per the preserved hazard — a vite without it proxies
  to a stray :3002 stack).

---

# /config/customers phone-band UI polish — 2026-10-16

- Controller: Claude (Claude Code session, this checkout). Last updated:
  2026-10-16 ~09:55 +0700. Report:
  `plans/reports/ui-261016-0958-config-customers-phone-polish.md`.
- Goal: owner-reported "UI and style sucks" on the `/config/customers`
  phone band. Delivered: rows adopt the shared record-card surface from
  `styles/record-table.css` (page-local transparent hairline strips retired);
  "Thông tin chi tiết" disclosure anchored with a hairline at 12px control
  size; details facts ride one-line flex fact rows in a
  `repeat(auto-fit, minmax(260px, 1fr))` grid (kills the 159px-cell email
  confetti). Scope: `customer-config-density.css`,
  `config-catalog-tabular.styles.test.ts`, new driver
  `testplan/qa/scripts/ui-cfg-customers-phone-20261016.mjs`. Nothing above
  the ≤1100px container band changed.
- Gates: full fe suite 4886/4886 green; `tsc -b` 0 errors; root lint 0
  errors; `check:ui`/`check:brand` PASS; `design:drift` RED but PRE-EXISTING
  at base (growth lives in another lane's WIP `ShipmentContainersPage.css` /
  `ShipmentDebitPage.css`; wave-B handoff above records the same baseline
  staleness with its diff stashed). Baseline not `--update`d over foreign
  WIP. Note: no pre-commit hook is wired in this checkout (`core.hooksPath`
  unset; `scripts/githooks/` holds only `post-commit`) — the documented
  pre-commit typecheck/drift gates are on-demand here.
- Landed: **trunk `5d7a3aab`** after independent review (DONE_WITH_CONCERNS,
  sound, zero critical/high/medium; low notes applied — driver try/finally
  hardening re-smoke-tested, negative-pin brittleness informational). Only
  this task's 3 files staged; foreign WIP untouched.
- Unrelated/concurrent preserved: the `features/shipments/create/*`,
  `ShipmentContainersPage.css`, `ShipmentDebitPage.*`,
  `clerk/ShipmentCreatePage.test.tsx` WIP set in this checkout belongs to
  another lane — do not stage or revert it.
- Evidence: `qa/2026-10-16_cfg-customers-phone-ui/` (before/after 390/768
  captures + computed probes; ADMIN account, local dev stack).
