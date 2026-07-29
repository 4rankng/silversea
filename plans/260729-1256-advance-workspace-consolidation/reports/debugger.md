# Debugger Summary

- Fresh verification is green: `cd frontend && npx tsc -b` exited 0; focused frontend tests including workspace, route, deep-link, layout, and governance page coverage passed `93/93` files and `445/445` tests on 2026-07-29 13:20-13:21 SGT.
- No blocker found in legacy redirect or focus-param cleanup. Evidence: `frontend/src/App.tsx:17-25`, `frontend/src/hooks/useFocusDeepLink.ts:5-29`, `frontend/src/pages/AdvanceWorkspacePage.tsx:15-23`.
- No blocker found in office-role visibility. Evidence: nav exposes the workspace to `ADMIN`/`MANAGER`/`ACCOUNTANT` and `/advances` route guard still admits those roles: `frontend/src/components/Layout.tsx:51-77`, `frontend/src/App.tsx:154-160`, `:203-206`.
- Confirmed blocker remains in request-governance proposal correctness:
  - request page only suppresses proposal buttons via a capped global queue scan, `useGovernanceActions({ limit: 100 })`, then `findActiveAdvanceGovernanceAction(...)`: `frontend/src/pages/AdminAdvancesPage.tsx:54-65`, `:174-205`, `:284-320`, `:349`, `:496-512`.
  - backend uniqueness still permits one active approve action and one active reject action for the same request/version because uniqueness includes `actionKind`: `backend/src/db/schema.ts:996-1001`.
  - POST transport generates a fresh `Idempotency-Key` per request unless the caller pins one: `frontend/src/lib/api/client.ts:44-52`, `:118-119`.
  - Result: if the UI misses an existing active action because of the 100-row cap or refetch lag, opposite proposals can coexist for one request/version.
- Secondary regression gap: settlement `Đã hoàn tác` count is still not initialized. `REVERSED` tab exists, but `counts` omits it and `tabCounts` still reads it: `frontend/src/pages/AdminAdvanceSettlementsPage.tsx:36-41`, `:371-383`, `:407-414`, `:461-468`.
- Latent deep-link caveat: governance `filter` query param is read only on first mount and not synchronized afterward: `frontend/src/pages/GovernanceActionsPage.tsx:161-166`, `:187-189`.

Status: DONE_WITH_CONCERNS
Summary: earlier type/test failures are resolved, but the current branch still has one confirmed workflow blocker in contradictory advance-request governance proposals and one settlement-count regression gap.
Concerns/Blockers: backend/client combination does not enforce a single active proposal per advance request/version across approve vs reject intents.
