# QA-2026-10-03-01 — Driver day-view title, shipments status filter placement, and container ledger actions column

Status: PASSED (all affected gates green).

## Reported Issues & Solutions

1. **Driver Day View Conflict (`/my-trips/two-orders`)**:
   - Reproduction: Navigate to `/my-trips/two-orders` as DRIVER when 0 trips are assigned today.
   - Symptom: PageHeader displayed "Hai lệnh hôm nay" (Two orders today) while the EmptyState directly below stated "Hôm nay không có lệnh. Bạn chưa được phân công lệnh nào cho hôm nay." (Today there are no orders).
   - Solution: PageHeader title made state-free: "Lệnh trong ngày" (matching inbound navigation from `DriverTripsPage.tsx`), eliminating contradiction on 0-order and 1-order days. Loading and error messages also updated to reference "lệnh trong ngày".
   - Navigation title updated in `shared/src/navigation/pageCatalog.ts` and rebuilt `@tingting/shared`.
   - Tests: `frontend/src/pages/driver/DriverTwoOrdersPage.test.tsx` (12/12 passed).

2. **Shipments Page Status Filter Placement & Redundant Suffixes (`/shipments`)**:
   - Reproduction: View `/shipments` on mobile / narrow screen (e.g. 390px).
   - Symptom:
     a) Status tabs rendered as a select dropdown ("Tất cả (135)") above the filter control card, while Row 2 inside `ListFilterBar` had empty space next to "Khoảng ngày nhanh".
     b) Status options contained "(trang) (20)" and "(trang) (15)" representing page-scoped counts that cluttered the options.
   - Solution:
     a) Moved status tabs filter into `ListFilterBar` via `quickFilters={...}` with `quickFiltersLabel="Trạng thái lô hàng"`, placing it cleanly on Row 2 sharing the space beside `Khoảng ngày nhanh`.
     b) Removed "(trang)" and page-scoped counts from `LOT_STATUS_TABS`, keeping only clean labels ("Tất cả (total)", "Chưa chốt lịch", "Chờ điều xe", "Chờ đối soát").
   - Tests: `frontend/src/pages/ShipmentsPage.test.tsx` (123/123 passed).

3. **Container Ledger Table "Thao tác" Column (`CusContainerLedger`)**:
   - Reproduction: Open "Chi tiết container" drawer on `/shipments`.
   - Symptom: "Thao tác" column width was excessively wide (9% of table), table header showed full text "Thao tác", and rows hid the trash button behind hover/focus (`visibility: hidden`).
   - Solution:
     a) Header text "Thao tác" removed from visible rendering via `<span className="sr-only">Thao tác</span>` on `<th scope="col" aria-label="Thao tác">` while preserving accessibility and test contracts.
     b) Column width shrunk from 9% to 4%, redistributing space to content columns (Identity: 12%, Route: 12%, Appointment: 15%, Actions: 4%), maintaining the strict 100% grid invariant tested by `ShipmentsPage.density.test.ts`.
     c) Trash action icon made permanently visible (`visibility: visible;`) and centered (`margin: 0 auto; display: inline-flex;`) with disabled styling.
   - Tests: `frontend/src/pages/ShipmentsPage.density.test.ts` (11/11 passed), `frontend/src/features/shipments/cus/CusContainerLedger.test.tsx` (22/22 passed).

## Affected Quality Gates Verification

| Gate | Result |
|---|---|
| Root lint (`pnpm lint`) | 0 errors, 22 warnings (pre-existing no-console) |
| Frontend typecheck (`cd frontend && npx tsc -b`) | 0 errors |
| `DriverTwoOrdersPage.test.tsx` | 12 passed (12 total) |
| `ShipmentsPage.density.test.ts` | 11 passed (11 total) |
| `CusContainerLedger.test.tsx` | 22 passed (22 total) |
| `ShipmentsPage.test.tsx` | 123 passed (123 total) |
| `MasterPlanFilters.test.tsx` | 9 passed (9 total) |
