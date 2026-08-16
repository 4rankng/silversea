# Dispatcher Resource Catalogs — rbac-breadth + pagination-contract lessons

Date: 2026-08-16 | Commit: a40aeed (+ H1 fix in 655f5b4) | Plan: 260816-1015-dispatcher-resource-catalogs

## What shipped

DISPATCHER (dieuvan) resource-catalog pages: `/fleet/vehicles`, `/fleet/drivers`,
`/suppliers` (dispatcher lookup variant), read-only. One Casbin line
(`p, DISPATCHER, config, read`) opens the reads; mutations remain 403. Verified by
tester subagent (80/80) and adversarial code-reviewer (approve-with-fixes; H1/M1/L2/L3
fixed post-review, 47/47 after).

## Lessons

1. **`casbinAuthz('config')` is an /api catch-all, not a catalog router.** Granting a
   role `config read` opens EVERY GET mounted under it — customers (credit limits),
   cap-table, pricing, salary-periods — not just the three catalogs the page needs.
   The one-line grant was the right KISS call here (dispatchers are trusted internal
   staff; breadth accepted by user 2026-08-16), but any future grant to a less-trusted
   role must enumerate the mounted routes first. `app.use('/api', ..., casbinAuthz('config'), configRoutes)`
   in backend/src/index.ts:218 is the breadth anchor.

2. **Backend pagination default silently breaks page math.** `getSuppliers` sent no
   `limit`; `parsePagination` defaults to 50 while the UI paginates by 10 → dead pages
   and 50-row "page 1". `getCustomers` already sent `limit: '10'`. Contract: any
   paginated client must pin `limit` to its pageSize. This bug existed on the admin
   page and was replicated into the new view until review caught it.

3. **`/api/catalogs/bootstrap` (index.ts:215) has authMiddleware but NO casbin gate**
   and returns full customer/driver rows (incl. baseSalary, socialInsurance) to any
   authenticated non-portal role. Pre-existing, separate ticket recommended.

4. **Pre-existing dirty trees bite at commit time.** Verification subagents saw
   unrelated dispatch-grid/overlay changes in the diff and correctly flagged scope
   mixing (M2). Feature-only staging kept main clean — but the working tree had
   already been committed by an outside process mid-session; re-check
   `git log` before staging from a stale mental model.

## Open follow-ups

- Ticket: gate or trim `/api/catalogs/bootstrap`.
- `titleForPath('/suppliers')` says "Nhà cung cấp" vs nav "Nhà thầu phụ" (pre-existing
  catalog title divergence).
- Theo dõi Lộ trình (`/dispatch-live-tracking`) still unbuilt; dead nav item was
  removed this session; regression doc 15-navigation-menu-by-role.md still lists it.
