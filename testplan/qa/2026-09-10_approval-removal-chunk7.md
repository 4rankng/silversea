# Regression spec — `18f4a2dd` Chunk 7: governance core teardown + queue rewiring + legacy sweep

> **Historical cycle — superseded 2026-09-17:** keep this record for its dated decisions/evidence only. Retained approval exceptions, maker/checker chains (including automatic chains), pending queues and approve/reject instructions in this old cycle are not current product requirements. Run [NO-APP-01..23](../2026-09-17-no-approval-workflows.md) and current role/flow cases instead. Historical PASS does not verify the new criteria.

> **DRAFT — awaiting pm sign-off before qa runs.**
> Shared header (Environment / Accounts / Verification protocol / Evidence bundle / Pass criteria / QA gates / Anti-lying / Not-covered) lives in `testplan/qa/_TEMPLATE.md`; do not duplicate here.

**Ticket:** 18f4a2dd (Remove all phê duyệt flows)
**Chunk:** 7 — Governance core teardown, queue rewiring, legacy sweep, migration 0061 supersede (**LAST CHUNK**)
**Owner (implement):** backend (services teardown + migrations + legacy sweep) + fullstack (FE queue UI strip in lockstep)
**Owner (verify):** qa
**Status (this doc):** PREP — pm signed off 2026-09-10 (NOTES.md Amendment 6); awaiting backend chunk 7 land + staging cut
**Cycle:** PM cycle 1, Team B
**Companion master checklist:** `testplan/18f4a2dd-verification-checklist.md` (Cluster F — full set, plus conservative-cancel cross-cutting)
**Prior chunks closed:** 1 (Cluster A) · 3 (Cluster B) · 4 (Cluster C, incl. C1b settlements) · 6 (Cluster E)
**Chunk 5:** verified NO-OP, no spec

## Goal

Tear down the remaining approval machinery now that direct-apply flows are in place across all clusters (A–E). This chunk targets:

1. **Work-inbox rewiring** — `work-inbox.service.ts` no longer calls `getApprovalQueue` (`:15`, `:262`, `:302`, `:340`) AND no longer queries `tripExpenses.approvalStatus='PENDING'` (`:227`). Manager dashboard renders without those signals (Amendment 1 invariant — rewire or 500).
2. **Reports rewiring** — `reports.routes.ts` no longer calls `getApprovalQueue`. Report builders compile without the queue consumer.
3. **Dead governance services** — `approval.service.ts` endpoints return 404 / are deleted; `approval-queue.service.ts` deleted or no-op; `governance/transition*.ts`, `governance/policy*.ts`, `governance/action-core*.ts` removed or dead-code.
4. **Dashboard queue UI teardown** — `ApprovalQueueCard`, `ManagerDecisionInbox`, `useApprovalQueue` components removed from the dashboard; `/dashboard/approval-queue` route returns empty / 404.
5. **Legacy PENDING/CHECKED settlement/request sweep** — close stranded rows (created before chunk 4) with a stamped reason (`approval flow removed — legacy request closed`). Audit preserved. **NO retroactive money movement** (no auto-APPLY of old requests — that would fabricate financial entries nobody approved). Amendment 5 ruling 2.
6. **Migration 0061 supersede** — the legacy governance migration (or its equivalent) is superseded; new migrations cover the chunk-7 surface.

This chunk MUST land LAST. Removing services other chunks still reference will break chunks 1–6. Sequencing contract (Amendment 1 invariant): chunk 7 ships after chunks 1–6 are closed on `origin/prod`.

## Out of scope

- Chunks 1–6 — closed; this spec does NOT re-verify them (re-run the cluster-sweep master checklist AFTER chunk 7 lands for cross-c-cutting coverage).
- New governance flows — there are none; chunk 7 is a teardown.
- New financial writes — none. The legacy sweep closes rows, it does not create new ones.
- Casbin policy changes — RBAC stays as it was; chunk 7 removes approval flow, not authorization (Amendment 1 invariant).
- Performance benchmarking of the work-inbox after rewiring — out of scope unless surfaced by qa finding.

## Acceptance criteria

> All UI verifications are rung 3 (`UI DRIVEN`); API verifications are rung 2 (`DB/API VERIFIED`) but the UI side of each is rung 3. The dashboard / reports surfaces are verified rung 3; the work-inbox consumer is verified rung 2 (internal service, no UI surface).

### TC-CHUNK7-001 — Dashboard renders without ApprovalQueue / ManagerDecisionInbox components

- **Given** staging rendered after chunk 7 lands; MANAGER / ADMIN logged in
- **When** MANAGER opens `/dashboard` (or equivalent — confirm route)
- **Then**:
  - No `ApprovalQueueCard` component is rendered (no node matching `data-testid="approval-queue-card"` or equivalent)
  - No `ManagerDecisionInbox` component is rendered
  - Page loads with HTTP 200 — no 500 from a dangling `getApprovalQueue` call (Amendment 1 invariant: rewire or dashboard 500s)
  - `browser_get_logs()` returns no red entries during navigation
- **Assert:**
  - `browser_evaluate(() => document.querySelectorAll('[data-testid*="approval"], [data-testid*="manager-decision"], .ApprovalQueueCard, .ManagerDecisionInbox').length)` returns 0
  - `browser_evaluate(() => document.querySelectorAll('*').length > 0)` returns true (page rendered, not blank)
- **Evidence:**
  - `qa/2026-09-10_approval-removal-chunk7_ui-001a-dashboard-pre.png` (OPTIONAL — pre-cut snapshot nice-to-have, NOT required for PASS; post-cut absence assert + zero-red-logs is sufficient per pm ruling 13:30Z)
  - `qa/2026-09-10_approval-removal-chunk7_ui-001b-dashboard-post.png` (post-cut, queue cards absent)
  - `qa/2026-09-10_approval-removal-chunk7_ui-driver.log`

### TC-CHUNK7-002 — `/dashboard/approval-queue` route dead

- **Given** staging after cut
- **When** MANAGER navigates to `/dashboard/approval-queue` (or equivalent — confirm exact route in router)
- **Then**:
  - Route returns empty / 404 / removed (the chunk-7 master checklist F2 rule)
  - No 500 from a stale `getApprovalQueue` invocation
- **Assert:**
  - `browser_navigate` to the route; `browser_get_state` shows `404` or a clean empty page
  - Direct `curl -H "Authorization: Bearer $MANAGER_TOKEN" https://vantai.tingting.vip/api/.../approval-queue` returns 404 (or 200 with `items: []` if a thin empty-list stub remains — confirm implementation choice in commit)
- **Evidence:**
  - `qa/2026-09-10_approval-removal-chunk7_ui-002-route.png`
  - `qa/2026-09-10_approval-removal-chunk7_api-002.log`

### TC-CHUNK7-003 — `approval.service.ts` endpoints return 404 or are removed

- **Given** staging after cut
- **When** QA probes the maker/checker endpoints the master checklist F3 names (likely `POST /api/approval/:id/check`, `POST /api/approval/:id/approve`, `GET /api/approval/queue` — confirm exact routes from `approval.service.ts` before chunk 7)
- **Then**:
  - Each returns 404 (route deleted) or 403 (RBAC scope only) — both acceptable, same shape as chunk 4 / 6
  - No 200 / 201 on approve/reject attempts
- **Assert:**
  - `curl -X POST …/api/approval/$ID/check` returns 404 or 403
  - `curl -X POST …/api/approval/$ID/approve` returns 404 or 403
  - `curl …/api/approval/queue` returns 404 or `{ items: [] }`
- **Evidence:** `qa/2026-09-10_approval-removal-chunk7_api-003-dead.log`

### TC-CHUNK7-004 — `work-inbox.service.ts` rewired (Amendment 1 invariant)

- **Given** staging after cut; the work-inbox feed must compile + serve
- **When** qa probes the work-inbox endpoint (e.g. `GET /api/work-inbox` — confirm route) as MANAGER / ADMIN
- **Then**:
  - Response 200 with the inboxes the user has (minus the approval queue)
  - No 500 from a dangling `getApprovalQueue` call (`:15`, `:262`, `:302`, `:340`) or the `tripExpenses.approvalStatus='PENDING'` query (`:227`)
  - Source-tree grep confirms NO remaining references to `getApprovalQueue` OR `approvalStatus='PENDING'` in `work-inbox.service.ts`
- **Assert:**
  - `curl -H "Authorization: Bearer $MANAGER_TOKEN" …/api/work-inbox` returns 200 with valid JSON (no 500 / stack trace)
  - `grep -nE 'getApprovalQueue|approvalStatus.*PENDING' backend/src/services/work-inbox.service.ts` returns zero hits
  - The `browser_navigate` to a surface that hits work-inbox returns 200 with a rendered list (e.g. MANAGER inbox tab if it exists)
- **Evidence:**
  - `qa/2026-09-10_approval-removal-chunk7_api-004-work-inbox.log`
  - `grep` output in `qa/2026-09-10_approval-removal-chunk7_src-004.txt`
  - `qa/2026-09-10_approval-removal-chunk7_ui-004-inbox.png`

### TC-CHUNK7-005 — `reports.routes.ts` queue consumer removed

- **Given** staging after cut
- **When** qa probes a report endpoint that historically consumed `getApprovalQueue` (identify the exact route from `reports.routes.ts` at implement time — likely a manager-side report listing approval-pending counts)
- **Then**:
  - Report endpoint returns 200 (or the expected payload) without the approval queue segment
  - No 500 from a dangling consumer
  - Source-tree grep confirms NO remaining calls to `getApprovalQueue` in `reports.routes.ts`
- **Assert:**
  - `curl -H "Authorization: Bearer $MANAGER_TOKEN" …/api/reports/…` returns 200, JSON well-formed
  - `grep -nE 'getApprovalQueue' backend/src/routes/reports.routes.ts` returns zero hits
- **Evidence:**
  - `qa/2026-09-10_approval-removal-chunk7_api-005-reports.log`
  - `grep` output in `qa/2026-09-10_approval-removal-chunk7_src-005.txt`

### TC-CHUNK7-006 — Governance / transition / policy / action-core services removed or dead

- **Given** staging after cut
- **When** qa greps the source tree + probes any remaining routes for `governance/transition*`, `governance/policy*`, `governance/action-core*`, `approval-queue.service`, `approval.service`
- **Then**:
  - Master checklist F3 + F4 satisfied: `approval.service.ts` endpoints dead (TC-CHUNK7-003 covers this); `approval-queue.service.ts` no longer imported by active code (or removed entirely); `governance/transition*` / `governance/policy*` / `governance/action-core*` either deleted or no callers (dead code acceptable)
  - `GOVERNANCE_ACTION_KINDS` constant no longer referenced in active code (master checklist F3 second bullet)
- **Assert:**
  - `grep -rnE 'from ['\''"](\.\./)*governance/(transition|policy|action-core)' backend/src/` returns hits ONLY inside dead-code files or `// @ts-expect-error` / `.d.ts` blocks (acceptable; flag anything else)
  - `grep -rnE 'GOVERNANCE_ACTION_KINDS' backend/src/` returns hits ONLY inside `governance/` itself (dead-code), the migration that defined it (historical reference), or commented-out sections
  - `curl` to any route handler in those services returns 404 / 403 / 410 (acceptable: route deleted)
- **Evidence:**
  - `grep` outputs in `qa/2026-09-10_approval-removal-chunk7_src-006a.txt`
  - `grep` outputs in `qa/2026-09-10_approval-removal-chunk7_src-006b.txt`
  - `qa/2026-09-10_approval-removal-chunk7_api-006-dead.log`

### TC-CHUNK7-007 — Conservative-cancel legacy PENDING/CHECKED rows (Amendment 5 ruling 2)

- **Given** staging before cut; baseline count of `governance_actions` (or the equivalent legacy request table — confirm at implement time) rows with `status IN ('PENDING', 'CHECKED', 'CHECKED_BY_ACCOUNTANT')` **regardless of creation date**, EXCLUDING kinds whose flows pm ruled KEPT (charge-proposal billing review, accounting-lock) [scope amended by pm 13:30Z — any row still pending today is stranded by definition; a date bound would strand pre-chunk-3 salary/CUS rows]
- **When** chunk 7 migration runs the legacy sweep
- **Then**:
  - ALL remaining PENDING / CHECKED rows (except kept-flow kinds) are stamped with reason `'approval flow removed — legacy request closed'`
  - Status moves to `CANCELLED` (or equivalent terminal state — confirm naming at implement time)
  - **NO retroactive money movement** — no auto-APPLY of old requests, no new ledger rows
  - Original created rows are NOT deleted (read-only audit preserved)
- **Assert:**
  - DB query: `SELECT COUNT(*) FROM governance_actions WHERE status IN ('PENDING', 'CHECKED', 'CHECKED_BY_ACCOUNTANT') AND kind NOT IN (<kept-flow kinds>)` returns 0 after sweep
  - DB query: `SELECT id, status, reason, updated_at FROM governance_actions WHERE reason = 'approval flow removed — legacy request closed'` returns N rows where N = pre-sweep baseline count
  - Ledger table row count is unchanged from the pre-chunk-7-cut baseline (no fabricated entries)
  - No `governance_actions` row was deleted (`SELECT COUNT(*) FROM governance_actions` post-sweep ≥ pre-sweep baseline, minus the few that had already been auto-applied by chunks 3/4 — expected to be 0 since auto-apply writes a NEW row, not modify the request row)
- **Evidence:**
  - `qa/2026-09-10_approval-removal-chunk7_db-007-count-before.sql`
  - `qa/2026-09-10_approval-removal-chunk7_db-007-count-after.sql`
  - `qa/2026-09-10_approval-removal-chunk7_db-007-ledger-stable.sql`
  - `qa/2026-09-10_approval-removal-chunk7_db-007-cancelled-rows.sql`

### TC-CHUNK7-008 — Migration 0061 (or legacy equivalent) superseded

- **Given** chunk 7 commits include the new migration(s) that supersede the legacy governance migration
- **When** staging DB is at the chunk-7 head
- **Then**:
  - `SELECT version, description FROM drizzle.__drizzle_migrations ORDER BY installed_at DESC LIMIT 5` shows the chunk-7 migration as the latest (and any prior `0061_*` migration as superseded — confirm exact naming at implement time)
  - The migration runs cleanly on a fresh staging DB AND on top of an existing staging DB with chunks 1–6 already applied (idempotent)
  - No DDL on `governance_actions` deletes rows (Amendment 1 invariant — history preserved)
- **Assert:**
  - Migration log captured in `qa/2026-09-10_approval-removal-chunk7_migration-fresh.log`
  - Migration log captured in `qa/2026-09-10_approval-removal-chunk7_migration-on-top.log` (staging DB with chunks 1–6 already applied)
  - DB query: `SELECT COUNT(*) FROM governance_actions` post-migration ≥ pre-migration baseline
- **Evidence:**
  - `qa/2026-09-10_approval-removal-chunk7_db-008-migrations.sql`
  - Both migration logs above

### TC-CHUNK7-009 — FE lockstep: queue UI fully stripped (Amendment 1 invariant)

- **Given** chunk 7 backend commit lands on `origin/prod`
- **When** fullstack strips `ApprovalQueueCard`, `ManagerDecisionInbox`, `useApprovalQueue` from the frontend tree
- **Then**:
  - `grep -rnE 'ApprovalQueueCard|ManagerDecisionInbox|useApprovalQueue' frontend/src/` returns zero hits in `*.tsx` / `*.ts` (excluding `*.test.*` for archive / commented-out reference)
  - No 404 / 500 from a dead-component import
  - Dashboard renders clean (TC-CHUNK7-001 confirms)
- **Assert:**
  - Frontend `pnpm test` + `npx tsc -b` clean (TC-CHUNK7-010 covers the gate)
  - `grep` output captured in `qa/2026-09-10_approval-removal-chunk7_src-009.txt`
- **Evidence:** grep log + UI post-cut screenshot

### TC-CHUNK7-010 — Full QA gate green after chunk 7 lands

Per [[agent-working-contract]] QA gates table. Run from repo root after chunk-7 + FE lockstep commits + staging cut:

```
pnpm lint                                                       # 0 errors
cd backend && npx tsc --noEmit                                  # 0 errors
cd backend && pnpm test                                         # all pass (chunk-7 service-teardown tests; ledger-stability tests for TC-CHUNK7-007)
cd frontend && npx tsc -b                                       # 0 errors
cd frontend && pnpm test                                        # all pass (FE lockstep tests)
make build                                                       # succeeds
cd e2e && ./run_all.sh                                          # all pass (E2E IS required — chunk 7 touches shared contracts, Casbin policy imports, RBAC, and a migration; per AGENTS.md E2E rule)
```

Per-chunk commit + push (commit+push after every task rule from `testing-and-deploy-environments`). After push, qa runs the gate on **staging first**; if green, PM authorises the cluster-sweep master-checklist re-run (X1–X5 across all clusters A–F).

- **Evidence:** `qa/2026-09-10_approval-removal-chunk7_gates.log`

### TC-CHUNK7-011 — Staging cut procedure (Amendment 5 ruling 3)

- **Given** chunk 7 commit + FE lockstep commit both land on `origin/prod`
- **When** staging cut is prepared
- **Then** the cut follows Amendment 5 ruling 3 — clean detached checkout of `origin/prod` tip (`/private/tmp/silversea-staging: git fetch && git checkout origin/prod`), NOT `make demo` from the shared working tree
- **Assert:** staging container's `RepoDigest` matches the GHCR `:latest` digest built from the chunk-7 commit tree; no bundle-flip mismatch (per [[deploy-tag-race-verification]] lesson)
- **Evidence:** `qa/2026-09-10_approval-removal-chunk7_staging-cut.log`

## Linked artifacts

- Ticket: `18f4a2dd` (kanban, in_progress — moves to DONE after master checklist cluster-sweep re-run post-chunk-7)
- Master checklist: `testplan/18f4a2dd-verification-checklist.md` — Cluster F (chunk 7) is this spec; X1–X5 cross-cutting re-run after cluster-sweep
- Companion specs: `testplan/qa/2026-09-10_approval-removal-chunk4.md` (cluster C, incl. C1b settlements), `testplan/qa/2026-09-10_approval-removal-chunk6.md` (cluster E)
- Shared header: `testplan/qa/_TEMPLATE.md`
- PM rulings adopted: Amendment 1 (RBAC stays, FE lockstep, X1 grep, work-inbox + reports rewiring), Amendment 5 (own-table audit pattern carry-over, conservative-cancel legacy sweep, staging cuts from pushed HEAD only)
- Memory: [[agent-working-contract]] (QA gates, RBAC invariant), [[test-debt-and-db-lean-down]] (do-not-drop governance_actions), [[deploy-tag-race-verification]] (staging cut bundle-flip check), [[prd-roadmap-and-decisions]] (O2C business flow context for what queue UI used to drive)
