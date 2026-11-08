# Regression spec — SIL-752 / SIL-753 fabricated facts on trip page + dispatch row

**Ticket:** SIL-752 (trip page shows RƠ MOÓC 40FT with no trailer) + SIL-753 (row shows 'SilverSea / Chưa phân xe' after Hủy phân xe)
**Owner (implement):** fullstack
**Owner (verify):** qa
**Status (this doc):** PREP — regression guard for the fix landing on fix/k15-trailer-cancel
**Cycle:** 2026-11

## Goal

Two sibling defects of the same class: a UI fact is FABRICATED when no backing data exists.
SIL-752: the trips read layer coerces a null `trips.trailer_type` into the literal '40FT'
(`shapeTripRelations`), so an external dispatch-issued trip (no trailer, no truck) renders
RƠ MOÓC = 40FT while Container & Seal reads 20'DC. SIL-753: the detailed-plan read layer
derives carrierName = 'SilverSea' for every OWN fulfillment, including the post-cancel
shape (OWN + no plate + no live trip = the stored shape of "chưa phân xe"), so the ĐIỀU
PHỐI cell renders a carrier that does not exist. Rule: khi không có rơ moóc / không có
phân xe, hiển thị để trống ('—' / 'Chưa phân xe') — không bịa dữ liệu.

## Out of scope

- Write-side defaults (`trip-create.service.ts:361`, `trip-lifecycle-ops.service.ts:210`
  `|| '40FT'`): they feed the roadAllowance pricing snapshot for OWN trips with a real
  tractor — financial behavior, separate decision.
- SIL-751 (lot stays DISPATCHED after cancel) — tracked separately.
- CUS workspace / master-plan carrier identity (`cus-workspace-builders`) and shipment
  list carrier facets — different surfaces, same question, not reported here.

## Acceptance criteria

### TC-SIL752-001 — no trailer ⇒ no moóc type on trip detail

- **Given** trip with `trailer_id = null`, `trailer_type = null` (e.g. external dispatch issue, plate 'Bổ sung sau')
- **When** GET /api/trips/:id, then open /trips/:id 'Thông tin cơ bản'
- **Then** RƠ MOÓC renders '—' (empty fact), never a fabricated size
- **Assert:** API payload `trailerType === null`, `trailer` absent; UI row shows '—'
- **Evidence:** unit test `trip-queries` shaping + qa/ artifacts

### TC-SIL752-002 — trailer present ⇒ real plate · type

- **Given** trip with a resolved trailer
- **When** trip detail read
- **Then** RƠ MOÓC = `<plate> · <type>` unchanged (no regression on assigned rows)

### TC-SIL753-001 — Hủy phân xe ⇒ ĐIỀU PHỐI shows only 'Chưa phân xe'

- **Given** lot assigned to external carrier 4GS, dispatched (chuyến issued)
- **When** ⋯ → Hủy phân xe → confirm
- **Then** detailed-plan row: carrier line 'Chưa phân xe' (placeholder), no 'SilverSea', no duplicate line — including the optimistic patch right after the confirm (the savePlan response echoes carrierName null for a plate-less OWN save; no fabricated flash before the refetch)
- **Assert:** API row `dispatch.carrierName === null` while `carrierType === 'OWN'`, plate null, no live trip; savePlan response payload same law

### TC-SIL753-002 — OWN row with plate keeps its fleet label

- **Given** OWN fulfillment with planned plate
- **When** detailed-plan row renders
- **Then** carrier line 'SilverSea' + plate visible (regression guard for assigned rows)
