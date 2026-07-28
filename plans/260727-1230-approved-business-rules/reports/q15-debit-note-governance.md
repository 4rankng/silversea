# Q15 debit-note issue governance

## Scope

- Backend-only debit-note governance adoption on top of the shared Q15 action engine.
- Owned surface:
  - `backend/src/routes/financial/billing-documents.routes.ts`
  - `backend/src/services/billing-document-governance.service.ts`
  - `backend/src/services/billingDocument.service.ts`
  - `backend/src/services/governance-policy.ts`
  - `backend/src/tests/q15-debit-note-governance.test.ts`
  - `shared/src/schemas/index.ts`
  - `shared/src/index.ts`

## Implemented

- Added `DEBIT_NOTE_ISSUE` governance policy with the same maker/checker/approver split as other financial actions.
- Added `billingDocumentIssueRequestSchema` and exported it through `@tingting/shared`.
- Added governed debit-note issue request handling:
  - request requires `reason` + `expectedVersion`;
  - only CUSTOMER debit notes in `DRAFT` qualify;
  - request captures source/version snapshot and rejects stale drafts;
  - one active issue request per document version is enforced;
  - request is idempotent with payload replay/conflict semantics.
- Reused the generic governance inbox/check/approve/reject/cancel routes:
  - `POST /api/governance-actions/:id/check`
  - `POST /api/governance-actions/:id/approve`
  - `POST /api/governance-actions/:id/reject`
- Final approval now atomically:
  - revalidates current draft version;
  - revalidates source freshness under trip/expense locks;
  - revalidates debit-note period authority;
  - transitions the note `DRAFT -> SENT`;
  - posts the authoritative AR delta exactly once.
- Draft save/update/delete no longer post or reverse AR deltas before approval.
- Wrapped billing-document adjustment request with `runIdempotent`.

## Behavior proof

- Draft save/update keep `GBN:<documentId>` ledger rows at zero until approval.
- Maker self-check is denied.
- Checker self-approve is denied.
- Reject requires and stores an explicit reason.
- Source drift after request but before approval fails closed and leaves:
  - governance action at `PENDING_APPROVAL`;
  - document at `DRAFT`;
  - AR unchanged.
- Approval replay returns the stored result without a duplicate ledger post.
- Same idempotency key with changed issue-request payload returns 409.

## QA

- `qa/2026-07-27_q15-debit-note-governance_shared-build.log`
- `qa/2026-07-27_q15-debit-note-governance_backend-test.log` — initial failure exposed runtime shared export drift.
- `qa/2026-07-27_q15-debit-note-governance_backend-test.rerun.log` — 4/4 pass.
- `qa/2026-07-27_q15-debit-note-governance_backend-test.final.log` — 4/4 pass after final test cleanup.
- `qa/2026-07-27_q15-debit-note-governance_backend-typecheck.log` — initial test typing failure.
- `qa/2026-07-27_q15-debit-note-governance_backend-typecheck.rerun.log` — pass.
- `qa/2026-07-27_q15-debit-note-governance_lint.log`
- `qa/2026-07-27_q15-debit-note-governance_lint.rerun.log`

## Notes

- `pnpm lint` remains green on errors but still reports 21 pre-existing warnings outside this slice.
- I did not run the full backend suite or broader build/e2e gates in this subtask; root should cover integrated QA after merging parallel slices.
