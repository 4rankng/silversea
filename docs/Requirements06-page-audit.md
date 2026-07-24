# Requirements06 Page Audit

Source of truth: `docs/Requirements06.docx`, extracted on 2026-06-19.

This audit checks frontend pages and connected backend surfaces against the text in Requirements06. It uses three labels:

- `Supported`: directly named by Requirements06, or clearly required to satisfy a named item.
- `Needs decision`: related to a named item, but the current UX/business action goes beyond the wording.
- `Not found in Requirements06`: no matching requirement found in Requirements06. Treat as removal candidate unless another approved spec exists.

## High-Confidence Removal Candidates

| Area | Current code | Audit result | Why |
|---|---|---|---|
| Debt offset / `Đối trừ công nợ` workflow | `frontend/src/components/DebtOffsetModal.tsx`, `frontend/src/pages/DebtDetailPage.tsx`, `frontend/src/features/dashboard/components/ApprovalQueueCard.tsx`, `backend/src/services/debtOffset.service.ts`, `backend/src/routes/financial/debt-offsets.routes.ts`, `backend/src/db/schema.ts` `debt_offsets` | Not found in Requirements06 | Requirements06 asks for AR/AP real-time balances, customer/supplier payments, and AR/AP reports. It does not ask for customer-vendor offset, offset approval, or offset history. |
| Push/mobile notifications | `frontend/src/components/NotificationDrawer.tsx`, `frontend/src/hooks/usePushNotifications.ts`, `frontend/src/App.tsx` push handler, `backend/src/services/push.service.ts`, `backend/src/routes/notifications.ts`, `backend/src/db/schema.ts` `push_subscriptions` | Not found in Requirements06 | Requirements06 asks for some due-date reminders, especially vehicle inspection/insurance/oil alerts. It does not ask for a notification center, web push, VAPID, or phone notifications. |
| Management fee configuration | `frontend/src/pages/config/ManagementFeesConfigPage.tsx`, `frontend/src/data/searchRegistry.ts`, `backend/src/db/schema.ts` `management_fees`, `backend/src/routes/config.ts`, `backend/src/services/pnl.service.ts` | Not found in Requirements06 | Requirements06 asks to check P&L calculations. It does not name monthly management fees as a configurable deduction. |
| `Loại seal` catalog | `frontend/src/pages/config/SealTypesConfigPage.tsx`, `frontend/src/data/searchRegistry.ts`, `backend/src/db/schema.ts` `seal_types`, `backend/src/routes/config.ts` | Not found in Requirements06 | Requirements06 says users need to upload/save container and seal photos without auto-completing trips. It does not ask for seal-type taxonomy. |
| `Loại container` catalog | `frontend/src/pages/config/ContainerTypesConfigPage.tsx`, `frontend/src/data/searchRegistry.ts`, `backend/src/db/schema.ts` `container_types`, `backend/src/routes/config.ts` | Not found in Requirements06 | Requirements06 asks for container number visibility/search and settlement by container. It does not ask for container-type management. |
| `Cảng / Bãi Hải Phòng` catalog | `frontend/src/pages/config/PortsConfigPage.tsx`, `frontend/src/data/searchRegistry.ts`, `backend/src/db/schema.ts` `ports`, `backend/src/routes/config.ts` | Not found in Requirements06 | Requirements06 says routes are OK/full detail. It does not request a separate port/yard catalog. |

## Needs Product Decision

| Area | Current code | Audit result | Why |
|---|---|---|---|
| Forwarder expense type catalog | `frontend/src/pages/config/ForwarderExpenseTypesConfigPage.tsx`, `frontend/src/data/searchRegistry.ts`, `backend/src/db/schema.ts` `forwarder_expense_types`, `backend/src/routes/config.ts`, `backend/src/services/forwarder.service.ts`, `backend/src/services/debitNote.service.ts`, `backend/src/services/pnl.service.ts` | Needs decision | Requirements06 requires forwarders to enter expenses by container and show payment status by color. It does not explicitly require editable expense-type admin config. The backend uses this table for labels/VAT/markup, so removal requires replacing it with approved fixed strings or a simpler config. |
| Tire spare install action `Lắp lên xe` | `frontend/src/pages/TruckTiresPage.tsx`, `backend/src/services/tire.service.ts`, `backend/src/routes/config.ts`, `shared/src/schemas/index.ts` `installTireSchema` | Needs decision | Requirements06 says each tractor has 22 tires plus 2 spares and the company must track tire serial, replacement date, supplier, warranty, and days run. Installing a spare is one way to record a replacement date, but the action label/flow is not explicitly specified. |
| Quarterly profit closing / official distribution record | `frontend/src/pages/ProfitPage.tsx`, `backend/src/routes/financial/reports.routes.ts`, `backend/src/services/profit-distribution.service.ts` | Needs decision | Requirements06 asks to add profit tracking per truck because partners/drivers invest by truck. It does not explicitly ask for quarterly accounting close, irreversible distribution history, or “Chốt & phân bổ”. |
| Global notification drawer for in-app alerts | `frontend/src/components/NotificationDrawer.tsx`, `backend/src/services/notification.service.ts`, `backend/src/db/schema.ts` `notifications` | Needs decision | Vehicle deadline reminders are requested. A full app-wide notification inbox goes beyond the wording, but could be retained only if scoped to required reminders and approved workflows. |

## Requirement-Backed Pages

| Page/area | Route/file | Requirement06 support |
|---|---|---|
| Dashboard | `/dashboard`, `frontend/src/pages/DashboardPage.tsx` | `Tổng quan: OK`. |
| Dispatch | `/dispatch`, `frontend/src/pages/DispatchPage.tsx` | `Phân xe: OK`. |
| Trip list/detail/create/edit | `/trips*`, `frontend/src/pages/TripListPage.tsx`, `TripDetailPage.tsx`, `TripCreatePage.tsx`, `TripEditPage.tsx` | Trip book display, trip revenue/cost entry, container/seal photo upload before manual completion, container/customer/date search for forwarders. |
| Salary and attendance | `/salary`, `frontend/src/pages/SalaryAttendancePage.tsx` | Salary UI and calculations marked OK; driver earnings fixes requested. |
| Penalties | `/penalties`, `/my-penalties` | `Kỷ luật: OK`, driver safety/discipline OK. |
| P&L report | `/finance`, `frontend/src/pages/FinancePage.tsx` | P&L UI OK, calculations need checking. |
| Profit sharing per truck | `/profit`, `frontend/src/pages/ProfitPage.tsx` | Profit sharing OK, requires tracking by truck due to partner/driver investment by truck. |
| Receivables | `/debt`, `/debt/:id`, customer detail debt panel | AR real-time display, customer payment entry, detail and summary AR reports. |
| Payables | `/payables`, `/payables/:id`, supplier detail debt panel | Fuel supplier, outside carrier, commission, supplier payments, detail and summary AP reports. |
| Expenses | `/expenses*` | Expense vouchers, entry date vs expense date, photo upload bug, category/supplier refresh bug. |
| Tire management | `/fleet/:id/tires` | 22 mounted tires + 2 spares, serial, position, replacement date/days run, supplier, warranty. `Thanh lý`, `Tháo về kho`, and `Sửa kích cỡ` are not supported and should stay removed. |
| Advances and settlements | `/advances`, `/admin/advance-settlements`, `/my-advances`, `/my-settlements*` | Advance approval exists; outstanding balance and approved settlement/payment tracking by shipment/container are required. |
| Fleet | `/fleet` | Fleet overview OK; oil change and inspection alerts requested. |
| Customers and suppliers | `/customers*`, `/suppliers*` | Customer/supplier pages OK; side debt panels requested. |
| Routes | `/config/routes` | Routes UI OK and features full/detail. |
| Users | `/users` | Users UI/features OK. |
| Audit logs | `/audit-logs` | User log OK. |
| Config landing | `/config` | Config OK, but individual config subpages above still need source validation. |
| Driver portal | `/my-trips`, `/my-earnings`, `/my-penalties` | Driver trip view requires container/customer/instructions; earnings requires MTD salary, road money, paid/advanced, unpaid salary. |
| Forwarder portal | `/my-forwarder-trips`, `/my-advances`, `/my-settlements*` | Forwarder search, expense-status colors, no duplicate container entry, advance balances, settlement by container and chronological order. |

## Immediate Cleanup Recommendation

1. Remove or hide all `Not found in Requirements06` pages/routes/features unless another approved requirement document explicitly covers them.
2. For `Needs decision`, keep the data only where it is required by an approved workflow, but simplify the UI labels/actions so users do not see invented business processes.
3. Add a small requirements trace comment or test fixture for future feature work: every new visible page/action should map to a requirement line or an approved decision note.

## UltraQA Pass 2026-06-19

Completed cleanup pass:

- Removed visible tire actions not supported by Requirements06: `Thanh lý`, `Tháo về kho`, `Sửa kích cỡ`, and `Lắp lên xe`.
- Removed tire `Trạng thái` column and replaced it with `StatusStrip` plus a legend.
- Removed visible debt-offset UI from customer debt detail and dashboard approval queue.
- Removed the notification drawer/topbar bell and phone-push UI.
- Removed unsupported config pages/cards/routes for management fees, seal types, container types, and ports. Direct visits redirect back to `/config`.
- Removed visible container/seal type-picking controls from trip and forwarder container forms; retained container number, seal number, notes, photos, and required settlement links.
- Removed visible management-fee lines from dashboard, P&L, and profit sharing. Backend P&L now reports `managementFee: 0` and does not subtract it from net profit.

Verification run:

- `pnpm --filter @tingting/shared build` passed.
- `pnpm --filter @tingting/backend build` passed.
- `pnpm --filter @tingting/frontend build` passed.
- `pnpm --filter @tingting/backend test` passed: 110 tests.
- Frontend visible-string scan found no matches for the removed fake labels/actions.

Residual backend/shared compatibility surfaces still present:

- Debt-offset database/schema/service/route code remains in backend/shared. It is no longer reachable from the visible frontend, but API deletion should be done with a migration/compatibility decision.
- Notification and web-push backend/shared code remains. The visible drawer and push opt-in UI were removed.
- Management-fee database/schema/config-route code remains. It is no longer visible in the frontend and no longer affects P&L net profit.
- Container/seal/port catalog backend code remains for compatibility and existing stored data. The unsupported frontend config pages and type-picking controls were removed.
