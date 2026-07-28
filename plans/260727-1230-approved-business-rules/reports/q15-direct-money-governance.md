## Phase Implementation Report

### Executed Phase
- Phase: `q15-direct-money-governance`
- Plan: `plans/260727-1230-approved-business-rules/`
- Status: `completed`

### Files Modified
- `backend/src/routes/financial/payments.routes.ts` `+278/-92`
- `backend/src/routes/financial/penalties.routes.ts` `+64/-56`
- `backend/src/services/governance-policy.ts` `+151/-0`
- `backend/src/services/governance-transition.service.ts` `+89/-7`
- `backend/src/services/payment-allocation.service.ts` `+159/-0`
- `backend/src/services/financial.service.ts` `+569/-0`
- `backend/src/services/commission.service.ts` `+113/-1`
- `backend/src/tests/q15-direct-money-governance.test.ts` `+684/-0`
- `backend/src/tests/q03-payment-receipts-route.test.ts` `+59/-49`

### Tasks Completed
- [x] Added governance policy entries for `PAYMENT_RECEIPT`, `VENDOR_PAYMENT`, `CARRIER_PAYMENT`, `DRIVER_PAYOUT`, `COMMISSION`, `PENALTY_CREATE`, `PENALTY_CANCEL`
- [x] Added request/apply helpers so direct-money commands create `governance_actions` first and only post financial effects on approval
- [x] Routed `/api/payments/receive`, vendor/carrier payments, commissions, driver payouts, penalty create/cancel through governed submission + idempotent replay
- [x] Added direct-money approval adapter dispatch in `governance-transition.service.ts`
- [x] Added focused Q15 backend coverage for submit/check/approve/reject/replay/stale behavior
- [x] Migrated `q03-payment-receipts-route.test.ts` to the new governed `/payments/receive` contract

### Tests Status
- Type check: `pass` — `qa/2026-07-27_q15-direct-money-governance_backend-typecheck.log`
- Unit tests: `pass` — `qa/2026-07-27_q15-direct-money-governance_backend-test.log`
- Contract regression: `pass` — `qa/2026-07-27_q03-payment-receipts-route_backend-test.log`
- Integration tests: `not run in this lane`

### Issues Encountered
- Initial focused test used multiple pending actions on the same supplier/driver version anchor; later approvals correctly went stale. Fixed by splitting the all-seven scenario across distinct entities so the acceptance case proves one successful approval per command.
- Test cleanup initially missed `idempotency_keys` and notification rows referencing test actors; fixed so the focused suite exits cleanly and no longer poisons later backend runs.

### Next Steps
- Root can fold this slice into the broader backend suite or staging verification lane.
- If broader Q15/Q23 gates are rerun, use the saved artifacts above as the focused evidence for the direct-money governed contract.
