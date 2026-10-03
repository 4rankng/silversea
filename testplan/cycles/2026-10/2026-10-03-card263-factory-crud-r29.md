# Regression spec — card 20261002_263 R29 factory CRUD for Chứng từ + Điều vận

**Ticket:** 20261002_263 (R29: Chứng từ/Điều vận manage the factory catalog end to end)
**Owner (implement):** backend (this spec's TC-263-001..004); frontend half tracked on the card
**Owner (verify):** qa
**Status (this doc):** PREP — ready to execute when the BE half lands + next staging cut
**Cycle:** 2026-10 wave

## Goal

R29 grants Chứng từ (Role.CUS) and Điều vận (Role.DISPATCHER) full CRUD on the
factory/warehouse catalog. Read/edit/create grants pre-existed; this wave adds the
missing DELETE (`/operational-sites/:id`) plus the two Casbin action rows
(`CUS|DISPATCHER, shipments, delete`) the mount gate requires. Delete is soft
(deleted_at) with a live-shipment reference guard (409 + VN message), and every other
role's matrix is unchanged — all five DELETE leaves on the shipments mount keep their
explicit requireRoles guards.

## Out of scope

- The FE half: CUS nav entry + delete affordance (tracked on the card; kanban-fe).
- D01 (no CUS price-list access) — pricing routes are not edited in this wave; the
  suite pins the guard family unchanged by construction (no policy row touches `config`).

## Acceptance criteria

> API criteria are rung 2 (DB/API VERIFIED); UI criteria are rung 3 (UI DRIVEN) and
> ride the card's staging QA.

### TC-263-001 — R29 read+edit matrix through the real mount (regression guard)

- **Given** staging/local at the wave's cut with the two new Casbin rows landed
- **When** CUS and DISPATCHER call GET /api/shipments/operational-sites/admin and
  PATCH /operational-sites/:id; ACCOUNTANT calls GET
- **Then** CUS/DISPATCHER 200; ACCOUNTANT 403 (existing grants, now pinned by suite
  backend/src/tests/operational-site-admin-crud.test.ts)
- **Assert:** `TZ=UTC node backend/scripts/test-isolated.mjs --filter operational-site-admin-crud`
- **Evidence:** qa/2026-10-03_card263-green.log

### TC-263-002 — DELETE allowed for the R29 roles, blocked elsewhere

- **Given** the same suite; a fixture site free of shipment references
- **When** DELETE /api/shipments/operational-sites/:id as CUS / DISPATCHER → 200 {ok:true};
  as ACCOUNTANT / OPS / DRIVER → 403
- **Then** deleted_at stamped; row leaves the admin list
- **Assert:** suite test 'DELETE works for Chứng từ and Điều vận' + 'DELETE stays blocked'
- **Evidence:** qa/2026-10-03_card263-green.log

### TC-263-003 — Delete semantics: replay-safe, re-creable, guard

- **Given** the same suite
- **When** replay DELETE (row gone) → 404; POST same (customerId, code) → 201 (partial
  unique index only covers live rows); DELETE a site a live shipment references → 409
  with a /lô hàng/ message; row NOT stamped
- **Then** the catalog tolerates deletes without ever losing history
- **Assert:** suite tests 'DELETE is replay-safe...' + 'a live shipment reference refuses...'
- **Guard:** the 409 guard queries live shipments only — historical shipments keep their
  integer pointers, and the list joins match by id without a deletedAt filter
- **Evidence:** qa/2026-10-03_card263-green.log

### TC-263-004 — The mount gate is the only new grant surface (no drift)

- **Given** the two policy rows `CUS|DISPATCHER, shipments, delete` are the ONLY policy
  change; every DELETE leaf on the shipments mount keeps its requireRoles guard
- **When** the full-path matrix suite runs against the real enforcer + real policy.csv
  (initEnforcer reads the shipped policy.csv)
- **Beyond the five leaves:** shipments delete (ADMIN/MANAGER), cus-workspace delete
  (CUS only), dispatch-task-tags (ADMIN/MANAGER/DISPATCHER), declarations delete
  (R29 set) — none of their cells change
- **Then** zero drift beyond the intended cells; D01 intact (no `config` policy row touched)
- **Assert:** the suite boots the real enforcer against the shipped policy.csv; the
  guard audit is recorded on the card
- **Evidence:** qa/2026-10-03_card263-green.log, card docx evidence block

<!-- Everything below is the shared harness contract from testplan/qa/_TEMPLATE.md -->
