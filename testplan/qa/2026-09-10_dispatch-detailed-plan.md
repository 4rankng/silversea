# Regression spec — `8afc13a9` Dispatch detailed-plan: all containers + reassign

**Ticket:** 8afc13a9 (Web UI change — Kế hoạch chi tiết, Điều vận role)
**Owner (implement):** fullstack
**Owner (verify):** qa
**Status (this doc):** PREP — ready to execute when fullstack lands + staging cut
**Cycle:** PM cycle 1, Team B

## Goal

The Dispatcher's "Kế hoạch chi tiết" (detailed-plan) screen currently only shows containers that have already been assigned a carrier on the master-plan (overview) screen. Fix:

1. **Show ALL containers of the selected day**, including those not yet assigned to any carrier.
2. **Allow assigning a carrier to an unassigned container** at the detailed-plan level (previously master-plan-only).
3. **Allow changing a container's carrier** at the detailed-plan level (reassign).

Confined to the dispatcher detailed-plan surface. Master-plan overview, other roles' screens, and reporting are NOT in scope.

## Environment

| Slot | Value |
|---|---|
| Local UI | `http://localhost:7174` |
| Local API | `http://localhost:3001/api` |
| Staging UI | `https://vantai.tingting.vip` |
| Staging API | `https://vantai.tingting.vip/api` |
| **No prod access** | deploy + bare health only, per AGENTS.md |
| Surface | `/dispatch-detail` (or the equivalent dispatcher detailed-plan route — confirm in code at implement time) |
| Browser | AgentsRoom embedded browser |
| API tool | `curl` / `node fetch` for the assignment / reassignment asserts |

### Accounts (from `testplan/testaccounts.txt`, password `Abc123`)

| Role | Local (demo) | Staging (real) |
|---|---|---|
| ĐIỀU VẬN (Dispatcher — primary) | `dieuvan` | `dungnv` / `bacdk` / `huongnt` |
| FORWARDER (alt creator / sanity) | `giaonhan` | `dungnv` / `bacdk` / `huongnt` |
| CUS (negative-role — must not get the control) | `samsung-cs` / `canon-cs` | `thanhdc` / `tiepvv` / `anhdtv` / `huyenntt` / `anhntn` |
| ADMIN (rollback path) | `admin` | `admin` / `phuongnt` / `namnv` |

## Companion code locations (for grep, not for writing)

- `frontend/src/features/dispatch/detailed-plan/` — surfaces touched by `a6cb2543` (replace-tags). Coordination: this ticket's files live in the same directory but the diff must be disjoint. Confirm at commit time via `git diff --name-only HEAD -- frontend/src/features/dispatch/detailed-plan/`.
- `frontend/src/pages/DispatchDetailPage.*` — likely the page entry.
- API: `PUT /api/dispatch/containers/:id/carrier` (or equivalent assignment endpoint — confirm at implement time; the existing master-plan assignment endpoint is the reference shape).

## Out of scope

- Master-plan (overview) screen — keep current behaviour (assigned-only display).
- "Tác vụ" column drop on detailed-plan — that is `a6cb2543`.
- Approval / request flows — that is `18f4a2dd`.
- Driver mobile UI reorder — that is `365943ea`.
- FORWARDER / DRIVER / ACCOUNTANT / CUS mutation rights on detailed-plan assignment (read-only views remain whatever they were before).

## Acceptance criteria

> All UI verifications are rung 3 (`UI DRIVEN`); API verifications are rung 2 (`DB/API VERIFIED`) but the UI side of each is rung 3.

### TC-DDP-001 — Display parity: every container of the selected day is rendered

- **Given** ĐIỀU VẬN logged in on staging; a date D with **N total containers** in the DB (assigned + unassigned) — for example a date seeded with 8 assigned + 4 unassigned = 12 total
- **When** they open the detailed-plan for date D
- **Then**:
  - The table / list renders exactly **N rows** (12 in the example above)
  - The pre-fix count was the assigned-only count (8 in the example); post-fix is N
  - No row is collapsed, filtered out, or hidden by sort / pagination default
- **Assert:**
  - `browser_evaluate(() => document.querySelectorAll('[data-testid="dispatch-detail-row"], .dispatch-detail-row, tr[data-container-id]').length)` returns N
  - `SELECT COUNT(*) FROM shipment_containers sc JOIN shipments s ON s.id = sc.shipment_id WHERE s.planned_date = 'D'` returns N
  - The two numbers match
- **Evidence:**
  - `qa/2026-09-10_dispatch-detailed-plan_ui-001-pre.png` (master-plan only, 8 rows — bug state)
  - `qa/2026-09-10_dispatch-detailed-plan_ui-001-post.png` (detailed-plan all 12 rows — fix state)
  - `qa/2026-09-10_dispatch-detailed-plan_db-001-count.sql`

### TC-DDP-002 — Unassigned containers visible with a clear "Chưa phân nhà xe" state

- **Given** date D contains at least one container with `carrier_id IS NULL` (or equivalent unassigned marker)
- **When** ĐIỀU VẬN opens the detailed-plan for D
- **Then**:
  - The unassigned container row is rendered, not hidden
  - The row carries a visible state label — exact copy is implementation-defined but must be discoverable in Vietnamese context (e.g. "Chưa phân nhà xe", "Chưa phân công", or equivalent). The implementer chooses the label and the testplan locks it in.
- **Assert:**
  - `browser_evaluate(() => Array.from(document.querySelectorAll('[data-testid="dispatch-detail-row"]')).filter(r => /Chưa phân|unassigned/i.test(r.innerText)).length)` ≥ 1
  - DOM has at least one node containing the chosen unassigned-state text
- **Evidence:**
  - `qa/2026-09-10_dispatch-detailed-plan_ui-002-unassigned.png`

### TC-DDP-003 — Assign a carrier at the detailed-plan level (unassigned → assigned)

- **Given** ĐIỀU VẬN logged in; an unassigned container row visible at the detailed-plan for D (from TC-DDP-002)
- **When** they click the row → open the carrier-picker (existing UI shape; the picker is already used on master-plan) → choose a carrier C → save
- **Then**:
  - The row updates to show C as the carrier, with the assigned state
  - The `carrier_id` (or equivalent) field in the DB is updated to C
  - An audit row is appended to `shipment_carrier_history` (or equivalent) recording the assignment (actor = current dispatcher, container_id, carrier_id, action = 'ASSIGN' or equivalent)
- **Assert:**
  - `browser_evaluate` returns the carrier label on the saved row
  - API `PUT /api/dispatch/containers/:id/carrier` (or equivalent) returns 200 with `{ carrierId: C, updatedAt: <now> }`
  - DB query: `SELECT id, carrier_id, updated_at FROM shipment_containers WHERE id = $1` returns the new carrier_id
  - DB query: `SELECT * FROM shipment_carrier_history WHERE shipment_container_id = $1 ORDER BY created_at DESC LIMIT 1` returns a new row with action='ASSIGN' and the dispatcher as actor
- **Evidence:**
  - `qa/2026-09-10_dispatch-detailed-plan_ui-003-picker.png`
  - `qa/2026-09-10_dispatch-detailed-plan_ui-003-assigned.png`
  - `qa/2026-09-10_dispatch-detailed-plan_api-003.log`
  - `qa/2026-09-10_dispatch-detailed-plan_db-003.sql`

### TC-DDP-004 — Reassign a carrier at the detailed-plan level (carrier A → carrier B)

- **Given** ĐIỀU VẬN logged in; a container previously assigned to carrier A (from TC-DDP-003 or seeded)
- **When** they open the same row → picker → choose carrier B (different from A) → save
- **Then**:
  - The row updates to show B as the carrier
  - The DB `carrier_id` is updated to B
  - The audit history has TWO rows: action='ASSIGN' to A (or REASSIGN with prior_carrier_id=A) and action='ASSIGN' to B
- **Assert:**
  - DOM shows the new carrier B label on the saved row
  - API returns 200, body has `carrierId: B`
  - DB query on history returns 2 rows for the container, ordered by `created_at`
- **Evidence:**
  - `qa/2026-09-10_dispatch-detailed-plan_ui-004-reassign.png`
  - `qa/2026-09-10_dispatch-detailed-plan_api-004.log`
  - `qa/2026-09-10_dispatch-detailed-plan_db-004.sql`

### TC-DDP-005 — Role gating: only ĐIỀU VẬN sees the assign/reassign control

- **Given** the staging environment, same date D, same container rows
- **When** QA logs in as **CUS** (`canon-cs`) and opens the detailed-plan view (or its CUS-equivalent route)
- **Then**:
  - The carrier-picker / assign control is **not** visible to CUS
  - If CUS attempts the underlying API call directly (`curl -X PUT …` with CUS bearer token), the server returns **403** (or 404 if the route is dispatcher-only)
- **Assert:**
  - `browser_evaluate(() => document.querySelectorAll('[data-testid="dispatch-detail-assign-button"]').length)` returns 0 as CUS
  - `curl -X PUT …/containers/:id/carrier -H "Authorization: Bearer $CUS_TOKEN"` → 403
- **Evidence:**
  - `qa/2026-09-10_dispatch-detailed-plan_ui-005a-cus-no-button.png`
  - `qa/2026-09-10_dispatch-detailed-plan_api-005.log`

### TC-DDP-006 — No regression on master-plan overview

- **Given** ĐIỀU VẬN logged in on staging; the same date D
- **When** they open the master-plan (overview) screen for D
- **Then**:
  - The master-plan still shows the assigned-only count (unchanged from the pre-fix state)
  - No new columns, no new controls leaked from the detailed-plan fix
- **Assert:**
  - Master-plan row count = assigned count (not N)
  - No `data-testid="dispatch-detail-*"` attributes appear in the master-plan DOM
- **Evidence:**
  - `qa/2026-09-10_dispatch-detailed-plan_ui-006-master-plan.png`

### TC-DDP-007 — No regression on other dispatcher flows

- **Given** staging
- **When** QA exercises the dispatch list, master-plan actions, and other dispatcher screens as ĐIỀU VẬN
- **Then**:
  - Screens load, no console errors, no broken layouts
  - The `a6cb2543` tag-list change (if already merged) renders correctly on the detailed-plan and master-plan both
- **Assert:**
  - `browser_get_logs()` returns no red entries during navigation
  - The 14-tag list (per `a6cb2543` testplan) appears in the operation picker where applicable
- **Evidence:**
  - `qa/2026-09-10_dispatch-detailed-plan_ui-007-no-regression.png`
  - `qa/2026-09-10_dispatch-detailed-plan_ui-driver.log`

### TC-DDP-008 — Carrier-less row: auto-load own-fleet + promote-to-OWN on save (cycle-2)

- **Given** ĐIỀU VẬN logged in on staging; date D contains at least one row with `dispatch.carrierType IS NULL` (the new carrier-less state surfaced by the `8afc13a9` patch)
- **When** ĐIỀU VẬN opens the carrier-less row → opens the edit dialog
- **Then**:
  - The "Xe / biển số" combobox is **pre-loaded with the own-fleet TRUCK list** WITHOUT requiring a prior carrier pick (the new auto-load behavior; ticket 8afc13a9 cycle-2, Option B).
  - Picking any SilverSea truck promotes the row to OWN carrier so the "Lưu thay đổi" save passes (post-save label = "SilverSea — xe nội bộ").
- **Assert:**
  - On dialog open, before any carrier click, the TRUCK list API has been called: `curl` or `browser_evaluate` confirms at least one SilverSea plate option present in the combobox.
  - After picking a truck and saving, the saved row carries `carrierType: 'OWN'` and `carrierName: 'SilverSea'` (probe `dispatch.carrierType` field in the rendered row, not just label).
- **Evidence:**
  - `qa/2026-09-10_dispatch-detailed-plan_ui-008a-auto-load.png` (dialog pre-click, trucks already populated)
  - `qa/2026-09-10_dispatch-detailed-plan_ui-008b-promoted.png` (post-save OWN label)
  - `qa/2026-09-10_dispatch-detailed-plan_api-008.log`

### TC-DDP-009 — Fleet-fetch failure surfaces a retry affordance (regression for the silent-empty swallow)

- **Given** ĐIỀU VẬN opens a row in the edit dialog
- **When** the fleet API returns 500 for `TRUCK` or `EXTERNAL_VEHICLE` resources (dev backend stub returns 500)
- **Then**:
  - The dialog shows "Không tải được danh sách nhà xe." (carrier load) OR "Không tải được danh sách xe." (vehicle load) with a `Thử lại` button.
  - The empty list is NOT silently rendered — the user sees the error message, not a misleading "Không tìm thấy xe phù hợp." empty state.
  - Clicking `Thử lại` after the endpoint recovers re-runs the load and clears the error.
- **Assert:**
  - `browser_evaluate(() => /Không tải được|Thử lại/.test(document.body.innerText))` returns true under the forced-failure.
  - Click `Thử lại`, restore the endpoint, confirm the TRUCK list reappears and the error block disappears.
- **Evidence:**
  - `qa/2026-09-10_dispatch-detailed-plan_ui-009a-error.png`
  - `qa/2026-09-10_dispatch-detailed-plan_ui-009b-retry-ok.png`

## QA gates required (run before push)

```
pnpm lint                                                        # 0 errors
cd backend && npx tsc --noEmit                                   # 0 errors (no BE change expected, but verify nothing leaked)
cd backend && pnpm test                                          # all pass
cd frontend && npx tsc -b                                        # 0 errors
cd frontend && pnpm test                                         # all pass (including new tests for TC-DDP-003 / TC-DDP-004 / TC-DDP-008 / TC-DDP-009 if added)
make build                                                       # succeeds
```

The chunk commit must push per-chunk (commit+push after every task rule). After push, qa runs the gate on **staging first**; if green, PM authorises the next ticket.

- **Evidence:** `qa/2026-09-10_dispatch-detailed-plan_gates.log`

### G-mig — migration hash check (wave gate, pm Amendment 2 2026-09-10)

After every migrate on staging AND prod, verify `__drizzle_migrations` carries hash prefix `2d8af75377` (0067, the chunk-7 supersede migration):

```sql
SELECT id, hash, created_at FROM drizzle.__drizzle_migrations
WHERE hash LIKE '2d8af75377%' ORDER BY id DESC LIMIT 1;
```

- If **MISSING** on staging post-cut: HARD STOP, ping pm; do not hand-patch.
- If **MISSING** on prod post-deploy: HARD STOP, ping pm; user explicit approval required through pm.

Evidence: `qa/2026-09-10_dispatch-detailed-plan_g-mig.log` (psql output per env).

## Verification protocol

1. **Auth flow** — login as ĐIỀU VẬN via the harness `ctx.login('DISPATCHER')`; for TC-DDP-005 log in as CUS.
2. **API probes** — `curl` with bearer token; capture full request + response to `qa/..._api-XXX.log`.
3. **UI probes** — `browser_evaluate` for row count + control presence, `browser_screenshot` per surface.
4. **DB probes** — through `/api/...` endpoints preferred (drizzle ORM only rule applies to application behaviour, not qa inspections). psql only for the audit-history TC-DDP-003 / TC-DDP-004.
5. **No raw SQL in test scripts** — qa inspection lines live in `.sql` artifacts for reproducibility.

## Evidence bundle

```
qa/
├── 2026-09-10_dispatch-detailed-plan_ui-001-pre.png
├── 2026-09-10_dispatch-detailed-plan_ui-001-post.png
├── 2026-09-10_dispatch-detailed-plan_ui-002-unassigned.png
├── 2026-09-10_dispatch-detailed-plan_ui-003-picker.png
├── 2026-09-10_dispatch-detailed-plan_ui-003-assigned.png
├── 2026-09-10_dispatch-detailed-plan_ui-004-reassign.png
├── 2026-09-10_dispatch-detailed-plan_ui-005a-cus-no-button.png
├── 2026-09-10_dispatch-detailed-plan_ui-006-master-plan.png
├── 2026-09-10_dispatch-detailed-plan_ui-007-no-regression.png
├── 2026-09-10_dispatch-detailed-plan_ui-008a-auto-load.png
├── 2026-09-10_dispatch-detailed-plan_ui-008b-promoted.png
├── 2026-09-10_dispatch-detailed-plan_ui-009a-error.png
├── 2026-09-10_dispatch-detailed-plan_ui-009b-retry-ok.png
├── 2026-09-10_dispatch-detailed-plan_ui-driver.log
├── 2026-09-10_dispatch-detailed-plan_api-003.log
├── 2026-09-10_dispatch-detailed-plan_api-004.log
├── 2026-09-10_dispatch-detailed-plan_api-005.log
├── 2026-09-10_dispatch-detailed-plan_api-008.log
├── 2026-09-10_dispatch-detailed-plan_db-001-count.sql
├── 2026-09-10_dispatch-detailed-plan_db-003.sql
├── 2026-09-10_dispatch-detailed-plan_db-004.sql
├── 2026-09-10_dispatch-detailed-plan_gates.log
├── 2026-09-10_dispatch-detailed-plan_g-mig.log
└── 2026-09-10_dispatch-detailed-plan_gate.txt
```

## Pass criteria

PASS iff TC-DDP-001 through TC-DDP-009 ALL hold on **staging first** (local-only run is a smoke test). Any TC FAIL on staging is a cycle FAIL with `fix-and-re-run` block appended to the failing artifact; PM relays to fullstack.

## Linked artifacts

- Ticket: `8afc13a9` (kanban, todo)
- Companion specs in this cycle: `testplan/qa/2026-09-10_approval-removal-chunk4.md`, `testplan/qa/2026-09-10_driver-mobile-ui.md`, `testplan/qa/2026-09-10_replace-tags.md`
- Memory: [[prd-roadmap-and-decisions]] (O2C business flow), [[frontend-architecture]] (api/hook patterns)
- Audit memory: `load-failure-retry-duplication` (cycle-1 custom finding; TC-DDP-009 covers the editor's instance)

## Anti-lying guardrails

- "Detailed-plan shows all containers now" without a row-count assert = rung 1. TC-DDP-001 requires the row count = DB count match.
- TC-DDP-002 unassigned label is the implementer's choice but the testplan locks it in: once chosen, the testplan MUST be updated to match the literal text. Mismatch = BLOCKED.
- TC-DDP-003 / TC-DDP-004 require DB-side proof (carrier_id + history row), not just the UI row appearance.
- TC-DDP-005 must test BOTH the UI (no button) and the API (403). UI-only is rung 1.
- TC-DDP-006 / TC-DDP-007 are non-negotiable: a fix that introduces a regression on master-plan or other dispatcher flows fails the ticket.
- TC-DDP-008: "TRUCK list shows up" without a probe before any carrier click = rung 1. The auto-load is the requirement; clicking any carrier first would mask the bug.
- TC-DDP-009: "retry button works" without the forced-failure assertion = rung 1. The whole point is that the silent-empty swallow is gone.

## What is NOT covered (be honest)

- Mobile viewport — detailed-plan is desktop-first; if a mobile surface exists for dispatchers, list it in a future cycle.
- FORWARDER / DRIVER / ACCOUNTANT views on the same detailed-plan — covered by TC-DDP-005 only for the assign-control visibility; full read-only behaviour for those roles is out of scope.
- Concurrency on simultaneous assign / reassign — out of scope (existing optimistic-lock semantics preserved).
- The `a6cb2543` tag-list change — out of scope here; covered by its own testplan. Confirmed disjoint at pathspec time.
- Staging rollback path — listed in "Not covered" deliberately. ADMIN rollback is a deploy-owner responsibility, not a per-ticket verification.
