# Q18/Q22/Q23 integration review

**Status:** FAIL — production-readiness blockers found  
**Review mode:** read-only adversarial review of the uncommitted integration  
**Detailed evidence:** `qa/2026-07-28_q18-q22-q23-integration_review.md`

## Blocking findings

1. **Critical — mandatory audit is post-commit.** `runIdempotent()` commits before `auditLogMiddleware` persists from `res.end`. Audit failure changes the response to 500 but cannot roll back the business effect. The focused test explicitly proves the effect ran (`createCalls === 1`) while the response failed.
2. **High — replay is not actor-scoped.** The keyspace and lookup use only endpoint plus key; `createdBy` is stored but never compared. Stored snapshots can be replayed without rerunning row-scope authorization.
3. **High — material route coverage is incomplete.** Upload, OCR, and company-expense photo writes are absent from `MATERIAL_WRITE_RULES`, so their audit failures remain best-effort.
4. **High — multipart retries use a new key.** The frontend declines stable retry-key tracking for `FormData`; actual upload/OCR/expense-photo callers therefore cannot satisfy flaky-network replay.
5. **High — expense-photo object and database state can diverge.** Upload has no compensation for post-upload DB failure; delete swallows object-deletion failure and replay never retries it.
6. **High — approved expense correction uses trip departure date.** When no prior receivable row exists, settlement correction derives payment due dates from `departureDate` instead of the expense event date.
7. **Medium — credit-override reads amplify queries.** The list issues up to 200 decision queries after the base query, and credit checks load all customer ledger rows into application memory.
8. **Medium — adjustment authority depends on Vietnamese note capitalization.** Current producers emit lowercase `phí chi hộ`, while the classifier recognizes uppercase `Phí chi hộ`, causing fallback to `OTHER`.

## Verification performed

- `cd backend && npx tsc --noEmit` — exit 0.
- `cd frontend && npx tsc -b` — exit 0.
- `git diff --check` — exit 0.
- Runtime tests were not run because the shared database lane was occupied, per controller coordination.

## Plan recommendation

- Q18: do not close the combined item until mandatory audit durability is atomic with governed effects.
- Q22: keep open until expense-date authority and typed adjustment provenance are fixed and tested.
- Q23: keep blocked until atomic audit, actor-scoped replay, exhaustive route classification, stable multipart keys, and durable object cleanup are proved.
- After fixes, rerun the full normal/invalid/concurrency/RBAC matrix against a frozen final diff and save all outputs under `qa/`.

Status: DONE_WITH_CONCERNS
Summary: Static integration review found one critical and multiple high-priority production blockers; the current Q18/Q22/Q23 integration must not be marked PASS.
Concerns/Blockers: Runtime DB tests were intentionally deferred because another lane owned the shared database.
