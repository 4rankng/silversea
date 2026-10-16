# FB-100 F-W1-1 — phiếu hoàn ứng DRAFT gate: ruling request for the owner (2026-10-16)

Status: **DOCUMENTED, not implemented.** Read-first lane per owner instruction
2026-10-16 ("if genuinely undecidable after reading the spec, document the
ambiguity + 2 options + recommendation — do not guess business rules").
Supersedes the open question in `testplan/2026-10-16-w1-ketoan-verify.md`
F-W1-1; no code touched for this item.

## The exact ambiguity

WHO performs "ghi nhận phiếu" for hoàn ứng, and must a tick-gated recording
step exist for kế toán — or does the phiếu apply at Ops submission with the
actor's own confirmation tick? The tick block shipped by FB-100
(commit `4ee08710`) is **unreachable in every live flow**, and the two spec
anchors conflict on how to make it reachable.

## Evidence chain (all read this lane)

1. **What is dead, exactly.** `frontend/src/pages/SettlementPrintPage.tsx`
   `settlementActionPermissions`: `canEditDraft = canManageSettlements
   && status === 'DRAFT'` gates the "Xác nhận hoàn ứng" tick + "Ghi nhận
   phiếu" block (lines ~574-592). Backend
   `backend/src/services/advance-settlement.service.ts`:
   `createAdvanceSettlement` inserts `status: 'RECORDED'` (line ~95) and no
   writer anywhere births `DRAFT` (staging: 0 DRAFT / 2 RECORDED / 1 REVERSED).
   `updateAdvanceSettlement` (the block's PUT target,
   `PUT /api/advance-settlements/:id`, ADMIN/ACCOUNTANT-gated) throws 409
   unless `status === 'DRAFT'` ("Phiếu đã ghi nhận không thể sửa danh sách
   trực tiếp…"). So the entire record path is DRAFT-only by design while
   creation is terminal — the W1 finding is confirmed.
2. **How it got here (history).** Pre-2026-09-15: create birthed `APPROVED`
   (a pre-record state), the FE gate was `status === 'APPROVED'`, and the
   record step was live. Commit `92d400c9` (2026-09-15, "streamline advance
   request and settlement statuses, removing PENDING state") renamed the birth
   state to `RECORDED` and the gates to `DRAFT` — leaving the record machinery
   (route + form + guard) intact but with no source state. The rename severed
   the step; nothing deleted it.
3. **Standing code rulings favoring applies-at-creation.**
   `advance-settlement.service.ts` (2026-09-10 comment): "phê duyệt removed —
   the settlement applies at creation with the forwarder … as the approver";
   `applyNewSettlementEffects` posts the `OPS_SETTLEMENT` ledger entry AT
   CREATE and calls `propagateRecordedExpenses`.
4. **PRD.** `docs/prd/OpsVanHanh.md` §9.1: "Không có gửi duyệt, duyệt cả
   phiếu hay từ chối của người thứ hai" and §9.2: "Đây là thao tác trực tiếp,
   không tạo người duyệt, cấp duyệt, trạng thái chờ duyệt…" — for the
   reconciliation domain. BUT the same product accepted CPB-03's shipped
   maker-checker for TẠM ỨNG (OPS requests born PENDING, kế toán approves via
   `POST /api/financial/advance-requests/:id/approve`), so the PRD clause
   cannot be read as a blanket ban on approvals in the advances family.
5. **The cards demand a tick but never name the ticker.**
   Card 141026230770 (`testplan/2026-10-16-card141026230770-tam-ung-hoan-ung.md`):
   "tick 'xác nhận hoàn ứng' — bắt buộc trước khi ghi nhận phiếu".
   CPB-04 (`testplan/2026-10-14-cost-permissions-bugs.md`): "the record form
   requires a 'chốt xác nhận hoàn ứng' checkbox" — its parenthetical locator
   "(SettlementPrintPage 'Ghi nhận phiếu')" predates the discovery that the
   block is DRAFT-dead. The LIVE button literally named "Ghi nhận phiếu thanh
   toán" is the Ops submit on
   `frontend/src/pages/ForwarderSettlementCreatePage.tsx` (~line 478) — the
   surface the original reporter (hoapt 14/10) could actually see, and the one
   FB-100 did NOT touch.

## The two options

**Option A — maker-checker phiếu (kế toán records).**
`createAdvanceSettlement` births `DRAFT` ('Chưa hoàn tất'); the existing
SettlementPrintPage tick+record block becomes the live DRAFT→RECORDED step
(stamping checked_by/checked_at = kế toán). Required ripple: MOVE
`applyNewSettlementEffects` (OPS_SETTLEMENT ledger post +
`propagateRecordedExpenses` + adjustment approvals) from create to the record
step, decide the status policy of every `notInArray(status, ['VOIDED',
'REVERSED'])` consumer (advance-consumption, forwarder balances,
settlement-validation, seed) for DRAFT phiếu, add a cancel/void path for
wrong DRAFT submissions (today a wrong phiếu is reversed from RECORDED), and
update the W1/FB-100 pins. Cost: significant; reopens the 2026-09-10
"phê duyệt removed" ruling; changes when money posts for EVERY phiếu.
Satisfies: card + CPB-04 literally; symmetric with CPB-03's tạm ứng gate.

**Option B — applies at creation; the tick is the submitter's own
confirmation.** Keep birth `RECORDED` and ledger-at-create untouched. Add the
mandatory "Xác nhận hoàn ứng" tick to the LIVE Ops submit
(ForwarderSettlementCreatePage; submit disabled until ticked, mirroring the
page's existing disabled-until-ready pattern), and stamp
`checked_by/checked_at` at CREATE with the forwarder as the confirming actor.
Then remove the dead SettlementPrintPage DRAFT block (and optionally the now
orphaned PUT route) per the PRD's no-second-person-approval law — this is W1
finding's option (b). Cost: small; FB-100's dead block is deleted rather than
revived; `checked_by` semantics become "Ops tự xác nhận", not "kế toán xác
nhận" (differs from FB-100's committed note, which was itself never reachable).
Satisfies: card + CPB-04 literally (tick mandatory before the live
"Ghi nhận phiếu" action), PRD §9.1/§9.2, and both standing code rulings.

## Recommendation

**Option B.** It satisfies every spec anchor without changing money timing or
reopening a closed ruling; Option A is a workflow redesign of a money path
that one older PRD clause appears to forbid and one newer shipped card
(CPB-03) appears to encourage — exactly the kind of business call this lane
must not guess. If the owner picks A, accept the ripple list above as the
implementation scope.

## What this lane did instead (no guess)

- Verified the unreachability claim end-to-end (code + history + staging
  census quoted above).
- Left all FB-100 surfaces byte-identical; the W1 verify record stands.
- This document + HANDOFF.md pointer are the deliverable for ITEM 3.
