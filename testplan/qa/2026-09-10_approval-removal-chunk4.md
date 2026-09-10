# Regression spec — `18f4a2dd` Chunk 4: direct-money governance auto-apply

**Ticket:** 18f4a2dd (Remove all phê duyệt flows)
**Chunk:** 4 — Financial maker-checker / direct-money trio
**Owner (implement):** backend (single writer; uncommitted tree in main checkout)
**Owner (verify):** qa
**Status (this doc):** PREP — ready to execute when backend chunk 4 lands + staging cut
**Cycle:** PM cycle 1, Team B
**Companion master checklist:** `testplan/18f4a2dd-verification-checklist.md` (Cluster C — full set)

## Goal

Re-shape the financial direct-money flows so the action is **applied at request** rather than queued behind a maker → checker → approver pipeline. The trio this chunk targets:

- **Advance requests** (FORWARDER / DISPATCHER creates → applied immediately)
- **Credit overrides** (ACCOUNTANT creates → applied immediately)
- **Debt offsets** (ACCOUNTANT creates → applied immediately)

The maker/checker endpoints that used to live at `/api/governance-actions/:id/check` and `/approve` should no longer be reachable on these flows (404 or 403). Audit rows are **preserved** with `AUTO/APPLIED` semantics — not deleted.

## Environment

| Slot | Value |
|---|---|
| Local UI | `http://localhost:7174` |
| Local API | `http://localhost:3001/api` |
| Staging UI | `https://vantai.tingting.vip` |
| Staging API | `https://vantai.tingting.vip/api` |
| **No prod access** | deploy + bare health only, per AGENTS.md |
| Browser | AgentsRoom embedded browser |
| API tool | `curl` / `node fetch` for the 4xx asserts |

### Accounts (from `testplan/testaccounts.txt`, password `Abc123`)

| Role | Local (demo) | Staging (real) |
|---|---|---|
| CUS (Cluster A anchor) | `samsung-cs` / `canon-cs` | `thanhdc` / `tiepvv` / `anhdtv` / `huyenntt` / `anhntn` |
| FORWARDER / DISPATCHER | `giaonhan` / `dieuvan` | `dungnv` / `bacdk` / `huongnt` |
| ACCOUNTANT | `ketoan` | `hoapt` / `liennt` / `lydp` / `vanntt` / `myvtt` / `ngocntm` |
| ADMIN (rollback path) | `admin` | `admin` / `phuongnt` / `namnv` |

## Companion code locations (for grep, not for writing)

- `backend/src/services/adjustment-governance.service.ts` — `autoApplyGovernanceAction` introduced in chunk 4 (diff confirmed: `+42, -0`).
- `backend/src/routes/financial/advances.routes.ts` — advance-requests approve/reject chained to `autoApplyGovernanceAction` + `approveDirectMoneyGovernanceAction`.
- `backend/src/routes/financial/credit-overrides.routes.ts` — same pattern.
- `backend/src/routes/financial/debt-offsets.routes.ts` — same pattern.
- `backend/src/governance/locked-entity-manifest.ts` — proof titles rewritten from "maker/three actors" to "applied immediately" (visible in the diff).

## Out of scope (covered by other chunks / not part of chunk 4)

- Cluster A (CUS workspace) — chunk 1; companion assertion TC-CHUNK4-A1 still runs because the `phê duyệt` removal cascades downstream.
- Cluster B (Salary period) — chunk 3.
- Cluster D (OCR fuel-evidence) — chunk 5.
- Cluster E (App-settings policy) — chunk 6.
- Cluster F (Governance core teardown + supersede `0061`) — chunk 7.

## Acceptance criteria

> All UI verifications are rung 3 (`UI DRIVEN`); API verifications are rung 2 (`DB/API VERIFIED`) but the UI side of each is rung 3.

### TC-CHUNK4-001 — CUS supplemental container edit day-after-dispatch saves directly

> Per Cluster A row A1 + the in-ticket checkpoint: "container edit day-after-dispatch saves directly, no approval prompt".

- **Given** CUS logged in on local (preferred for fast iteration) **and** staging; a shipment that was created on day-1 **without** a container number, and a trip has been dispatched to that shipment on day-1; today is day-2
- **When** CUS opens the shipment → `Chỉnh sửa thông số container` → enters `MSMU8456204` (or any 11-char container code) → saves
- **Then**:
  - The save succeeds (HTTP 200 / 201, no `PENDING_APPROVAL` status)
  - The container number is visible on the ledger side immediately after the click (DB side-effect proof)
  - The UI does **not** show any of:
    - "gửi yêu cầu cho Điều vận xem xét"
    - "Chờ phê duyệt" badge
    - "Yêu cầu đã gửi" approval-prompt toast
- **Assert:**
  - DOM has no node containing `Chờ phê duyệt` / `PENDING_APPROVAL` / `gửi yêu cầu` immediately after save (`browser_evaluate`).
  - DB query: `SELECT containers FROM shipments WHERE id = $1` returns the new container number.
  - API call: `PUT /api/shipments/:id/container` returns 200 with `{ status: "ACTIVE" }` or similar (no pending state).
- **Evidence:**
  - `qa/2026-09-10_approval-removal-chunk4_ui-001-cus-container-edit.png`
  - `qa/2026-09-10_approval-removal-chunk4_ui-001-cus-container-list.png`
  - `qa/2026-09-10_approval-removal-chunk4_db-001.sql`
  - `qa/2026-09-10_approval-removal-chunk4_api-001.log`
  - `qa/2026-09-10_approval-removal-chunk4_ui-driver.log`

### TC-CHUNK4-002 — Advance request (FORWARDER / DISPATCHER) applies immediately

- **Given** FORWARDER / DISPATCHER logged in; a trip with vendor / supplier selected
- **When** they create an advance request via `POST /api/financial/advances/advance-requests` with `{ tripId, amount, reason, expectedVersion }`
- **Then**:
  - Response 200 / 201 with `{ status: "APPROVED" }` (or "APPLIED") — NOT `PENDING_CHECK`
  - The advance is **visible** in subsequent `GET /api/financial/advances?tripId=…` and in the FORWARDER ledger
  - No pending row in `governance_actions` is created with `kind = "ADVANCE_REQUEST"` (or if one is created, it is stamped `APPLIED` not `PENDING`)
- **Assert:**
  - API `curl -X POST …` returns `status: "APPROVED"` or equivalent in the body.
  - DB row in `advances` table carries the new row; balance / ledger `+amount`.
  - DB query: `SELECT status FROM governance_actions WHERE related_entity = 'advance' AND related_id = $1 ORDER BY id DESC LIMIT 1` returns `APPLIED` (not `PENDING`).
- **Evidence:**
  - `qa/2026-09-10_approval-removal-chunk4_api-002-advance.log`
  - `qa/2026-09-10_approval-removal-chunk4_db-002.sql`
  - `qa/2026-09-10_approval-removal-chunk4_ui-002-advance-list.png` (FORWARDER ledger view)

### TC-CHUNK4-003 — Credit override (ACCOUNTANT) applies immediately

- **Given** ACCOUNTANT logged in; a customer / vendor with an open credit position
- **When** they create a credit override via `POST /api/financial/credit-overrides`
- **Then**:
  - Response 200 / 201 with applied status
  - Credit ledger row added immediately
  - The previously-required `check` then `approve` two-step no longer applies — calling `POST /api/governance-actions/:id/check` on the new row returns **404** (or **403**)
- **Assert:**
  - API `curl -X POST …/credit-overrides` returns applied status
  - `curl -X POST …/governance-actions/$ID/check` returns 404 / 403 (dead)
  - `curl -X POST …/governance-actions/$ID/approve` returns 404 / 403 (dead)
- **Evidence:**
  - `qa/2026-09-10_approval-removal-chunk4_api-003-credit.log`
  - `qa/2026-09-10_approval-removal-chunk4_db-003.sql`
  - `qa/2026-09-10_approval-removal-chunk4_ui-003-credit-override.png`

### TC-CHUNK4-004 — Debt offset (ACCOUNTANT) applies immediately

- **Given** ACCOUNTANT logged in; a customer with an outstanding debt to a vendor
- **When** they create a debt offset via `POST /api/financial/debt-offsets`
- **Then**:
  - Response 200 / 201 with applied status
  - Debt balance updated; offset ledger rows added
  - No `PENDING_APPROVAL` row appears
- **Assert:** same pattern as TC-CHUNK4-003.
- **Evidence:**
  - `qa/2026-09-10_approval-removal-chunk4_api-004-debt.log`
  - `qa/2026-09-10_approval-removal-chunk4_db-004.sql`
  - `qa/2026-09-10_approval-removal-chunk4_ui-004-debt-offset.png`

### TC-CHUNK4-005 — No dead "Chờ phê duyệt" / approve/reject UI elements

- **Given** staging rendered after the cut
- **When** QA greps the entire UI for `Chờ phê duyệt`, `PENDING_APPROVAL`, `Duyệt`, `Từ chối` (case-insensitive, Vietnamese-aware) at the surfaces:
  - `/financial/advances` (or whatever the advances list route is — confirm in code)
  - `/financial/credit-overrides`
  - `/financial/debt-offsets`
  - CUS shipment detail (`Chỉnh sửa thông số container` dialog)
  - `/dashboard/approval-queue` (per Cluster F — should be empty or 404)
- **Then** none of those surfaces render approve/reject buttons or pending chips for the chunk-4 trio
- **Assert:** per surface, `browser_evaluate(() => Array.from(document.querySelectorAll('button, .chip, .badge, [data-status]')).filter(el => /Duyệt|Chờ phê duyệt|PENDING_APPROVAL/i.test(el.innerText)).length)` returns `0`
- **Evidence:**
  - `qa/2026-09-10_approval-removal-chunk4_ui-005a-advances.png`
  - `qa/2026-09-10_approval-removal-chunk4_ui-005b-credit-overrides.png`
  - `qa/2026-09-10_approval-removal-chunk4_ui-005c-debt-offsets.png`
  - `qa/2026-09-10_approval-removal-chunk4_ui-005d-cus-shipment.png`
  - `qa/2026-09-10_approval-removal-chunk4_ui-005e-dashboard.png`

### TC-CHUNK4-006 — Audit history preserved (no destructive rewrite)

- **Given** the staging DB
- **When** QA queries `SELECT count(*) FROM governance_actions;` and the per-kind breakdown
- **Then**:
  - Row count is unchanged from the pre-cut baseline (or only grows by AUTO/APPLIED entries from new actions, never shrinks)
  - Historical PENDING/APPROVED rows are still readable (read-only path)
  - No DDL on `governance_actions` deleted rows
- **Evidence:**
  - `qa/2026-09-10_approval-removal-chunk4_db-006-count-before.sql`
  - `qa/2026-09-10_approval-removal-chunk4_db-006-count-after.sql`
  - `qa/2026-09-10_approval-removal-chunk4_db-006-diff.txt`

### TC-CHUNK4-007 — RBAC still enforced (negative path)

- **Given** staging after cut
- **When**:
  - DRIVER tries `POST /api/financial/credit-overrides` → 403
  - FORWARDER tries `POST /api/financial/credit-overrides` → 403
  - CUS tries `POST /api/financial/advances/advance-requests` → 403
- **Then** each returns 403 (Casbin deny), no auto-apply short-circuit on the role guard
- **Evidence:** `qa/2026-09-10_approval-removal-chunk4_api-007-rbac.log`

### TC-CHUNK4-008 — Full QA gate green after chunk 4 lands

Per [[agent-working-contract]] QA gates table. Run from repo root:

```
pnpm lint                                                       # 0 errors
cd backend && npx tsc --noEmit                                  # 0 errors
cd backend && pnpm test                                         # all pass (chunk-4 tests updated, q15-* rewritten, q23-* rewritten per diff)
cd frontend && npx tsc -b                                       # 0 errors
cd frontend && pnpm test                                        # all pass
make build                                                       # succeeds
cd e2e && ./run_all.sh                                          # all pass
```

The chunk-4 commit must push per-chunk (commit+push after every task rule from `testing-and-deploy-environments`). After push, qa runs the gate on **staging first**; if green, PM authorises the next chunk (5).

- **Evidence:** `qa/2026-09-10_approval-removal-chunk4_gates.log`

## Verification protocol

1. **Auth flow** — login as the role under test (driver's `puppeteer-spa-auth` is the same skill; for ACCOUNTANT use it via the harness's `ctx.login('ACCOUNTANT')`).
2. **API probes** — `curl` with bearer token; capture full request + response to `qa/..._api-XXX.log`.
3. **UI probes** — `browser_evaluate` for chip / badge detection (TC-CHUNK4-005), `browser_screenshot` per surface.
4. **DB probes** — through `/api/...` endpoints preferred; psql only for the audit-history TC-CHUNK4-006 (drizzle ORM only rule applies to *application behaviour*, not to qa inspections).
5. **No raw SQL in test scripts** — qa inspection lines live in `.sql` artifacts for reproducibility, never inside test cases themselves.

## Evidence bundle

```
qa/
├── 2026-09-10_approval-removal-chunk4_ui-001-cus-container-edit.png
├── 2026-09-10_approval-removal-chunk4_ui-001-cus-container-list.png
├── 2026-09-10_approval-removal-chunk4_ui-002-advance-list.png
├── 2026-09-10_approval-removal-chunk4_ui-003-credit-override.png
├── 2026-09-10_approval-removal-chunk4_ui-004-debt-offset.png
├── 2026-09-10_approval-removal-chunk4_ui-005a-advances.png
├── 2026-09-10_approval-removal-chunk4_ui-005b-credit-overrides.png
├── 2026-09-10_approval-removal-chunk4_ui-005c-debt-offsets.png
├── 2026-09-10_approval-removal-chunk4_ui-005d-cus-shipment.png
├── 2026-09-10_approval-removal-chunk4_ui-005e-dashboard.png
├── 2026-09-10_approval-removal-chunk4_ui-driver.log
├── 2026-09-10_approval-removal-chunk4_api-001.log
├── 2026-09-10_approval-removal-chunk4_api-002-advance.log
├── 2026-09-10_approval-removal-chunk4_api-003-credit.log
├── 2026-09-10_approval-removal-chunk4_api-004-debt.log
├── 2026-09-10_approval-removal-chunk4_api-007-rbac.log
├── 2026-09-10_approval-removal-chunk4_db-001.sql
├── 2026-09-10_approval-removal-chunk4_db-002.sql
├── 2026-09-10_approval-removal-chunk4_db-003.sql
├── 2026-09-10_approval-removal-chunk4_db-004.sql
├── 2026-09-10_approval-removal-chunk4_db-006-count-before.sql
├── 2026-09-10_approval-removal-chunk4_db-006-count-after.sql
├── 2026-09-10_approval-removal-chunk4_db-006-diff.txt
├── 2026-09-10_approval-removal-chunk4_gates.log
└── 2026-09-10_approval-removal-chunk4_gate.txt
```

## Pass criteria

PASS iff TC-CHUNK4-001 through TC-CHUNK4-008 ALL hold on **staging first** (local-only run is a smoke test). Any TC FAIL on staging is a cycle FAIL with `fix-and-re-run` block appended to the failing artifact; PM relays to backend before chunk 5.

## Linked artifacts

- Ticket: `18f4a2dd` (kanban, in_progress)
- Master checklist: `testplan/18f4a2dd-verification-checklist.md` — Cluster C (chunk 4) is this spec; Clusters A / B / D / E / F get their own prep docs in subsequent cycles
- Companion specs: `testplan/2026-09-10_driver-mobile-ui.md`, `testplan/2026-09-10_replace-tags.md`
- Memory: [[test-debt-and-db-lean-down]] — direct-apply + `PENDING_EXPENSE_APPROVAL` retirement, cluster re-pin map

## Anti-lying guardrails

- "Backend says auto-apply works" with no API call to the endpoint = rung 1.
- Hitting `POST /api/financial/...` and seeing `200` = rung 2 only; must also verify the **status field** is `APPLIED` and the **ledger row** is present (rung 3 = UI + DB side-effect proof).
- "No PENDING_APPROVAL in the UI" without a `browser_evaluate` chip/badge regex = rung 1; visual grep is rung 1 at best.
- TC-CHUNK4-005 must enumerate every surface, not a subset — partial coverage = BLOCKED, not PASS.
- Audit history (TC-CHUNK4-006) is non-negotiable: if the seed / migration rewrote historical rows, the chunk fails even if all the new flows work.

## What is NOT covered (be honest)

- Chunks 5/6/7 — own cycles, own specs.
- Cross-currency / FX precision on the ledger rows — out of scope (the `round2dp()` invariant is the system's contract; chunk-4 doesn't change it).
- Webhook / notification dispatch on the auto-apply events — out of scope unless surfaced by qa finding.
- Mobile-native flows on financial screens (drivers don't see them) — N/A.
