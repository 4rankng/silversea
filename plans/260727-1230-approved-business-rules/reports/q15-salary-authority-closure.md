# Q15 salary authority closure

Status: DONE

## Result

Final salary issue and official posting now use the existing three-stage
maker/checker/approver governance lifecycle.

- Submission creates a pending action and has no salary-period effect.
- Check and approval require distinct actors, mandatory idempotency keys, and
  exact action versions.
- Final approval atomically validates the bound period and operation, applies
  the existing salary-period business service, and records the application
  result.
- Exact replay is stable; payload drift, stale source versions, wrong-period
  decision routes, and idempotency persistence failures leave the source
  unchanged.
- Post-close salary adjustment decisions now bind every public `:period` to the
  action's persisted source period.
- Material salary mutations in the owned route now require idempotency rather
  than accepting an optional key.

## Compatibility decision

No schema or governance enum migration was added. Issue and official posting
reuse the established `SALARY_PERIOD_CLOSE` policy while storing an explicit
`afterSnapshot.operation` of `ISSUE_PAYSLIPS` or `POST_OFFICIAL`. The specialized
adapter requires the action kind, subject, period, and operation to match before
any effect.

The salary page and central governance queue use this operation discriminator
to show truthful labels and route decisions through the corresponding
period-bound salary endpoints.

## QA

- Focused backend public route and service suites: green, 14/14; final
  salary-route rerun green, 6/6.
- Frontend focused suites: initial fixture failure captured; fixed rerun green,
  final 17/17.
- Backend typecheck: green.
- Frontend typecheck: green.
- Root lint: exit 0, 0 errors; 46 warnings belong to the shared concurrent
  worktree and none are in this bounded salary change.
- Production build: green.
- Scoped review and diff check: green.

Artifacts:

- `qa/2026-07-28_q15-salary-authority_backend-test.log`
- `qa/2026-07-28_q15-salary-authority_backend-typecheck.log`
- `qa/2026-07-28_q15-salary-authority_frontend-test.log`
- `qa/2026-07-28_q15-salary-authority_frontend-typecheck.log`
- `qa/2026-07-28_q15-salary-authority_lint.log`
- `qa/2026-07-28_q15-salary-authority_build.log`
- `qa/2026-07-28_q15-salary-authority_diff-check.log`
- `qa/2026-07-28_q15-salary-authority_review.md`

Status: DONE
Summary: Salary issue, official posting, and post-close adjustment decisions are period-bound, versioned, idempotent, and governed through distinct actors with no pre-approval effect.
Concerns/Blockers: None in the bounded salary-authority scope.
