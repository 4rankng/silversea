---
type: Reference
title: "SilverSea System Overview"
description: "System-level overview of SilverSea's product scope, runtime stack, O2C workflow, and the merged dispatch, shipment, and driver capabilities."
tags: [overview, product, o2c, dispatch, ops]
verified:
  - by: openwiki/0.5.0
    at: 2026-09-09T05:57:42.350Z
sources:
  - id: openwiki-source-8037e2358a2c4f9b2c722a11
    resource: repo://AGENTS.md
  - id: openwiki-source-7633dc761224043313afe6c1
    resource: repo://backend/src/routes/shipments/dispatch-planning.routes.ts
  - id: openwiki-source-07d8d0b4bd1aa611aec4651d
    resource: repo://backend/src/services/dispatch-task-tags.service.ts
  - id: openwiki-source-0047c2597980e18b4470c62d
    resource: repo://docs/prd/QuyTrinhO2C.md
  - id: openwiki-source-f2f111426b499e3847bd2369
    resource: repo://frontend/src/features/dispatch/master-plan/MasterPlanGrid.tsx
  - id: openwiki-source-012f2c78e3b1446dfc35803f
    resource: repo://Makefile
  - id: openwiki-source-5b54a58d1b51cd490b0e7162
    resource: repo://package.json
  - id: openwiki-source-c70b83824774b69fa2b19556
    resource: repo://testplan/flows/README.md
generated: { by: "opencode", at: "2026-09-09T05:57:42.350Z" }
---

# SilverSea System Overview

**SilverSea is a TingTing-platform deployment for the SilverSea customer** — a container-trucking (vận tải container) logistics operation in Vietnam. The platform is customized for SilverSea's Order-to-Cash: CUS clerks create lô hàng (shipment lots), dispatchers plan trips and assign drivers, drivers run them and close e-POD, accountants close O2C.

## Stack and layout

pnpm monorepo:

| Piece | Tech | Port |
|-------|------|------|
| `backend/` | Express + TypeScript, Drizzle ORM, Postgres, Redis, JWT + Casbin RBAC | 3001 |
| `frontend/` | React + Vite (strictPort), TypeScript, TanStack Query, Untitled UI | 7174 |
| `shared/` | `@tingting/shared` — Zod intake schemas + financial calculations | — |
| Postgres | local dev DB | 5441 |
| Redis | local dev Redis | 6391 |
| Adminer | local DB UI | 8083 |

Demo mode is permanently disabled. Staging: https://vantai.tingting.vip (accounts in `testaccounts.txt`, shared password `Abc123`). Prod is live with customer data — never reset or reseed it.

## The domain at a glance

The O2C state machine: `Mới tạo (NEW) → Đã phân xe (DISPATCHED) → Đang chạy (IN_TRANSIT) → Hoàn thành (COMPLETED)`, with `Đã hủy (CANCELED)` as an exception exit. The canonical spec is `docs/prd/QuyTrinhO2C.md` (diagram-based content is authoritative); role-based test cases live in `testplan/flows/`.

Modules: CUS (chứng từ) creates shipments (FCL/LCL, ad-hoc `Lệnh chạy ngoài` orders with free-text master-data intake, Kẹp/Kết hợp container pairing), Điều vận (dispatch) plans and assigns trips and tags, Lái xe (driver) receives orders and closes e-POD, OPS (hiện trường) runs quy chi phí field-ops cost screens, Kế toán (finance) closes the cycle. Details in [Architecture](architecture.md).

## Current dispatch and shipment behavior

The main tree as of commit `468bd371` (origin/prod merge) plus `7d4a55eb` (post-merge `FROZEN_MAX_LOC` contract bump) carries the following waves, all now live in the same shipping branch:

- **External-carrier staff close.** When the carrier does not run the driver app, dispatch or CUS confirm completion from the detail-plan row; `taskStatus` flips to `COMPLETED` and the same `transitionTripStatus` machinery that powers driver close posts revenue/AP/AR and writes the ledger snapshot. Surfaced through `completeDispatchExternalTrip` in `dispatchPlanningClient.ts` and `trip-external-close.service.ts`.
- **Multi-day allocation breakdown.** Carrier allocation in the master plan groups demand by packing/return day (`DispatchAllocationDaySection` + `allocationDayHelpers`), validates against the per-day demand, and saves through a partial-save endpoint that echoes the persisted row back to the grid. Long operational notes truncate with a `MasterPlanNoteModal` popup so dense rows stay readable.
- **Partial-dispatch support.** A partially-dispatched lot keeps its remaining `READY` rows re-assignable in both the carrier-fleet reassign path and the detail-plan save path; only terminal statuses (`COMPLETED`, `CANCELED`) block further carrier changes.
- **Per-row confirm/revert + giờ-first 24h inputs in the CUS detail ledger.** Inline `Xác nhận` / `Revert` actions with success/error toasts and Enter/Escape handling. The schedule editor (`ShipmentContainerScheduleEditor`) accepts the appointment in a `giờ`-first 24h input so the typed value matches the rendered chip text. Inline drafts dismiss via `useClickOutside`.
- **Dispatch task-tag pool.** `listDispatchTaskTags` / `createDispatchTaskTag` / `updateDispatchTaskTag` / `deactivateDispatchTaskTag` live in `dispatchPlanningClient.ts` beside the other dispatch planning calls, with NFC-normalized duplicate detection and a soft-delete path that preserves historical notes.
- **Idempotent detail-plan saves.** Plan-save conflicts surface the backend's 409 message verbatim so the UI can echo "Lô hàng đã có thay đổi khác, vui lòng tải lại" without re-deriving it. The editor modal closes on a successful save and restores focus to the trigger button (`a6e68a91`); a regression sweep (TC-DISPATCH-EDIT-002) keeps that behavior pinned.
- **Font-family contract enforcement.** The allocation summary, schedule editor, and ledger rows drop the legacy `tabular-nums` declaration so Be Vietnam Pro's proportional figures render correctly under right-aligned numerics.

## Removed features — do not treat as current

GPS/telemetry tracking and the AI-assistant feature were removed entirely (2026-09-06, incl. dead tables and UI); telemetry revisit is moot. The `PENDING_EXPENSE_APPROVAL` status and maker-checker flow were retired 2026-09-05. The generated wiki will not resurrect them on refresh.

## Where to go next

- [Architecture and Codebase Map](architecture.md) — layout, dispatch planning flow, mechanical gates.
- [Quickstart](quickstart.md) — first-run setup, scripts entry points, validation commands.
- `AGENTS.md` — repo contracts, roles table, QA gates.
- `testplan/` — role-based regression flows; `testaccounts.txt` for per-environment accounts.
