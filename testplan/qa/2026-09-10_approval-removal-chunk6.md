# Regression spec — `18f4a2dd` Chunk 6: app-settings policy requests

> **Historical cycle — superseded 2026-09-17:** keep this record for its dated decisions/evidence only. Retained approval exceptions, maker/checker chains (including automatic chains), pending queues and approve/reject instructions in this old cycle are not current product requirements. Run [NO-APP-01..23](../2026-09-17-no-approval-workflows.md) and current role/flow cases instead. Historical PASS does not verify the new criteria.

> **DRAFT — awaiting pm sign-off before qa runs.**
> Shared header (Environment / Accounts / Verification protocol / Evidence bundle / Pass criteria / QA gates / Anti-lying / Not-covered) lives in `testplan/qa/_TEMPLATE.md`; do not duplicate here.

**Ticket:** 18f4a2dd (Remove all phê duyệt flows)
**Chunk:** 6 — App-settings policy requests
**Owner (implement):** backend (settings writes) + fullstack (settings UI lockstep)
**Owner (verify):** qa
**Status (this doc):** PREP — pm signed off 2026-09-10 (NOTES.md Amendment 6); awaiting backend chunk 6 land + staging cut
**Cycle:** PM cycle 1, Team B
**Companion master checklist:** `testplan/18f4a2dd-verification-checklist.md` (Cluster E — full set)
**Companion chunk spec:** `testplan/qa/2026-09-10_approval-removal-chunk4.md` (chunks 1–4 closed; chunk 5 = no-op)

## Goal

Re-shape the app-settings policy requests so the ADMIN's write **applies immediately** rather than queued behind a maker → checker → approver pipeline. The settings in scope this chunk:

- **Financial reporting policy** (admin-only setting; controls reporting cadence / FX / VAT visibility)
- **Truck profile settings** (admin-only setting; controls plate rules, weight ceilings, route restrictions)

The maker/checker pattern that used to gate these writes is removed. Audit is preserved on the settings row itself (own-table `updatedBy` / `updatedAt` — pattern reused from chunks 3/4); a new `governance_actions` row is NOT required. RBAC stays: only ADMIN may write the settings; removing approval ≠ removing authorization (Amendment 1 invariant).

## Out of scope

- Cluster A (CUS workspace) — chunk 1 (closed).
- Cluster B (Salary period governance) — chunk 3 (closed).
- Cluster C (Financial direct-money quartet) — chunk 4 (closed; own-table audit pattern reused here).
- Cluster D (OCR fuel-evidence) — chunk 5 — **verified NO-OP, no spec**.
- Cluster F (Governance core + queue teardown) — chunk 7 — own spec; this chunk MUST land before chunk 7 because chunk 7 removes services this chunk still references for the dead-endpoint probe.
- Tenant-level / org-level settings — out of scope (only ADMIN-global app-settings policy + truck profile).
- Settings READ paths — out of scope (only writes are in scope; reads unchanged).

## Acceptance criteria

> All UI verifications are rung 3 (`UI DRIVEN`); API verifications are rung 2 (`DB/API VERIFIED`) but the UI side of each is rung 3. The settings screens are ADMIN-only; non-ADMIN attempts are rung 2.

### TC-CHUNK6-001 — Financial reporting policy change applies immediately (ADMIN)

- **Given** ADMIN logged in on staging; current `financial_reporting_policy` value (snapshot via `GET /api/admin/settings/financial-reporting-policy` — confirm exact route in code at implement time)
- **When** ADMIN POSTs a new value via `PUT /api/admin/settings/financial-reporting-policy` with `{ value: <new>, expectedVersion: <snapshot> }`
- **Then**:
  - Response 200 / 204 with `{ status: "APPLIED" }` (or equivalent — confirm in code), NOT `PENDING_APPROVAL` / `PENDING_CHANGE`
  - Subsequent `GET /api/admin/settings/financial-reporting-policy` returns the new value immediately
  - No `governance_actions` row is created with `kind = "FINANCIAL_REPORTING_POLICY"` (Amendment 5 ruling 1 — own-table audit pattern)
  - Settings row carries own-table audit (`updatedBy` = ADMIN user id, `updatedAt` = now)
- **Assert:**
  - API `curl -X PUT …/financial-reporting-policy` returns applied status in ONE call
  - DB query: `SELECT value, updated_by, updated_at FROM settings WHERE key = 'financial_reporting_policy'` reflects the new write
  - DB query: `SELECT COUNT(*) FROM governance_actions WHERE kind = 'FINANCIAL_REPORTING_POLICY' AND created_at > '<chunk-6-cut-time>'` returns 0 (no new rows)
- **Evidence:**
  - `qa/2026-09-10_approval-removal-chunk6_api-001-policy.log`
  - `qa/2026-09-10_approval-removal-chunk6_db-001.sql`
  - `qa/2026-09-10_approval-removal-chunk6_ui-001-settings-page.png`

### TC-CHUNK6-002 — Truck profile setting change applies immediately (ADMIN)

- **Given** ADMIN logged in on staging; current `truck_profile` value (snapshot via the matching GET endpoint — confirm route in code)
- **When** ADMIN POSTs a new value via `PUT /api/admin/settings/truck-profile`
- **Then**:
  - Response 200 / 204 with applied status, NOT `PENDING_APPROVAL`
  - Subsequent GET returns the new value
  - No new `governance_actions` row created
  - Settings row carries own-table audit (`updatedBy` / `updatedAt`)
- **Assert:** same shape as TC-CHUNK6-001, against `key = 'truck_profile'`.
- **Evidence:**
  - `qa/2026-09-10_approval-removal-chunk6_api-002-truck.log`
  - `qa/2026-09-10_approval-removal-chunk6_db-002.sql`
  - `qa/2026-09-10_approval-removal-chunk6_ui-002-truck-profile.png`

### TC-CHUNK6-003 — Dead approve/reject endpoints return 404 or 403

- **Given** staging after chunk 6 lands
- **When** QA probes the maker/checker endpoints that used to gate settings writes (the `/api/governance-actions/:id/check` and `/approve` routes — per cluster E checklist E3; confirm exact paths in `governance/locked-entity-manifest.ts`)
- **Then**:
  - Each returns 404 (route deleted) or 403 (RBAC scope only — both acceptable, the chunk-4 spec mandates the same shape)
  - No 200 / 201 on a settings write via the maker/checker chain
- **Assert:**
  - `curl -X POST …/api/governance-actions/$ID/check` returns 404 or 403
  - `curl -X POST …/api/governance-actions/$ID/approve` returns 404 or 403
- **Evidence:** `qa/2026-09-10_approval-removal-chunk6_api-003-dead.log`

### TC-CHUNK6-004 — No dead "Chờ phê duyệt" / approve/reject UI elements (settings screens)

- **Given** staging rendered after the cut
- **When** QA greps the settings UI (`/admin/settings/financial-reporting-policy`, `/admin/settings/truck-profile` — confirm routes) for `Chờ phê duyệt`, `PENDING_APPROVAL`, `Duyệt`, `Từ chối`, `gửi yêu cầu` (case-insensitive, Vietnamese-aware — per Amendment 1 X1 invariant)
- **Then** zero matches at the settings surfaces
- **Assert:** `browser_evaluate(() => document.body.innerText.match(/chờ phê duyệt|pending.approval|duyệt|từ chối|gửi yêu cầu/gi))` returns null on the settings pages
- **Evidence:**
  - `qa/2026-09-10_approval-removal-chunk6_ui-004a-policy-page.png`
  - `qa/2026-09-10_approval-removal-chunk6_ui-004b-truck-page.png`
  - DOM assert in `qa/2026-09-10_approval-removal-chunk6_ui-driver.log`

### TC-CHUNK6-005 — RBAC still enforced (negative path; Amendment 1 invariant)

- **Given** staging after cut
- **When**:
  - FORWARDER tries `PUT /api/admin/settings/financial-reporting-policy` → 403
  - FORWARDER tries `PUT /api/admin/settings/truck-profile` → 403
  - ACCOUNTANT tries `PUT /api/admin/settings/financial-reporting-policy` → 403
  - DRIVER tries either → 403
- **Then** each returns 403 (Casbin deny); no auto-apply short-circuit on the role guard
- **Evidence:** `qa/2026-09-10_approval-removal-chunk6_api-005-rbac.log`

### TC-CHUNK6-006 — Own-table audit, no new governance rows (Amendment 5 ruling 1)

- **Given** staging after cut; TC-CHUNK6-001 + TC-CHUNK6-002 have both been run
- **When** QA counts `governance_actions` rows for the two settings kinds in the chunk-6 window
- **Then**:
  - `governance_actions` gains NO new row with `kind IN ('FINANCIAL_REPORTING_POLICY', 'TRUCK_PROFILE')` since the chunk-6 cut
  - Historical governance rows (any kind, any status) remain unchanged
  - `settings` rows for the two keys carry `updated_by` / `updated_at` set to ADMIN user + chunk-6 cut time
- **Assert:**
  - DB query: `SELECT COUNT(*) FROM governance_actions WHERE kind IN ('FINANCIAL_REPORTING_POLICY', 'TRUCK_PROFILE') AND created_at > '<chunk-6-cut-time>'` returns 0
  - DB query: `SELECT key, updated_by, updated_at FROM settings WHERE key IN ('financial_reporting_policy', 'truck_profile')` returns both keys with non-null audit fields
  - DB query: `SELECT COUNT(*) FROM governance_actions` is unchanged from the pre-cut baseline (no DDL deleted historical rows — preserves do-not-drop list per Amendment 1)
- **Evidence:**
  - `qa/2026-09-10_approval-removal-chunk6_db-006-count-before.sql`
  - `qa/2026-09-10_approval-removal-chunk6_db-006-count-after.sql`
  - `qa/2026-09-10_approval-removal-chunk6_db-006-diff.txt`

### TC-CHUNK6-007 — FE lockstep (Amendment 1 invariant)

- **Given** the chunk-6 backend commit lands on `origin/prod` (Amendment 4 branch ruling)
- **When** fullstack wires the settings UI to the new direct-write endpoints (removes any approve/reject button on the settings pages; removes any "Yêu cầu đã gửi" toast)
- **Then**:
  - The settings save button posts directly to `PUT /api/admin/settings/…`
  - The settings save button no longer chains through any governance action
  - No 404 fires from the settings UI (dead-endpoint removal is atomic — backend + frontend land together)
- **Assert:**
  - Browser devtools Network tab on settings save shows the PUT to the settings endpoint, NOT to `/api/governance-actions/:id/check`
  - `browser_get_logs()` returns no red 404 / 500 during the save flow
- **Evidence:**
  - `qa/2026-09-10_approval-removal-chunk6_ui-007a-policy-save.png`
  - `qa/2026-09-10_approval-removal-chunk6_ui-007b-truck-save.png`
  - Network capture in `qa/2026-09-10_approval-removal-chunk6_ui-driver.log`

### TC-CHUNK6-008 — Staging cut procedure (Amendment 5 ruling 3)

- **Given** chunk-6 commit lands on `origin/prod`
- **When** staging cut is prepared
- **Then** the cut follows Amendment 5 ruling 3 — clean detached checkout of `origin/prod` tip (the staging helper at `/private/tmp/silversea-staging` does `git fetch && git checkout origin/prod`), NOT `make demo` from the shared working tree (which carries uncommitted WIP)
- **Assert:** staging container's `RepoDigest` matches the GHCR `:latest` digest built from the chunk-6 commit tree; no bundle-flip mismatch (per [[deploy-tag-race-verification]] lesson)
- **Evidence:** `qa/2026-09-10_approval-removal-chunk6_staging-cut.log`

### TC-CHUNK6-009 — Full QA gate green after chunk 6 lands

Per [[agent-working-contract]] QA gates table. Run from repo root after the chunk-6 commit + staging cut:

```
pnpm lint                                                       # 0 errors
cd backend && npx tsc --noEmit                                  # 0 errors
cd backend && pnpm test                                         # all pass (settings tests updated if any)
cd frontend && npx tsc -b                                       # 0 errors
cd frontend && pnpm test                                        # all pass (settings UI tests updated if any)
make build                                                       # succeeds
```

E2E is **NOT** required for this chunk (settings writes don't touch shared contracts / Drizzle schemas / financial calculations / RBAC schemas at the level chunks 1–4 did). If backend's chunk-6 commit touches any of those, add `cd e2e && ./run_all.sh` to this gate.

Per-chunk commit + push (commit+push after every task rule from `testing-and-deploy-environments`). After push, qa runs the gate on **staging first**; if green, PM authorises chunk 7.

- **Evidence:** `qa/2026-09-10_approval-removal-chunk6_gates.log`

## Linked artifacts

- Ticket: `18f4a2dd` (kanban, in_progress)
- Master checklist: `testplan/18f4a2dd-verification-checklist.md` — Cluster E (chunk 6) is this spec
- Companion specs: `testplan/qa/2026-09-10_approval-removal-chunk4.md` (cluster C, closed), `testplan/qa/2026-09-10_approval-removal-chunk7.md` (cluster F, next chunk)
- Shared header: `testplan/qa/_TEMPLATE.md`
- PM rulings adopted: Amendment 1 (RBAC stays, FE lockstep, X1 grep), Amendment 5 (own-table audit, staging cuts from pushed HEAD only)
- Memory: [[agent-working-contract]] (QA gates, RBAC invariant), [[test-debt-and-db-lean-down]] (direct-apply + own-table audit pattern), [[deploy-tag-race-verification]] (staging cut bundle-flip check)
