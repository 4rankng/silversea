## Final material configuration review

Status: BLOCKED

The Q15 material-configuration lane is not production-ready. Full evidence and line-specific recommendations are recorded in:

- `qa/2026-07-28_final-material-config_review.md`

### Blocking findings

1. A configured active payroll unit with zero linked active drivers returns `canClose: true`; salary close then posts a zero summary entry and persists a closed period with an empty included-driver set.
2. Governed approval adapters invalidate Redis and mutate process cache before the database approval transaction commits, enabling stale repopulation and rollback-inconsistent cache state.
3. `expense-categories` remains direct CRUD despite being named in the accepted Q15 financial-policy surface. Supplier `types`/`primaryType` updates also bypass the current field-aware governance predicate, with no documented approved exception.
4. Dedicated debit-note template pages still type pending governance actions as applied templates/deletes and show completed-save/completed-delete messages.
5. The focused Q15 backend artifact uses `--test-force-exit`, while teardown is not failure-safe; it does not prove natural exit.

### Verified controls

- Manager has `PRICE_APPROVE`; maker/checker/approver separation is centralized.
- Governed tested resources use request idempotency and current source versions where an existing row is mutated.
- Road/fuel/company singleton coverage proves replay, stale/missing version rejection, no pre-effect, approval, RBAC, and nullable company subject handling.
- Driver `businessUnitIds` persist through link rows and public assignment is ADMIN-only.
- Current static checks pass: backend typecheck, frontend typecheck, lint with 0 errors (44 warnings), and `git diff --check`.

### Required closure work

1. Enforce a nonempty configured payroll cohort at settings approval and period close.
2. move cache effects after commit and add rollback/concurrent-read proof.
3. Govern expense categories and explicitly resolve supplier taxonomy classification.
4. Make debit-template UI/API types truthful for pending actions.
5. Rerun focused tests with failure-safe teardown and no forced exit.
6. Replace the narrow Q15 closure statement with a complete surface matrix.

Status: DONE_WITH_CONCERNS
Summary: Review completed and Q15 closure rejected pending the listed financial, cache, governance-scope, frontend-contract, and test-exit fixes.
Concerns/Blockers: See `qa/2026-07-28_final-material-config_review.md`.
