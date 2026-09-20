---
type: Reference
title: "Architecture and Codebase Map"
description: "System-level map of SilverSea's backend, frontend, shared contracts, persistence, QA, and operational boundaries. Traces dispatch planning (multi-day allocation, external-trip staff close), the CUS workspace, shipment settlement and debit notes (Chi phí – Quyết toán) including the shared business-key display layer, and fuel-surcharge pricing through validated APIs and transactional services. Reflects the 2026-09-20 post-cut-14 state of origin/prod (7aedcfed): billing-issue readiness gate, fuel-preview MANUAL reasons, the zero-vs-missing display contract, the two-row 12-column filter grid, icon-only action columns, in-dropdown row creation, three-role workboard quick-edit (CUS/ADMIN/DISPATCHER), and both note fields editable under the accounting lock."
tags: [architecture, dispatch, contracts, testing, operations]
verified:
  - by: openwiki/0.5.0
    at: 2026-09-20T13:43:19.777Z
sources:
  - id: openwiki-source-8037e2358a2c4f9b2c722a11
    resource: repo://AGENTS.md
  - id: openwiki-source-140d3d74c1896e4779866932
    resource: repo://backend/drizzle/0000_flexible-baseline.sql
  - id: openwiki-source-9a7277933ab0110af5cb7cbe
    resource: repo://backend/package.json
  - id: openwiki-source-e9e879d7129d1316457b3c7b
    resource: repo://backend/src/middleware/material-write.ts
  - id: openwiki-source-22287984c48f175c9111b39c
    resource: repo://backend/src/routes/shipments/core.routes.ts
  - id: openwiki-source-7633dc761224043313afe6c1
    resource: repo://backend/src/routes/shipments/dispatch-planning.routes.ts
  - id: openwiki-source-137a747b8b837eb52cb71981
    resource: repo://backend/src/routes/trips/status.ts
  - id: openwiki-source-6ee9d82604a0a878f2bd4f58
    resource: repo://backend/src/seed/seed-demo-freight-pricing.ts
  - id: openwiki-source-a08d0826dadf2aa659264512
    resource: repo://backend/src/services/aging.service.ts
  - id: openwiki-source-10e4db2d245bc653bfb84cab
    resource: repo://backend/src/services/billing-document-governance.service.ts
  - id: openwiki-source-86b278930bf8667e24b587f6
    resource: repo://backend/src/services/cus-workspace-builders.service.ts
  - id: openwiki-source-b783cbfcbb631c4f9e488edc
    resource: repo://backend/src/services/dispatch-planning-detail-plan.service.ts
  - id: openwiki-source-07d8d0b4bd1aa611aec4651d
    resource: repo://backend/src/services/dispatch-task-tags.service.ts
  - id: openwiki-source-a3a0a1921d5309133aa9d113
    resource: repo://backend/src/services/freight-pricing-engine.service.ts
  - id: openwiki-source-3aa37080f2fc30dc35478ecb
    resource: repo://backend/src/services/pricing.service.ts
  - id: openwiki-source-277912ce7743608f9e00b0cf
    resource: repo://backend/src/services/shipment-containers.service.ts
  - id: openwiki-source-74f75edc280b913e369ea0fe
    resource: repo://backend/src/services/shipment-debit-detail.service.ts
  - id: openwiki-source-6bbe3d8292f04ae241cde05c
    resource: repo://backend/src/services/shipment-debit-summary.service.ts
  - id: openwiki-source-95f1cc71c37cefdade7ef7bf
    resource: repo://backend/src/services/shipment-update.service.ts
  - id: openwiki-source-69663e0b3d165a9d5d1ceca1
    resource: repo://backend/src/services/trip-external-close.service.ts
  - id: openwiki-source-c6551d55e5de7de94ecf32ca
    resource: repo://backend/src/services/trip-queries.service.ts
  - id: openwiki-source-15eb9c2bd185a2889b65874f
    resource: repo://backend/src/tests/dispatch-detail-plan.test.ts
  - id: openwiki-source-22f3807e21b8281a0a2994f6
    resource: repo://backend/src/tests/dispatch-task-tags.service.test.ts
  - id: openwiki-source-7c110e1f554a6edd95993c36
    resource: repo://docs/prd/PhuongAnTinhCuocTuDong.md
  - id: openwiki-source-0047c2597980e18b4470c62d
    resource: repo://docs/prd/QuyTrinhO2C.md
  - id: openwiki-source-1047363cf615000e4c9bb694
    resource: repo://frontend/package.json
  - id: openwiki-source-454c9bcdde0b77b35e0fc994
    resource: repo://frontend/src/App.tsx
  - id: openwiki-source-472ad1b590b610500099dded
    resource: repo://frontend/src/components/confirm-dialog.tsx
  - id: openwiki-source-8983de0d62b7ad43b88fe8ed
    resource: repo://frontend/src/components/shared/StaleBuildBanner.tsx
  - id: openwiki-source-b2f0a15746f0cff9934d9148
    resource: repo://frontend/src/components/UI.css
  - id: openwiki-source-65b39f1208bfc596ca936ff0
    resource: repo://frontend/src/components/UI.overlay.test.tsx
  - id: openwiki-source-07b8e2add53a179335ec3d8b
    resource: repo://frontend/src/design-system/EmptyState.tsx
  - id: openwiki-source-aa11da64ee9879d38bc2a7fb
    resource: repo://frontend/src/design-system/forms/DateTimeSegments.css
  - id: openwiki-source-d99f57ac8730cbefb9347920
    resource: repo://frontend/src/features/dispatch/catalogs/FleetDriversView.tsx
  - id: openwiki-source-c2b24497935143d8246afc05
    resource: repo://frontend/src/features/dispatch/master-plan/allocationDayHelpers.ts
  - id: openwiki-source-564940d299e8b46bece798bc
    resource: repo://frontend/src/features/dispatch/master-plan/DispatchAllocationDaySection.tsx
  - id: openwiki-source-38dccf151d65378ca3cdc49f
    resource: repo://frontend/src/features/dispatch/master-plan/DispatchAllocationPopover.tsx
  - id: openwiki-source-e629bb1d867391a312ae3e80
    resource: repo://frontend/src/features/shipments/create/FreightPreviewCard.tsx
  - id: openwiki-source-71a326847137afbebdb7c372
    resource: repo://frontend/src/features/shipments/create/uui-searchable-field.tsx
  - id: openwiki-source-9b47a81d8349af3735aeaff8
    resource: repo://frontend/src/features/shipments/cus/CusShipmentRow.tsx
  - id: openwiki-source-a39f35618da371aac500abf1
    resource: repo://frontend/src/features/shipments/detail/ShipmentContainerLedger.tsx
  - id: openwiki-source-9f3012bd7b3b7e37fa71ae81
    resource: repo://frontend/src/features/trips/tripColumns.tsx
  - id: openwiki-source-3cd8eec45a7d817a3965fbd2
    resource: repo://frontend/src/hooks/useBuildFreshness.ts
  - id: openwiki-source-79395e5dd2432d131123d5c9
    resource: repo://frontend/src/lib/chunk-error.ts
  - id: openwiki-source-a6f1236afb85bf62c18f5389
    resource: repo://frontend/src/pages/config/FuelPricePeriodsConfigPage.tsx
  - id: openwiki-source-e91ca5eb093baa7f2c484a34
    resource: repo://frontend/src/pages/finance-derived.ts
  - id: openwiki-source-8563d5234cbb0742f6b8d8a3
    resource: repo://frontend/src/pages/ShipmentContainersPage.css
  - id: openwiki-source-2df1e682c7dcb9ba56509847
    resource: repo://frontend/src/styles/font-family-contract.test.ts
  - id: openwiki-source-316dfb4c2b43d4800b46fd34
    resource: repo://frontend/src/tests/structure.guard.test.ts
  - id: openwiki-source-15e64fbca55f9b222f340423
    resource: repo://scripts/githooks/pre-commit
  - id: openwiki-source-592889025dfa2f31c9e5bba0
    resource: repo://shared/package.json
  - id: openwiki-source-b2fbadbe08a5df4d9cfca2ed
    resource: repo://shared/src/calculations/fuelSurcharge.ts
  - id: openwiki-source-5fdaee04264279630f2bb947
    resource: repo://shared/src/calculations/round.ts
  - id: openwiki-source-f7fd2de8ba29e8649d8291fb
    resource: repo://shared/src/calculations/tripTotals.ts
  - id: openwiki-source-ff09d8d8bdd90f494973e136
    resource: repo://shared/src/schemas/cus-shipment-workspace.ts
  - id: openwiki-source-b650eeedb63cbb73aa890ab2
    resource: repo://shared/src/schemas/index.ts
  - id: openwiki-source-f89b776b27b18792107af8c0
    resource: repo://shared/src/schemas/shipment-debit-edits.ts
generated: { by: "claude-code", at: "2026-09-20T13:43:19.777Z" }
---

# Architecture and Codebase Map

> Related: [Overview](overview.md) · [Quickstart](quickstart.md) · Roles: `AGENTS.md` · Domain flows: `docs/prd/QuyTrinhO2C.md`

## System boundaries

SilverSea is a pnpm monorepo: `backend/` (Express + TypeScript), `frontend/` (React + Vite), `shared/` (`@tingting/shared`), plus `testplan/` (role-based QA flows), `docs/prd/` (canonical product specs), and `openwiki/` (generated repository knowledge). The local runtime uses Postgres and Redis; the production application is reached through the deployment files rather than through the development stack.

- **Backend** owns authenticated HTTP routes, role checks, business services, persistence, and integration tests. Drizzle ORM is the database access boundary; services compose queries and write commands rather than exposing database details to the frontend.
- **Frontend** owns route screens and feature modules. Dispatch is split into master-plan and detailed-plan surfaces, with API clients and React Query hooks between the screens and the HTTP API.
- **Shared** owns Zod contracts, shared enums, navigation vocabulary, and financial calculations. Cross-package schema changes require rebuilding `shared/` before backend tests that import its compiled package.
- **QA and product contracts** are first-class boundaries: `testplan/` contains role-based acceptance cases, `docs/prd/` contains current business rules, and focused unit/integration tests pin the contracts at the package that owns them.

## Dispatch planning flow

The dispatch UI has two complementary read models. The master plan groups shipment rows for operational allocation; the detailed plan exposes one row per fulfillment for filtering and editing. Both consume the dispatch planning client and backend route family, while the backend services build the authoritative view from shipments, fulfillments, appointments, ports, trips, and active pairs.

1. The master-plan grid renders one schedule block per container appointment and can restrict blocks to a selected business date. Its port columns aggregate container-type counts by pickup/dropoff pair so per-day appointment splits do not produce duplicate demand lines. When appointment groups are unavailable, the grid uses the shipment-level fallback fields.
2. The detailed-plan client requests paginated rows with direction, assignment, port, delivery-point, hour, and dispatch-zone filters. The backend validates IDs, time formats, zone length, and allowed enum values before the service builds a stable priority order and applies the same filters to rows and totals. The detail-plan row carries a `taskStatus` of `'READY' | 'DISPATCHED' | 'COMPLETED'`, so the grid can render a finished chip the moment a trip's external-carrier staff close fires.
3. Single-save edits flow through the atomic plan endpoint: carrier, vehicle, estimates, classification, and the optional driver note commit together or not at all, guarded by both row versions. The dispatcher-owned classification is persisted while the lot-level combined flag is CUS-owned and stripped at the route. On a successful save the editor modal closes and focus is restored to the trigger button so the dispatcher can re-open with a single keyboard action (`a6e68a91`); regression case TC-DV-DISPATCH-048 / TC-DISPATCH-EDIT-002 pins this behavior with evidence under `testplan/qa/evidence/2026-09-09_TC-DISPATCH-EDIT-002/`.
4. The detailed-plan editor mounts a shared note composer that drives a global tag pool (`listDispatchTaskTags` / `createDispatchTaskTag` / `updateDispatchTaskTag` / `deactivateDispatchTaskTag` in `dispatchPlanningClient.ts`), validates labels (length, separator safety, NFC normalization), and exposes soft-delete with an active/inactive re-resurrection path so historical notes keep their text.
5. Carrier-allocation edits in the master plan split demand by packing/return day (`DispatchAllocationDaySection` + `allocationDayHelpers`), validate against the per-day demand, and save through a partial-save endpoint that echoes the persisted row back to the grid. The dialog rebuild groups rows by day, surfaces per-day totals, and the inline edit dropdown collapses back to a compact view when the user dismisses the popover.
6. External-carrier staff close (`completeDispatchExternalTrip` in `dispatchPlanningClient.ts`, served by `trip-external-close.service.ts`): when an external driver does not run the driver app, dispatch or CUS confirm completion from the detail-plan row. The row flips `taskStatus` to `'COMPLETED'` and the same `transitionTripStatus` machinery used by the driver close fires, so revenue/AP/AR post and ledger snapshots stay consistent.
7. A partially-dispatched lot keeps its remaining `READY` rows re-assignable in both the carrier-fleet reassign path and the detail-plan save path; only terminal statuses (`COMPLETED`, `CANCELED`) block further carrier changes. This mirrors the issuance-side fix that flips a lot to `DISPATCHED` on the first issued container, so dispatch can plan the rest of the lot without stranding it.
8. Long operational notes in the master plan render with truncation plus a `MasterPlanNoteModal` popup so a dense row never overflows its cell. The modal preserves the existing edit affordance and is keyboard-accessible.

## CUS workspace read model

The CUS workspace exposes two complementary views of the same shipment list. The overview endpoint projects the document- and customer-centric columns the CUS workboard needs; the container endpoint adds the per-container schedule and dispatch state used by the detail screen.

- Both endpoints reject filters the other endpoint owns (a detail-only `dispatchStatus` filter is rejected on the overview), so a stale or misrouted filter cannot silently no-op.
- The list item contract carries `effectiveFactoryNames`, `appointmentGroups`, and per-container port groups so downstream surfaces can render multi-factory lots, per-day schedules, and per-day port demand without an extra round trip.
- The CUS dispatch-status chip vocabulary is now a five-state taxonomy (`AWAITING_VEHICLE`, `PLANNED`, `CREATED`, `IN_TRANSIT`, `COMPLETED`); the legacy coarse `ASSIGNED`/`UNASSIGNED` aliases remain accepted by the container endpoint so older links keep filtering.
- A CUS ledger container row stays at `PENDING_DATE` until every container in the FCL lot has its own `customerAppointmentAt`; clearing the last appointment of a lot that already moved to `READY_FOR_DISPATCH` is rejected with 409 so the workboard's "Chưa chốt ngày" warning can never silently clear.
- The shared contract is the single source of truth for filter shapes, sort keys, and the chip vocabulary; backend services and frontend hooks both import from the same package.
- The detail-screen container ledger has inline per-row `Xác nhận` (confirm) and `Revert` actions, with success/error toasts and Enter/Escape handling, so the user no longer has to press Enter or hunt for the header "Hoàn tất" button after typing a container appointment. Inline draft editors dismiss via `useClickOutside` so the row state stays consistent on accidental focus loss.
- The detail-screen schedule editor accepts the appointment in a `giờ`-first layout with 24-hour inputs (`ShipmentContainerScheduleEditor`), so the user enters the time closingAt/plannedReturnAt the same way it is read on the workboard and the typed surface can parse the typed value back deterministically.
- **Workboard quick-edit contract (2026-09-20 evening, cards _49/_51):** quick-edit of the schedule and notes cell groups on Tổng quan lô hàng opens to CUS, ADMIN, and DISPATCHER — `transportDateEditable` is the CUS/ADMIN/DISPATCHER && !locked clause, and `shipmentFieldAccess` grants those three roles DIRECT on the four schedule/notes keys (`closingAt`, `plannedReturnAt`, `customerNotes`, `operationalNotes`) before any lock check; other cell groups and MANAGER are untouched. **Both note fields decouple from the accounting lock across all three tiers:** the FE notes trigger disables only when BOTH fields are READ_ONLY (fieldAccess-driven, `CusShipmentRow.tsx:176`); fieldAccess returns DIRECT for the two note fields for the three roles even under `hasActiveLock` ("Ghi chú có thể cập nhật kể cả khi lô hàng đã khóa kế toán."); and a notes-only update — nothing beyond the two note fields plus bookkeeping keys — skips `assertShipmentAccountingUnlocked`, while any mixed update still 409s under lock and schedule/declaration fields stay locked for everyone. Lock negatives hold per role (schedule cell readonly, outside roles like MANAGER stay blocked). Pinned by `backend/src/tests/cus-shipment-workspace.test.ts`, `frontend/src/pages/ShipmentsPage.test.tsx`, and the PRD changelog section "Quick-edit lịch & ghi chú mở cho đủ ba vai" (`docs/prd/CHANGELOG.md`).

## Shipment settlement and debit notes (Chi phí – Quyết toán)

The settlement surface gives the CUS role one consolidated view of a customer's lots: Lớp 1 rolls each lot up to freight (auto), chi hộ, phải thu, phải trả, lợi nhuận, and lock state behind customer (required), delivery-date-range, and lock-status filters; Lớp 2 opens per lot with container-keyed tables.

- **Read/edit models.** `shipment-debit-summary.service.ts` projects the Lớp 1 rollups; `shipment-debit-detail.service.ts` serves the Lớp 2 workspace. The CUS may edit Phát sinh (PS thực tế) per container and ad-hoc no-invoice fees (Phí khác), while invoice-numbered chi hộ fees (Phí Nâng/Hạ/CSHT with HD numbers) stay read-only.
- **Warning contract.** Cược Hãng Tàu and Tạm thu sửa chữa greater than zero demand original documents: the UI flags them (warning icon + cam background) so the CUS chases the paperwork before locking.
- **Lock and adjust.** `shipment-cost-lock.service.ts` freezes all Lớp 2 inputs when a lot is locked; the adjustment form covers customer-specific freight agreements. Lock, freight-adjustment, and debit-note writes are registered in the material-write registry (`backend/src/middleware/material-write.ts`) with audit events and `Idempotency-Key` requirements.
- **Consolidated debit notes.** `POST /shipments/debit-notes` issues one note per customer per period: `billing_documents` rows typed `DEBIT_NOTE` are constrained by the partial unique index `billing_documents_active_period_unique` (WHERE deleted_at IS NULL AND type='DEBIT_NOTE'; `backend/drizzle/0000_flexible-baseline.sql:1990`), so a duplicate customer+period issuance returns 409. XLSX export streams from `billing-export-debit-note-xlsx.service.ts` (PDF template reads via `debit-note-template-reads.service.ts`).
- **One contract, two packages.** FE and BE share the zod contract `shared/src/schemas/shipment-debit-edits.ts`; the save delta always emits `freightEdits` so typed PS values cannot be silently dropped, pinned by a round-trip test (type → save → read back).
- **Money states.** Phải thu ≠ đã thu ≠ đã khóa ≠ chưa xác định (null renders "Chưa xác định", never 0) per `docs/prd/QuyTrinhO2C.md` §7.
- **Business keys are the only display identifiers** (ruling 2026-09-19/20): internal DB ids and id-derived codes (SHP-*/GBN-*/#id) never render as user-facing text. Backend derivations live in `backend/src/lib/business-keys.ts` (debit labels read Số Bill/Booking first, số tờ khai second; legacy system-code rows collapse to "—"); the frontend mirror `frontend/src/features/expense-accounting/business-key.ts` guards render-side (`businessKey()` returns null for system-code patterns, `displayKey()` falls back to "—"). Billing export, work-inbox titles, and notification bodies share the same derivation.
- **Issue readiness gate (2026-09-20, card _30):** `requestBillingDocumentIssue` collects EVERY missing §7.2 condition before issuing a debit note — goods (no presentation lines), price (per-line grossAmount=0), and §7.1 original-document receipt keyed on `trips.pod_recovered_at/by` (the POD-mộc-đỏ recovery, not the ops paper-order handoff) — and rejects with one 409 carrying `details[]`, one item per reason, no masking; eligible documents keep their old path unchanged. The FE builder footer renders each 409 reason on its own line (`role="alert"`), never overflowing. Pinned by isolated-DB tests incl. a recovered-trip control proving the reason list names only unrecovered trips (`backend/src/services/billing-document-governance.service.ts:308-420`).
- **Zone surcharges are config data, not code** (2026-09-20): the Bảng 2.2/2.3 zone column reads its label from `zone-surcharge.service.ts` (source ladder OVERRIDE > INCIDENTAL > CONFIG > null); unconfigured lots render "—" in the header, amounts render null → "—", and the Phí khác cell shows both sides (Thu khách + chi hộ) when they differ.

## Frontend interaction and layout contracts

### Build freshness (stale-tab prompt)

- `useBuildFreshness` polls `/api/health` `buildHash` every 60 s against the value fetched at boot. Polling pauses on hidden tabs and re-checks immediately when the tab becomes visible again; it stops permanently once a mismatch is flagged. A failed poll keeps the last-known state — a health blip never fabricates a mismatch (`frontend/src/hooks/useBuildFreshness.ts`).
- `StaleBuildBanner` renders a faint fixed bottom-left `role="status"` prompt ("Phiên bản mới — tải lại?") that reloads ONLY on click — an in-progress form is never auto-reloaded. It mounts once in `App()` above the route tree, so it covers the login screen and the authenticated shell alike (`frontend/src/components/shared/StaleBuildBanner.tsx`, `frontend/src/App.tsx`).
- This is the proactive complement of the reactive chunk-error handler, which reloads only after a lazy chunk already failed to load, and even then only after verifying a newer entry asset is actually reachable (`frontend/src/lib/chunk-error.ts`).

### Dialog accessibility probe contract

- Every confirm and modal surface carries `role="dialog"` + `aria-modal="true"` + an accessible name: the shared `Modal` and `Drawer`, `ConfirmDialog`, `OpsModalBackdrop`, the tire dialogs, and `BillingDocumentBuilder`.
- `ConfirmDialog` deliberately declares `role="dialog"` (not `alertdialog`): role-based lookups match exactly — neither a CSS `[role="dialog"]` selector nor testing-library `getByRole('dialog')` resolves `alertdialog` — so the more specific role had made QA's a11y probes blind to every confirm modal in the app. The attribute contract (role, `aria-modal`, accessible name, `aria-describedby`) is pinned in `frontend/src/components/UI.overlay.test.tsx` and `frontend/src/components/confirm-dialog.test.tsx`.

### Segmented datetime fields and filter bars

- Segmented datetime fields (HH/mm/DD/MM/YYYY) render ONE continuous frame per input: the group carries the control chrome (border, shared 36px control geometry, radius ≤8px), every segment is a borderless centered digit box, and there is NO trailing trigger — the owner removed the calendar icon (card _25), so the whole group click-opens the picker and the per-segment svgs stay `display:none` by that ruling. The group declares `min-width: max-content` so chained `min-width:0` wrappers cannot cramp it below the digits' intrinsic width (`frontend/src/design-system/forms/DateTimeSegments.css:1-30`).
- The segment group declares `min-width: max-content` so the app's chained `min-width: 0` / `width: 100%` flex wrappers cannot cramp it below the digits' intrinsic width (`frontend/src/design-system/forms/DateTimeSegments.css`).
- Filter and input wrappers keep `width: 100%` + `min-width: 0` so date fields size from content instead of forcing a horizontal scroll at laptop widths (`frontend/src/pages/ShipmentContainersPage.css`).
- **Two-row 12-column filter grid (2026-09-20 owner spec, card _36 — supersedes the earlier one-row ruling):** the shipments-detail filter bar is a fixed 12-track grid — row 1: search span-4, from 2, to 2, customer 4; row 2: direction 3, dispatch 3, info 2, connected date-preset segmented group 2, ghost reset 2 right-aligned. All controls share the owner-spec 36px geometry (`--uui-control-h: 36px` scoped to the bar), labelless rail slots stay bottom-flush via `align-items: end`, and adding a filter never needs a track edit (`display: contents` groups are layout-invisible; `frontend/src/pages/ShipmentContainersPage.css:40-75`).
- **Zero-vs-missing display contract (2026-09-20, cards _27/_31):** absent sources render "—" and computed zeros render "0", enforced at the derive layer: `finance-derived.ts` seeds report-backed cells with `?? null` (formatter renders "—") while keeps `?? 0` ONLY inside sums over defined arrays (arithmetic zero); `marginPct`/`yoyPct` return "—" on null inputs (`frontend/src/pages/finance-derived.ts:17-73`).
- **Trips 15T missing-price chip (2026-09-20, card _32):** a trips-list row whose truck class is 15T and whose revenue is missing renders "—" plus a right-aligned in-cell chip "Thiếu giá 15T" (tooltip: the base price is missing, never displayed as 0); the predicate keys on `trucks.vehicleClass` added to the trips-list payload (`frontend/src/features/trips/tripColumns.tsx:451`, `backend/src/services/trip-queries.service.ts`).
- **Row-cell creation lives in the combobox (2026-09-20, card _26):** the create-page goods table carries no in-cell buttons — route, port, and container-type creation happens by typing in the cell combobox, which offers a create option that opens the prefilled dialog (`initialName`/`initialCode`); `ShipmentCreateWorkspace` ratcheted 1123→1130 for the listbox wiring (`frontend/src/features/shipments/create/uui-searchable-field.tsx`, `frontend/src/tests/structure.guard.test.ts:231-234`).

## Pricing and fuel surcharge

The pricing service composes freight, fuel surcharge, and shared financial calculations into one transaction-aware surface. The fuel-surcharge path delegates the math to `@tingting/shared`.

- **Threshold fires at equality (2026-09-20 adjudication):** a fuel-price change exactly equal to the ngưỡng counts as đạt ngưỡng and opens a new price period — both PRD docs were amended to match the engine, which already used `<` (`backend/src/services/freight-pricing-engine.service.ts:244-257`).
- **MANUAL reasons surface verbatim (2026-09-20, card _28):** when a fuel clause is missing (UNSET threshold, unconfirmed lag) the engine returns `source: 'MANUAL'` with a specific formula reason, and `FreightPreviewCard` renders that formula text directly instead of a hardcoded "Thiếu giá gốc" string — the user sees lag-vs-threshold-vs-price missing, never a fabricated number (`frontend/src/features/shipments/create/FreightPreviewCard.tsx:32-45`).
- **15T demo prices are not seeded (2026-09-20, card _29):** dev/staging seed no invented 15T contract rows, so every environment behaves like prod — 15T without customer prices returns MANUAL "Thiếu giá gốc cho 15T" (`backend/src/seed/seed-demo-freight-pricing.ts`).
- Fuel-price period config surfaces label the value simply "Giá dầu (đ/lít)" / "Giá dầu theo kỳ" — the 2026-09-20 rename dropped the DO unit suffix from every display label; the fuel type is implied by the config context (`frontend/src/pages/config/FuelPricePeriodsConfigPage.tsx`).

- The shared `computeFuelSurcharge` returns 0 when the base price is unset, when the share percent is non-positive, when quota liters are non-positive, or when the current price does not exceed the base; otherwise the surcharge is `roundInt(round2dp(delta × quotaLiters × sharePct/100))`. Each trip creation snapshots the inputs (`currentFuelPrice`, `baseFuelPrice`, `quotaLiters`, `customerSharePct`) so future price changes do not retroactively rewrite cước đã phát hành.
- The pricing service is the only place that resolves per-customer share percent and per-config base price; trips persist the resolved numbers so downstream ledger reads never re-resolve.
- Shared schema changes require rebuilding `@tingting/shared` before backend tests that import its compiled package — the shared/dist staleness is the most common cause of "does not provide an export named ..." import errors.

## Persistence and migration discipline

Drizzle is the only ORM in active use; the migration journal is the source of truth for schema history. Generated SQL stays in `backend/drizzle/` and every schema edit must be paired with a `make generate` run followed by a pre-commit typecheck. The `db-drift-check` make target asserts that a fresh generate is a no-op on a clean tree, catching the "schema edit has no migration" regression class.

- A portable mkdir lock serializes `make generate` so two concurrent agents cannot both claim the next journal index.
- The pre-migrate `db-backup` gate fails closed: a backup under 1 KB aborts the migration rather than silently continuing.
- Integration tests that touch Redis must close their connection (see `dispatch-fulfillment.test.ts`); an open handle at exit crashes the worker.
- **In-place migration-statement rewrites** are the sanctioned repair for a migration whose statement is wrong-but-already-applied (precedent 2026-09-20: a dead-letter `UPDATE ... SET route_id=NULL` against a NOT NULL column survived every applied env as a no-op but killed pristine fresh-replay with 23502; rewritten in place to DELETE dangling rows, with a header note and ×2 pristine fresh-replay proof). Safe because the drizzle PG migrator is **when-cursor based — the recorded hash is written but never read**, so content edits never re-run applied migrations; the journal `when`/idx stay untouched and alignment checks ride the deploy-window checklist.

## Cross-cutting contracts

- **RBAC** is enforced at the route boundary through Casbin; accountants are excluded from operational writes even when the underlying service supports them. The dispatch plan routes strip the dispatcher from `isCombined`, the external-trip close routes guard the dispatcher/CUS/ADMIN/MANAGER roles, and the note composer route mirrors the read mask on the plan.
- **No internal approval routing.** The former internal approval workflows (approval requests, gate tables, and their FE queues) were removed by product ruling (2026-09-15): finance/ops writes post directly under role checks and audit events instead of an internal approval hop.
- **Idempotency** keys travel with every material write through `runShipmentWrite`; the dispatch plan save, the carrier-fleet vehicle endpoints, and the trip status commands require an `Idempotency-Key` header and replay deterministically. Plan-save conflicts surface the backend's 409 message verbatim so the UI can echo "Lô hàng đã có thay đổi khác, vui lòng tải lại" without re-deriving it.
- **Material write registry** enumerates every material write endpoint so the pre-commit gate can guard completeness; the test suite asserts no out-of-registry writes slip in. The 2026-09-20 customers overhaul added `customers.bulk-notify` and `customers.bulk-status` (lock/unlock) as registry entries with Idempotency-Key + in-transaction audit (`backend/src/middleware/material-write.ts:86-87`).
- **Single empty-state primitive (2026-09-20, card _41):** the app has exactly one EmptyState (the design-system primitive, with compact cards/rows/list preview variants); the parallel `.empty-state` chrome and the dead shared component were consolidated away, and the float animation carries a `prefers-reduced-motion` guard (`frontend/src/design-system/EmptyState.tsx`, `frontend/src/components/UI.css`).
- **License-expiry risk flags (2026-09-20, card _44):** the fleet driver catalog renders a pure state function over the license expiry date — overdue rows get an oxblood icon+label ("Quá hạn N ngày"), ≤30-day rows bronze ("Còn N ngày"), long-dated/missing rows stay bare — so a compliance-risk field never renders as plain data (`frontend/src/features/dispatch/catalogs/FleetDriversView.tsx:26-40`).
- **Local date formatters** live in `lib/format`; the structure guard bans bespoke formatters outside an allowlist and names every documented exception.

## Mechanical gates and enforcement

- The pre-commit hook typechecks the touched project and runs the frontend structure guard so a tree that does not typecheck or a file past its frozen ceiling cannot reach the commit boundary. Bypass is `git commit --no-verify` with a stated reason in the commit body.
- The backend SIZE_BASELINE and the frontend `FROZEN_MAX_LOC` only shrink: a file that grew needs a justified entry review. When two branches independently grow the same file, the ceiling is bumped to the actual merged line count with either a per-line comment naming both feature sets or, for bulk post-merge sweeps, a single global contract-change rationale in the file header. The 2026-09-09 origin/prod → main merge swept 48 entries by +1..+8 lines, and the 2026-09-20 wave added two dated bumps in the same style (ShipmentCreateWorkspace 1123→1130 for card _26, tripColumns 513→524 for the 15T chip) — all documented in `structure.guard.test.ts`.
- The font-family contract bans `font-variant-numeric: tabular-nums` and the JetBrains Mono fallback app-wide: Be Vietnam Pro uses proportional figures, so right-aligned numerics rely on `text-align: right` instead of a no-op tabular-numeral declaration. **Documented exception (2026-09-20):** the debit settlement money tables ship tabular-nums (QA-passed on the worked-numbers alignment) and are exempt from the scan. The allocation summary, schedule editor, and ledger rows honor the ban.
- The QA gate table in `AGENTS.md` is mandatory for every change; a touched gate is not optional. Shared contract, Drizzle schema, financial-calculation, and RBAC changes require the full set including the e2e runner. Testplan ships a reusable harness (`testplan/qa/scripts/run-all.mjs`, `run-case.mjs`, `smoke.mjs`, `lib/{env,harness,selectors}.mjs`) and stores evidence under `testplan/qa/evidence/<date>_<scope>/`; the root `qa/` directory remains the cross-project evidence sink per `AGENTS.md`.

## Related pages

- [Overview](overview.md) — SilverSea at a glance, ports, removed features.
- [Quickstart](quickstart.md) — first-run setup, scripts entry points, validation commands.
- `AGENTS.md` — repo contracts, role table, QA gate table, knowledge-base notes.
