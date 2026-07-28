# Q15/Q18 fuel and settlement governance closure

Status: DONE

## Delivered

- Advance-request rejection now follows maker → checker → approver governance.
- Approved advance settlements support governed expense correction and full reversal without rewriting the approved source.
- Initial fuel-invoice approval now follows maker → checker → approver; AP authority starts only after final approval.
- Fuel correction/reversal remains immutable and effective-view based.
- Admin UI requires typed decision reasons and exposes truthful queued correction/reversal actions.
- `REVERSED` settlement status is rendered and filterable.

## Verification

- Q23 approved financial route idempotency: 6/6 sequential.
- Forwarder settlement workflow: 22/22 sequential.
- Q23 durable command boundary: 4/4.
- Q06 fuel invoice routes: 7/7.
- Fuel AP reconciliation: 19/19.
- Financial governance focused UI: 13/13.
- Full frontend suite observed in this scope: 383/383.
- Backend typecheck: green.
- Frontend typecheck: green.
- Diff review: no release-blocking finding.

QA evidence is stored under `qa/2026-07-28_q15-*`, `qa/2026-07-28_q18-*`, and `qa/2026-07-28_q15-q18_*`.
