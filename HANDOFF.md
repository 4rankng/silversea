# HANDOFF — 2026-10-19 — card 191026160000: money format + chốt-debit fixes + duyệt tạm/hoàn ứng (chiphi2-b)

Controller worktree `/Users/dev/.paseo/worktrees/1njkloyy/fix-chiphi2-b`, branch
`fix-chiphi2-b` (off main `eed0b2f3`). Updated 2026-10-19. See
`testplan/2026-10-19-card-191026160000-chiphi2-b.md` for the full case table,
review resolution and dev-DB residue list.

**§1 Money format** — Timesheet lương lines + 4 config money inputs
(LiftPricing, WeightTiers, CapTable, AncillaryRevenue) moved to
`formatMoney` / `NumberField grouped(signed)`; API payload shapes unchanged.
`formatMoney` already existed (`frontend/src/lib/format.ts`) — the sweep only
covered the missing surfaces.

**§2 Chốt-debit** — board defaults to the CURRENT MONTH (8864-row unbounded
load froze select-all — the QA repro; captured pre-fix), select-all guard
>2000; selected row paints accent-soft + ✓ tick in Ngày; two-tier header
rowSpan cells bottom-aligned; "Chọn Debit" dialog groups the selection BY NGÀY
with per-date ticks (untick excludes lots from count/sum/shipmentIds; đợt
period follows ticked dates); settlement success KEEPS the selection; export
key root cause FIXED (raw id-join key >100 chars → 400; now FNV-1a selection
hash inside `createDebitNoteBatch`, used by both /accounting/chot-debit and
/shipments-debit) + 200-lot union cap surfaced on the button.

**§3 Duyệt tạm/hoàn ứng** — (3a) PHÊ DUYỆT TẠM ỨNG verified working at HEAD
(rung 3; QA staging build predates 3b252b4b — no code change); (3b) NEW
`POST /api/advance-settlements/:id/check` (ADMIN/ACCOUNTANT) stamps
checked_by/checked_at + version bump; creation no longer stamps
checkedBy=submitter (Option B's tick stays approved_by; deadlock-order pin
updated); "DUYỆT PHIẾU HOÀN ỨNG" row action on /advances tab Phiếu hoàn ứng;
(3c) Ops chi → hoàn tạm ứng: trace proved ĐNTT counts only KT-CONFIRMED ops
expenses; "Chi phí Ops" tab now shows the duyệt state + per-row Duyệt wired
to the SAME `/expense-accounting/confirm` phơi phiếu uses.

Gates: lint 0 · be tsc 0 · fe tsc -b 0 · fe vitest 215/215 · be scoped 41/41
(advance-settlement-check NEW) · make build OK. UI rung 3 before/after:
`qa/2026-10-19_chiphi2-b_repro/` + `qa/2026-10-19_chiphi2-b_after/` (10 shots +
dom-facts.json + exported xlsx). Drivers:
`testplan/qa/scripts/2026-10-19_chiphi2b-*.mjs`; settlement seed/cleanup:
`backend/scripts/seed-chiphi2b-settlement.ts`.

Not covered: staging drive (local-only); mobile ≤640px debit board not driven;
invoice-required confirm flow beyond the surfaced refusal; known edges F3/F6/F9
in the testplan.
