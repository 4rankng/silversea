---
type: Reference
title: "SilverSea System Overview"
description: "System-level overview of SilverSea's product scope, runtime stack, O2C workflow, and the merged dispatch, shipment, and driver capabilities."
tags: [overview, product, o2c, dispatch, ops]
verified:
  - by: openwiki/0.5.0
    at: 2026-09-08T14:23:47.638Z
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
generated: { by: "opencode", at: "2026-09-08T14:23:47.638Z" }
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

The merged main+prod surface centers on the dispatch planning and CUS workspace modules.

- The master-plan grid renders one schedule block per container appointment, aggregating container-type counts by pickup/dropoff pair; the detailed-plan grid exposes one row per fulfillment for filtering, classification, and atomic plan edits.
- Dispatcher-selected per-container classification (Đơn/Kẹp/Kết hợp) is the dispatcher's call; the lot-level `Đóng kết hợp` flag remains CUS-owned and is stripped at the route.
- Carrier allocation splits by packing/return day, validates against the per-day demand, and saves through a partial-save endpoint that echoes the persisted row back to the grid.
- The dispatch note composer drives a global tag pool with NFC-normalized duplicate detection and soft-delete; historical notes keep their text after a label is removed.
- CUS workspace reads expose both an overview workboard and a per-container workboard, each rejecting filters owned by the other; the CUS dispatch-status chip vocabulary surfaces five states aligned to the merged chip contract.

## Removed features — do not treat as current

GPS/telemetry tracking and the AI-assistant feature were removed entirely (2026-09-06, incl. dead tables and UI); telemetry revisit is moot. The `PENDING_EXPENSE_APPROVAL` status and maker-checker flow were retired 2026-09-05. The generated wiki will not resurrect them on refresh.

## Where to go next

- [Architecture and Codebase Map](architecture.md) — layout, dispatch planning flow, mechanical gates.
- [Quickstart](quickstart.md) — first-run setup, scripts entry points, validation commands.
- `AGENTS.md` — repo contracts, roles table, QA gates.
- `testplan/` — role-based regression flows; `testaccounts.txt` for per-environment accounts.
