# UI recommendations — Shipment operations workspace

## Outcome

Build one flat, role-aware workspace around three customer workbook concepts:

1. **Kế hoạch xe** — workload, carrier/vehicle assignment, departure readiness.
2. **Chi tiết lô hàng CUS** — searchable shipment register plus operational detail.
3. **Tạo lô hàng** — progressive form with `CONTAINER` / `LCL` cargo modes.

The workspace should consolidate navigation and visual language, not merge permissions or data authorities. Operational shipment/vehicle data remains the primary surface. Credit exposure and approval stay a guarded exception flow, not another shipment section.

## Current-state findings

- `ShipmentsPage` already has useful durable URL state: `status`, `page`, and `q`; status and pagination are server-backed, but `q` filters only the currently fetched page.
- `ShipmentDetailPage` is office read-only and separates header, containers, documents, declarations, and history into multiple cards.
- `ClerkShipmentCreatePage` and `ClerkShipmentDocsPage` are narrow `640px` inline-styled forms. They contain the closest current create/edit workflow, but are visually disconnected from the shipment list.
- `DispatchPage` already owns ADMIN/MANAGER vehicle assignment and dispatch behavior, including responsive vehicle/order layouts.
- Effective frontend role boundaries:
  - ADMIN: shipment list/detail, dispatch, clerk create/docs.
  - MANAGER: shipment list/detail and dispatch; no clerk create/docs route.
  - ACCOUNTANT: shipment list/detail read-only; no dispatch/create.
  - CLERK: quick create and scoped docs route; no office shipment register.
- Existing shipment authority supports customer, cargo type, responsible unit, booking, B/L, expected delivery date, pickup/delivery, contact, container type/number/seal/weight/notes, and fulfillment-time route/truck/driver. Workbook fields such as factory/site, shipping line, import/export direction, customs cutoff, lift/drop schedule, closing/return time, LCL package/CBM/warehouse, and explicit carrier are not all persisted on the current shipment contract. Do not render these as editable “working” fields until their contract is authoritative.
- `frontend/docs/design-system.md` is the applicable project UI guide. Root `docs/design-guidelines.md` does not exist; this subtask does not own creating it.

## Canonical route and query contract

Use one canonical route and keep all user-controlled workspace state in the URL:

```text
/shipments
  ?view=plan|cus-detail|create
  &q=<text>
  &status=all|DRAFT|IN_PROGRESS|DELIVERED|CLOSED|CANCELED
  &page=<positive integer>
  &shipment=<shipment id>
  &date=<YYYY-MM-DD>
  &plan=all|unassigned|assigned|attention
  &mode=container|lcl
  &step=shipment|documents
```

Rules:

- Missing or invalid `view` resolves to the first allowed view for the current role.
- `q`, `status`, and `page` apply to `view=cus-detail`. Search must become server-backed before claiming full-register search; until then retain the current honest “on this page” wording.
- `date` and `plan` apply only to `view=plan`; default `date` is the current local operating date.
- `shipment` opens the selected shipment. Desktop shows it in the adjacent detail pane. Tablet/mobile replaces the list with a full-width detail view; Back removes only `shipment` and restores filters/scroll.
- `mode` applies only to create. Default `container`; changing it must not discard shared fields.
- After create, use `view=create&mode=<mode>&step=documents&shipment=<id>` for the scoped clerk follow-up.
- Do not put unsaved field values in the URL.
- Keep compatibility routes:
  - `/shipments/:id` redirects to `/shipments?view=cus-detail&shipment=:id`.
  - `/clerk/shipments/new` redirects to the role-allowed create view.
  - `/clerk/shipments/:id/docs` redirects to the create/documents step.
  - `/dispatch` may redirect to `view=plan` only after action parity is verified.

Example deep links:

```text
/shipments?view=plan&date=2026-07-29&plan=unassigned
/shipments?view=cus-detail&status=IN_PROGRESS&q=MAEU&page=2&shipment=418
/shipments?view=create&mode=lcl
/shipments?view=create&mode=container&step=documents&shipment=418
```

## Information architecture

### Shared workspace shell

- Compact `PageHeader`: **Vận hành lô hàng**, live result/status sentence, one permitted primary action.
- Plain `Tabs` immediately below the header; only allowed views appear.
- One control rail per view. Avoid a metrics hero, decorative illustration, gradients, shadows, or nested summary cards.
- Inline loading/error/empty state inside the affected region; preserve the surrounding controls and query state.

### Desktop, 1024px+

**Kế hoạch xe**

- Control rail: operating date, plan state, search, compact result count.
- Dense table: timing priority, customer/factory, B/L or booking, direction, cargo summary, destination, carrier/plate, readiness, action.
- Sticky table header; 52–60px rows; pinned final action column only when the action is allowed.
- Selecting a row opens a right inspector for timing, cargo, notes, and assignment evidence. Keep dispatch confirmation in the inspector.

**Chi tiết lô hàng CUS**

- Master/detail layout: `minmax(360px, 0.9fr) minmax(520px, 1.4fr)`.
- Left: current shipment register and pagination.
- Right: selected shipment, ordered for decisions:
  1. identity/status;
  2. schedule and route;
  3. cargo mode and cargo details;
  4. carrier/vehicle;
  5. documents/declarations;
  6. audit history.
- Use section headings and 1px dividers. Avoid wrapping each field group in another card.

**Tạo lô hàng**

- Maximum content width about `960px`; two-column form grid.
- Shared fields first, cargo-mode switch second, conditional fields third, notes last.
- Right-side compact completion summary only on wide desktop; no duplicate values.
- Sticky bottom action bar inside the content area: secondary **Lưu nháp** if contract supports it, primary **Tạo lô hàng**. Never show an unsupported action.

### Tablet, 768–1023px

- One-column workspace; tabs wrap once or use a full-width select if role labels do not fit.
- Plan/register use the existing `DataTable` mobile renderer rather than horizontally scrolling a desktop table.
- Selecting a shipment replaces the list region with detail plus a 44px **Quay lại danh sách** control.
- Create form uses two columns only for short paired fields; addresses, notes, and conditional cargo groups span full width.
- No nested scrolling pane; use document scroll.

### Mobile, 320–767px

- 12–16px page gutters, `min-width: 0` on every flex/grid child, no page-level horizontal overflow.
- Replace tab row with a labelled 44px view selector when more than two views are available.
- Control order: view → search → one compact filter button/sheet → results.
- Shipment card evidence order:
  1. shipment code + status;
  2. customer/factory;
  3. B/L or booking;
  4. cargo summary;
  5. next deadline;
  6. carrier/plate or **Chưa phân xe**.
- Detail is full-width, not a modal. Collapse secondary sections with native disclosure only after identity, next deadline, route, and cargo remain visible.
- Create form is one column. Primary action is full width and sticky above `env(safe-area-inset-bottom)`; reserve bottom padding so content is never obscured.
- All inputs, pills, icon buttons, links, disclosure headers, and row actions have at least `44×44px` hit areas with 8px separation.
- Long B/L, booking, warehouse, destination, customer, and notes wrap or clamp with an explicit expand path. Never force the viewport wider.

## Field grouping and conditional behavior

### Shared shipment fields

| Group | Fields |
|---|---|
| Ownership | Khách hàng; Nhà máy / công trường; Đơn vị phụ trách |
| Reference | Số B/L; Số booking; Hãng tàu; Chiều hàng `Nhập khẩu / Xuất khẩu` |
| Cargo summary | Số lượng; Trọng lượng |
| Timing | Cut-off hải quan; Nâng / hạ; Closing time; Thời gian trả; Ngày giao |
| Route | Điểm lấy; Điểm đến; Kho |
| Operations | Nhà vận chuyển; Biển số xe |
| Notes | Ghi chú vận hành |

### Cargo mode switch

Use a labelled two-option segmented control:

```text
Loại lô hàng  [ Container ] [ Hàng lẻ (LCL) ]
```

- `CONTAINER`: loại container, số lượng container, số container, seal, kg, nâng/hạ, cut-off, closing/return.
- `LCL`: loại kiện, số kiện, kg, CBM, kho nhận/giao, ngày giao.
- Shared customer/reference/route/notes values survive mode changes.
- Hidden mode-specific fields are excluded from submission. If switching would discard entered mode-specific data, confirm before clearing.
- Validation occurs on blur and submit; focus the first invalid field and show a top summary with links when multiple fields fail.

## Role and action visibility

| Role | Visible views | Read visibility | Mutating actions |
|---|---|---|---|
| ADMIN | Plan, CUS detail, Create | All office shipment/plan detail | Create; edit allowed shipment/docs/containers; assign; dispatch; permitted review actions |
| MANAGER | Plan, CUS detail | Office shipment detail and dispatch workload | Existing dispatch/assignment actions only; no clerk create/docs actions |
| ACCOUNTANT | CUS detail | Shipment operational facts needed for office work | None in this workspace; finance workflows remain elsewhere |
| CLERK | Create; scoped post-create documents | Only assigned/scoped shipment context exposed by current clerk authority | Quick create; scoped shipment/docs/container updates already authorized; no fleet-wide plan or office register |
| DRIVER / FORWARDER / CUSTOMER | No office workspace view | Existing role-specific portals only | None here |

Visibility rules:

- Do not render controls that the role can never use.
- When a user may act later but the record state blocks it, render disabled control plus a concise reason.
- Never broaden the effective route/backend permission because a component contains a dormant handler.
- Preserve maker/checker rules for credit overrides; no self-approval.

## Operational versus finance boundary

- Main shipment detail shows operational identity, deadlines, movement, cargo, assignment, documents, and history.
- Do not place credit metrics, debt totals, or approval queues among cargo fields.
- If dispatch is blocked by credit policy, show one compact blocker:
  - **Không thể điều vận: vượt hạn mức công nợ**
  - actions allowed by role: **Mở đề nghị vượt hạn mức** or **Xem đề nghị #…**
- Open the existing governed credit flow in a side sheet or dedicated route and return to the same shipment query state after completion.
- Finance amounts remain formatted by existing financial utilities and permissions; the workspace consumes only the resulting eligible/blocked status.

## Existing design-system reuse

Reuse without introducing another UI library:

- `PageHeader`, `Breadcrumbs`, `StatusPill`, `Alert`.
- `Tabs` for desktop/tablet view selection.
- `DataTable` with `mobileRender`; `Pagination`; `EmptyState`.
- `TextField`, `SelectField`, `NumberField`; existing confirmation dialog/toast contracts.
- `useTableQueryState` and `useDebouncedValue` once list/search is moved into the feature layer.
- Existing semantic tokens from `frontend/src/styles/tokens.css`; existing Vietnamese-capable font stack. Do not add a new font or logistics-blue palette.

Target styling:

- flat surfaces, 1px dividers, radius from current tokens;
- no box shadows for workspace sections;
- `font-variant-numeric: tabular-nums` for dates, quantities, kg, CBM, and plates;
- 16px minimum input text on mobile;
- focus-visible ring on every interactive control;
- 120–180ms color/opacity transitions only, disabled under reduced motion.

## Minimal shippable UI slice

Ship one vertical UI slice, not a visual rewrite of every shipment screen:

1. Add a thin `ShipmentOperationsWorkspacePage` route shell for `view`.
2. Move current `ShipmentsPage` register into `features/shipments/` and reuse `DataTable`, URL filters, loading/error/empty behavior.
3. Add role-scoped view navigation and compatibility redirects; keep backend permissions unchanged.
4. Implement the new create form grouping and `CONTAINER/LCL` conditional presentation only for fields supported by the accepted shared contract.
5. Reuse current dispatch components for `view=plan`; do not duplicate dispatch mutations.
6. Render operational detail in the master/detail region; link guarded credit exceptions out of the primary detail.
7. Retire page-local inline styles only in the migrated shipment surfaces. Do not redesign global primitives.

Explicitly defer:

- GPS/map redesign;
- finance/credit workflow redesign;
- new dashboard metrics;
- customer portal redesign;
- bulk import/export;
- arbitrary drag-and-drop planning;
- unsupported workbook fields until schema/API authority lands.

Suggested file boundary:

```text
frontend/src/pages/ShipmentOperationsWorkspacePage.tsx
frontend/src/features/shipments/components/ShipmentWorkspaceNav.tsx
frontend/src/features/shipments/components/ShipmentRegisterView.tsx
frontend/src/features/shipments/components/ShipmentPlanView.tsx
frontend/src/features/shipments/components/ShipmentCreateView.tsx
frontend/src/features/shipments/components/ShipmentInspector.tsx
frontend/src/features/shipments/shipment-workspace.css
```

Keep the route page below the documented 200 LOC limit; feature components own the business-specific layout.

## Acceptance / responsive QA

- Role matrix verified for ADMIN, MANAGER, ACCOUNTANT, CLERK, plus denial for DRIVER/FORWARDER/CUSTOMER.
- Query deep links restore view, filters, page, selected shipment, plan date, and cargo mode.
- Back from detail restores list scroll and filters.
- Full-register search is either server-backed or explicitly labelled page-local.
- `320`, `390`, `768`, `1024`, and `1440px`: no page-level horizontal overflow.
- Keyboard-only: view switch, filters, register rows, detail disclosures, form, and actions are reachable in logical order.
- All actionable targets are at least `44×44px`; no hover-only actions.
- Vietnamese diacritics and long customer/warehouse/destination text wrap correctly.
- Reduced motion disables nonessential transitions.
- No operational action exposes finance data or exceeds the current role authority.

Status: DONE
Summary: Audited the current shipment, clerk, detail, dispatch, route-guard, schema, and design-system surfaces; produced a concrete responsive workspace, URL-state, role/action, field-grouping, and one-slice implementation recommendation.
Concerns/Blockers: Several workbook fields and LCL-specific fields are not authoritative in the current shipment schema/API. UI must not present them as functional until the accepted contract is implemented.
