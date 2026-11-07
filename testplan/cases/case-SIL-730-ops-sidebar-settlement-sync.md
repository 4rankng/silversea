# Test Case: SIL-730 (Ticket ID 850) — Ops Sidebar Duplicate & Settlement Data Sync

## Metadata
- **Ticket ID**: SIL-730 / Internal ID 850
- **Scope**: Ops sidebar (`/my-orders` removal) and settlement data source sync (`/my-settlements` with `/ops/wallet`)
- **Date**: 2026-11-07
- **Author**: Antigravity Pair Programmer

## Problem Description
Sidebar Ops (user Nguyễn Huy Hoàng `hoangnh`) in group 'Công việc của tôi' exhibited duplicate old/new surfaces:
1. `/ops/orders` ('Kế hoạch làm hàng') works well (54 lots, "+ Khai chi phí" button) vs `/my-orders` ('Lệnh giao nhận') is empty.
2. `/ops/wallet` ('Quỹ tạm ứng') contains full settlements (`OS-2611-0005` 1.080.000₫, `OS-2611-0001` 150.000₫) vs 2 separate menu items `/my-advances` ('Tạm ứng') + `/my-settlements` ('Phiếu thanh toán') — where `/my-settlements` displayed `PT-2611-0002` / `PT-2611-0001` with `TỔNG CHI PHÍ THANH TOÁN: 0₫`.

## Acceptance Criteria
1. Remove/hide 'Lệnh giao nhận' (`/my-orders`) from the Ops sidebar.
2. Synchronize data source of `/my-settlements` with `/ops/wallet` so there is no longer a mismatch where one side has `OS-*` with money and the other side has `PT-*` at 0₫.
3. Preserve all existing functionality currently in use.

## Reproduction Steps
1. Log in as OPS user (`hoangnh`).
2. Inspect the sidebar: 'Lệnh giao nhận' (`/my-orders`) was visible under 'Công việc của tôi' and led to an empty screen.
3. Navigate to `/ops/wallet`: see `OS-*` settlements with non-zero amounts.
4. Navigate to `/my-settlements`: see `PT-*` with 0₫.

## Expected Behavior
1. In the sidebar for `Role.OPS`, 'Lệnh giao nhận' (`/my-orders`) is absent.
2. Navigating to `/my-settlements` shows `OS-*` settlements with their full non-zero amounts and itemized expense breakdowns matching `/ops/wallet`.
3. Clicking on an `OS-*` settlement on `/my-settlements` opens `/my-settlements/:id` displaying the full container expense breakdown and supporting print and Excel export.

## Verification Evidence
- **Backend Typecheck**: `cd backend && npx tsc --noEmit` exited 0.
- **Backend Unit Tests**:
  - `src/tests/unit/sil730-ops-settlement-sync.test.ts` passed (5/5 tests).
  - `pnpm test:unit` passed (994/994 tests, 152 suites).
- **Frontend Typecheck**: `cd frontend && npx tsc -b` exited 0.
- **Frontend Vitest**:
  - `src/components/Layout.test.ts` passed (58/58 tests).
  - `src/pages/SettlementPrintPage.test.tsx`, `src/pages/ForwarderSettlementCreatePage.test.tsx`, `src/features/forwarder/ForwarderSettlementSection.test.tsx`, `src/features/ops/OpsSettlementSheet.test.tsx` passed (96/96 tests).
- **Lint**: `pnpm lint` passed (0 errors).
- **Build**: `make build` succeeded (shared + backend + frontend vite bundle).
