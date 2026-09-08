---
type: Reference
title: "SilverSea System Overview"
openwiki_generated: true
verified:
  - by: openwiki/0.5.0
    at: 2026-09-08T08:52:37.167Z
sources:
  - id: openwiki-source-8037e2358a2c4f9b2c722a11
    resource: repo://AGENTS.md
  - id: openwiki-source-5e744c545901633371756d30
    resource: repo://backend/.env
  - id: openwiki-source-0047c2597980e18b4470c62d
    resource: repo://docs/prd/QuyTrinhO2C.md
  - id: openwiki-source-5b54a58d1b51cd490b0e7162
    resource: repo://package.json
  - id: openwiki-source-c70b83824774b69fa2b19556
    resource: repo://testplan/flows/README.md
generated: { by: "claude-code", at: "2026-09-08T08:52:37.167Z" }
---

# SilverSea System Overview

**SilverSea is a TingTing-platform deployment for the SilverSea customer** — a container-trucking (vận tải container) logistics operation in Vietnam. The platform is customized for SilverSea's Order-to-Cash: CUS clerks create lô hàng (shipment lots), dispatchers plan trips and assign drivers, drivers run them and close e-POD, accountants close O2C.

## Stack and layout

pnpm monorepo:

| Piece | Tech | Port |
|-------|------|------|
| `backend/` | Express + TypeScript, Drizzle ORM, Postgres, Redis, JWT + Casbin RBAC | 3001 |
| `frontend/` | React 19 + Vite (strictPort), TypeScript | 7174 |
| `shared/` | `@tingting/shared` — zod intake schemas + financial calculations | — |
| Postgres | local dev DB | 5441 |
| Redis | local dev Redis | 6391 |
| Adminer | local DB UI | 8083 |

Demo mode is permanently disabled. Staging: https://vantai.tingting.vip (accounts in `testaccounts.txt`, shared password `Abc123`). Prod is live with customer data — never reset or reseed it.

## The domain at a glance

The O2C state machine: `Mới tạo (NEW) → Đã phân xe (DISPATCHED) → Đang chạy (IN_TRANSIT) → Hoàn thành (COMPLETED)`, with `Đã hủy (CANCELED)` as an exception exit. The canonical spec is `docs/prd/QuyTrinhO2C.md` (diagram-based content is authoritative); role-based test cases live in `testplan/flows/`.

Modules: CUS (chứng từ) creates shipments (FCL/LCL, ad-hoc `Lệnh chạy ngoài` orders with free-text master-data intake, Kẹp/Kết hợp container pairing), Điều vận (dispatch) plans and assigns trips and tags, Lái xe (driver) receives orders and closes e-POD, OPS (hiện trường) runs quy chi phí field-ops cost screens, Kế toán (finance) closes the cycle. Details in [Architecture](architecture.md).

## Removed features — do not treat as current

GPS/telemetry tracking and the AI-assistant feature were removed entirely (2026-09-06, incl. dead tables and UI); telemetry revisit is moot. The `PENDING_EXPENSE_APPROVAL` status and maker-checker flow were retired 2026-09-05. The generated wiki will not resurrect them on refresh.

## Where to go next

- [Architecture and Codebase Map](architecture.md) — layout, financial-precision contract, structure ratchet, known traps.
- `AGENTS.md` — repo contracts, roles table, QA gates.
- `testplan/` — role-based regression flows; `testaccounts.txt` for per-environment accounts.
