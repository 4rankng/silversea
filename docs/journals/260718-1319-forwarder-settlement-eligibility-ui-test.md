---
date: 2026-07-18
type: journal
status: verified
area: forwarder-settlement
---

# Forwarder settlement eligibility UI test runbook

## Context

The bug was in the settlement form, not the approval backend. `frontend/src/pages/ForwarderSettlementCreatePage.tsx` was rendering the whole approved-request set, while `backend/src/routes/forwarder.ts` now asks `listAdvanceRequests(..., excludeLinkedToActiveSettlement: true)` and `backend/src/services/advance.service.ts` excludes any request linked to a non-REJECTED settlement. Rejected links stay reusable. The actual concurrency guard is still server-side in settlement creation and advisory locking, so the UI fix is about not offering already-claimed advances twice.

## What Happened

I tested the fix locally at `http://localhost:7173` with Computer Use. Admin login `admin/admin123` worked, but the browser showed the breached-password warning for `admin123`; I closed it and stayed local. The forwarder create page is FORWARDER-only, so admin had to log out. The populated local account used for the test was `quan/admin123` for Nguyễn Sĩ Quân.

The forwarder sidebar showed 6 settlement records in history: 1 pending, 2 accountant-checked, 3 approved. The approved settlement `PT-2606-0001` contained `TU-0001` 10m, `TU-0002` 20m, and `TU-0003` 10m. The `Tạm ứng` history showed 23 approved requests total. On `Tạo phiếu thanh toán`, the title correctly said `Chọn tạm ứng chưa quyết toán`, and only 6 requests were selectable instead of 23. The concrete proof was that approved request `26,518,400 VNĐ` dated `06/07` was absent after being claimed, while `24,386,000 VNĐ` dated `06/07` stayed visible because it was still eligible.

## Reflection

This is one of those bugs that feels stupidly avoidable in hindsight: the request status stays `APPROVED` after settlement, so filtering only by status reintroduced already-claimed money back into the UI. The backend was already defending correctness; the UI was the part lying to the user. Staging did not help verify anything because `quan/admin123`, `giaonhan/admin123`, and `admin/admin123` were rejected at `https://vantai.tingting.vip`, so I am not pretending that environment passed.

## Decisions Made

| Decision | Rationale | Impact |
|----------|-----------|--------|
| Use the opt-in `eligibleForSettlement=true` filter | Eligibility belongs to the server query, not a client-derived approximation | The create form receives only valid candidates |
| Keep rejected settlement links reusable | Rejection reopens the advance under the documented business rule | Rejected requests can be submitted again |
| Keep validation and advisory locking authoritative | UI filtering cannot prevent races or crafted requests | Duplicate claims remain blocked server-side |
| Run the UI check without submitting | Existing records already provide a deterministic comparison | No business data is changed during verification |

## Repeatable UI Test Runbook

### Prerequisites

- Run the app locally and open `http://localhost:7173`.
- Invoke the Computer Use skill, target Google Chrome, and request a fresh app state before using any accessibility element index.
- Use `admin/admin123` first only if you need to confirm the admin side; log out before testing the forwarder flow.
- Use `quan/admin123` for the populated forwarder account on this database.
- If Chrome shows the breached-password warning for `admin123`, close it and continue on localhost only.

### Exact steps

1. Log in as `quan/admin123`.
2. Open sidebar `Phiếu thanh toán`.
3. Inspect history and confirm the count/state mix.
4. Click `Thêm phiếu`.
5. Verify the page title is `Chọn tạm ứng chưa quyết toán`.
6. Compare the selectable list against `Tạm ứng` history.
7. Confirm only eligible advances are selectable.
8. Do not submit the form; no settlement should be created.

After every navigation or click, read the Chrome app state again before choosing the next element. Accessibility indices are regenerated and stale indices can activate the wrong tab or control.

### Expected evidence

- Settlement history shows 6 records total: 1 pending, 2 accountant-checked, 3 approved.
- `Tạm ứng` history shows 23 approved requests total.
- The create form shows 6 selectable requests, not 23.
- Claimed approved requests such as `26,518,400 VNĐ` dated `06/07` are hidden.
- Still-eligible approved requests such as `24,386,000 VNĐ` dated `06/07` remain visible.

### Pass / fail

- Pass: the create form only lists approved advances not already claimed, and no data is mutated.
- Fail: any already-claimed approved advance reappears, or staging credentials are treated as proof even though login failed.

### Troubleshooting

- If the forwarder page redirects, you are still logged in as the wrong role.
- If the counts disagree, refresh after logging in with the forwarder account, then repeat the history-versus-create comparison.
- If staging rejects all credentials, stop and do not infer a pass from the empty response.
- Do not log out a working staging session until a valid forwarder credential for that environment is confirmed separately.

## Code and Test References

- Eligibility query: `backend/src/services/advance.service.ts`
- Forwarder API flag: `backend/src/routes/forwarder.ts`
- Create-page query and labels: `frontend/src/pages/ForwarderSettlementCreatePage.tsx`
- Client and query hooks: `frontend/src/api/forwarderClient.ts`, `frontend/src/hooks/useForwarderQueries.ts`
- Regression coverage: `backend/src/tests/forwarder-settlement-workflow.test.ts`
- Business workflow: `docs/flows/13-GIAO_NHAN_VA_TAM_UNG.md`

## Next Steps

- Keep the regression test `settlement form only lists approved advances that are not already claimed` in the backend suite; it passed 11/11 focused checks.
- Preserve the backend and frontend build checks alongside this UI runbook.
- If someone wants staging validation later, they need a working account on `vantai.tingting.vip`; the three known credentials were dead during this session.
