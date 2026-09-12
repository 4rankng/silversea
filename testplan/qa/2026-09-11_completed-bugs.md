# Regression spec — 20260911_1/2/3 Bugs (COMPLETED kanban)

**Source:** `/Users/dev/My Drive/SilverSea/Kanban/COMPLETED/20260911_1.docx`, `20260911_2.docx`, `20260911_3.docx`
**Status:** PREP — verification of completed fixes
**Date:** 2026-09-11

## Goal

Verify 10 bugs + 2 features from three completed kanban cards are properly fixed and have regression coverage:

### 20260911_1 (3 bugs)
1. **BUG 1** — Driver hasn't accepted job yet can still be reassigned
2. **BUG 2** — App should show data in table format; hide sidebar if needed; card only when sidebar closed and still not wide enough
3. **BUG 3** — "Phát lệnh" and "Hoàn thành" buttons should be in ghi chú column, not icon buttons

### 20260911_2 (2 bugs + 2 features)
4. **BUG 1** — Driver detail: collapsible task info, factory name abbreviation, route address, remove đầu kéo/mooc, add invoice info
5. **BUG 2** — Driver app UI: factory abbreviation, route order, container info, container type, return/deliver goods, port info, task actions
6. **FEATURE 1** — Customer layout card view with expand to detail
7. **FEATURE 2** — Add delivery handover photos to container image update

### 20260911_3 (5 bugs)
8. **BUG 1** — Added nha xe doesn't show in dropdown selection
9. **BUG 2** — Detailed plan should show ALL containers, not just assigned ones
10. **BUG 3** — Container number supplement should not require approval — auto-approve
11. **BUG 4** — Task note tags format: actions on top, text below; remove Tác vụ column
12. **BUG 5** — Driver app UI adjustments (factory abbreviation, route order, container info)

## Environment

| Slot | Value |
|---|---|
| Local UI | `http://localhost:7174` |
| Staging UI | `https://vantai.tingting.vip` |
| Accounts | per `testplan/testaccounts.txt` |

---

## Acceptance criteria

### 20260911_1 — BUG 1: Reassignment blocked before driver acceptance

#### TC-COMP-001 — Cannot reassign driver who hasn't accepted the trip

- **Given** a trip dispatched to driver D with status CREATED (not yet accepted/activated)
- **When** dispatcher attempts to reassign the trip to driver D2 via `PATCH /api/trips/:id/reassign`
- **Then**:
  - The reassignment is blocked (409 or appropriate error)
  - The trip remains assigned to driver D
- **Assert:**
  - API returns error status (not 200)
  - `SELECT driver_id FROM trips WHERE id = <trip_id>` still returns D
- **Evidence:**
  - `qa/2026-09-11_completed_comp-001.log`
- **Existing coverage:** `testplan/flows/02-dieuvan-dispatch.md` TC-DV-DISPATCH-052

### 20260911_1 — BUG 2: Table layout with responsive sidebar

#### TC-COMP-002 — Dispatch list shows table format; sidebar hides on narrow viewports

- **Given** dispatcher logged in on staging; viewport ≤ 1200px
- **When** the dispatch list or master plan renders
- **Then**:
  - Data is displayed in table format (not card format) when width allows
  - Sidebar collapses/hides automatically on narrow viewports to maximize table space
  - Cards are ONLY shown when the sidebar is closed AND the viewport is still too narrow for a table
- **Assert:**
  - `browser_evaluate(() => document.querySelectorAll('table, [role="table"], .data-table').length)` ≥ 1 at 1440px
  - Sidebar state changes at breakpoints (test at 768, 1024, 1440)
- **Evidence:**
  - `qa/2026-09-11_completed_comp-002a-1440.png`
  - `qa/2026-09-11_completed_comp-002b-768.png`

### 20260911_1 — BUG 3: "Phát lệnh" and "Hoàn thành" as text buttons in ghi chú column

#### TC-COMP-003 — Action buttons render as text in the ghi chú column, not icon buttons

- **Given** dispatcher on the dispatch detail plan page
- **When** viewing the grid rows
- **Then**:
  - "Phát lệnh" and "Hoàn thành" appear as text buttons within the ghi chú (notes) column
  - They are NOT rendered as icon-only buttons
  - The ghi chú column is wide enough to display the text
  - Long ghi chú text is truncated with ellipsis; clicking shows full text
- **Assert:**
  - `browser_evaluate(() => Array.from(document.querySelectorAll('button')).filter(b => /Phát lệnh|Hoàn thành/.test(b.textContent)).length)` ≥ 2
  - No icon-only buttons (`svg` without text) for these actions
- **Evidence:**
  - `qa/2026-09-11_completed_comp-003.png`

### 20260911_2 — BUG 1: Driver detail collapsible task info + factory abbreviation + route address

#### TC-COMP-004 — Driver detail task info is collapsible; factory shows abbreviation; route shows address

- **Given** driver on staging viewing trip detail at `/my-trips/:id`
- **When** the task info section renders
- **Then**:
  - Task info section can collapse/expand to save screen space
  - Factory name shows the abbreviation (short name), not the full name
  - Route line shows the factory ADDRESS, not the factory name
  - No "Đầu kéo" or "Mooc" fields visible
  - Invoice block shows MST / Tên công ty / Địa chỉ (where data exists)
- **Assert:**
  - `browser_evaluate(() => /Đầu kéo|Mooc/.test(document.body.innerText))` = false
  - Factory abbreviation visible in the header area
  - Route row text matches address pattern
- **Evidence:**
  - `qa/2026-09-11_completed_comp-004a-collapsed.png`
  - `qa/2026-09-11_completed_comp-004b-expanded.png`
- **Existing coverage:** `testplan/qa/2026-09-10_driver-app-enhancements.md` TC-DA-001 through 005
- **UPDATE 2026-09-12:** the collapsible piece (last open sub-item) is DONE —
  `DriverTaskInfoSections.tsx` collapsible heads (`Thông tin lệnh` +
  `Thông tin xuất hóa đơn` toggle independently; collapsed head keeps the
  factory short-name summary). Unit: `DriverTripDetailPage.test.tsx`
  TC-COMP-004 / TC-COMP-004b. Live: local dev as `laixe`, trip 8 —
  `qa/2026-09-12_driver-detail-design/{ui-driver.log,comp-004a-collapsed.png,comp-004b-expanded.png,REPORT.md}`

### 20260911_2 — BUG 2: Driver app UI adjustments

#### TC-COMP-005 — Driver app shows factory abbreviation, route order, container info, task actions

- **Given** driver on staging viewing trip detail
- **When** the trip detail renders
- **Then**:
  - Factory name shows abbreviation, positioned at the top
  - Route info appears below factory name
  - Container number / Container type / Loại hình (ĐÓNG HÀNG / TRẢ HÀNG) displayed
  - Port info (cảng nâng / cảng hạ) visible
  - Task actions (đặt đầu, đặt đuôi, đảo vỏ...) render as chips
  - Tapping a task chip shows full detail
- **Assert:**
  - Factory abbreviation present in header
  - Container type label present
  - Task chips clickable and expand to detail
- **Evidence:**
  - `qa/2026-09-11_completed_comp-005a-overview.png`
  - `qa/2026-09-11_completed_comp-005b-task-detail.png`
- **Existing coverage:** `testplan/qa/2026-09-10_driver-app-enhancements.md` TC-DA-001, 002, 006

### 20260911_2 — FEATURE 1: Customer layout card view with expand

#### TC-COMP-006 — Customer list shows card layout; expand to detail

- **Given** user on the customer management page
- **When** the customer list renders
- **Then**:
  - Customers are displayed in a card layout
  - Each card shows key customer info (name, contact, status)
  - Clicking "Xem chi tiết" expands to show full customer detail
  - Detail view includes all customer fields
- **Assert:**
  - `browser_evaluate(() => document.querySelectorAll('[data-testid="customer-card"], .customer-card').length)` ≥ 1
  - Click expand → detail section visible with additional fields
- **Evidence:**
  - `qa/2026-09-11_completed_comp-006a-cards.png`
  - `qa/2026-09-11_completed_comp-006b-detail.png`

### 20260911_2 — FEATURE 2: Delivery handover photos in container image update

#### TC-COMP-007 — Container image update includes delivery handover photos

- **Given** user updating container images on a shipment
- **When** the image upload/management UI renders
- **Then**:
  - Both container photos AND delivery handover photos (biên bản giao hàng) are uploadable
  - The upload sections are clearly labelled
  - Uploaded handover photos are stored and displayed correctly
- **Assert:**
  - Upload UI has separate sections or labels for container photos vs handover photos
  - After upload, the photo appears in the correct section
- **Evidence:**
  - `qa/2026-09-11_completed_comp-007a-upload.png`
  - `qa/2026-09-11_completed_comp-007b-display.png`

### 20260911_3 — BUG 1: Nha xe appears in dropdown after being added

#### TC-COMP-008 — Newly added carrier appears in the carrier dropdown

- **Given** a new nha xe (carrier) is added via the customer/carrier management page with `isCarrier=true`
- **When** the dispatcher opens the carrier picker in dispatch detail or the fleet management page
- **Then**:
  - The newly added carrier appears in the dropdown/search results
  - The carrier's operational name is displayed correctly
  - The carrier can be selected and assigned to a container
- **Assert:**
  - `GET /api/shipments/dispatch-fleet?resource=EXTERNAL_CARRIER&q=<carrier_name>` returns the new carrier
  - `browser_evaluate` on the carrier dropdown shows the new carrier option
- **Evidence:**
  - `qa/2026-09-11_completed_comp-008a-added.png`
  - `qa/2026-09-11_completed_comp-008b-dropdown.png`
  - `qa/2026-09-11_completed_comp-008_api.log`
- **Root cause:** Carrier query filters `isActive !== false` and `status = 'ACTIVE'`. New carriers must have `status = 'ACTIVE'` to appear.

### 20260911_3 — BUG 2: Detailed plan shows all containers (already covered)

#### TC-COMP-009 — Detailed plan shows ALL containers including unassigned

- **Given** dispatcher on the detailed plan page for a given date
- **When** the grid renders
- **Then**:
  - ALL containers for the selected date are shown, including those not yet assigned to a carrier
  - Unassigned containers show a "Chưa phân" state
  - Dispatcher can assign/reassign carriers at the detailed plan level
- **Assert:**
  - Row count = total containers for the date (assigned + unassigned)
  - At least one unassigned row visible with "Chưa phân" label
- **Evidence:**
  - `qa/2026-09-11_completed_comp-009.png`
- **Existing coverage:** `testplan/qa/2026-09-10_dispatch-detailed-plan.md` TC-DDP-001 through 004

### 20260911_3 — BUG 3: Container number supplement auto-approved

#### TC-COMP-010 — Container number supplement saves directly without approval

- **Given** CUS on the shipment detail page; container has no number yet
- **When** CUS enters a container number and saves
- **Then**:
  - The save completes immediately (no "gửi phê duyệt" step)
  - No approval vocabulary appears in the UI (`/duyệt|xét duyệt|gửi yêu cầu|chờ phê/` absent)
  - The container number is persisted in the DB
  - If the container is attached to an active trip, a 409 error is shown instead
- **Assert:**
  - `browser_evaluate(() => /duyệt|xét duyệt|gửi yêu cầu|chờ phê/.test(document.body.innerText))` = false
  - `PATCH /api/shipments/:id/containers/:containerId` with `containerNumber` returns 200
  - DB: `SELECT container_number FROM shipment_containers WHERE id = <id>` = the new number
- **Evidence:**
  - `qa/2026-09-11_completed_comp-010a-edit.png`
  - `qa/2026-09-11_completed_comp-010b-saved.png`
  - `qa/2026-09-11_completed_comp-010_api.log`
- **Existing coverage:** `testplan/18f4a2dd-verification-checklist.md` Cluster A

### 20260911_3 — BUG 4: Task tags format — actions on top, text below; no Tác vụ column

#### TC-COMP-011 — Task note format: tags on line 1, text on line 2; Tác vụ column removed

- **Given** dispatcher composing a task note in the dispatch detail plan editor
- **When** they select tags and enter free text
- **Then**:
  - The composed note shows tags on line 1 (joined by `; `) and free text on line 2
  - The "Tác vụ" column is NOT present in the detailed plan grid
  - The ghi chú column displays the full composed note
  - Long notes are truncated with ellipsis; clicking shows full content
- **Assert:**
  - `browser_evaluate(() => /Tác vụ/.test(document.querySelector('table, [role="table"]')?.innerText))` = false (no Tác vụ column header)
  - Composed note format matches: `TAG1; TAG2\nfree text`
  - `composeDriverTaskNote` output matches the displayed note
- **Evidence:**
  - `qa/2026-09-11_completed_comp-011a-editor.png`
  - `qa/2026-09-11_completed_comp-011b-grid.png`
- **Existing coverage:**
  - `shared/src/driverTaskNote.test.ts` — compose/parse round-trip
  - `backend/src/tests/driver-task-note-format.test.ts` — format v2 integration
  - `backend/src/tests/dispatch-task-tags.service.test.ts` — tag CRUD

### 20260911_3 — BUG 5: Driver app UI adjustments (same as BUG 2 of 20260911_2)

#### TC-COMP-012 — Driver app UI: factory abbreviation, route, container info, task chips

- **Given** driver on staging viewing trip detail
- **When** the trip detail renders
- **Then**:
  - Same as TC-COMP-005 (consolidated — this bug is a duplicate of 20260911_2 BUG 2)
- **Evidence:**
  - `qa/2026-09-11_completed_comp-012.png`
- **Existing coverage:** TC-COMP-005 above; `testplan/qa/2026-09-10_driver-app-enhancements.md`

---

## Coverage mapping to existing testplan

| Bug/Feature | Existing coverage | New regression TC |
|---|---|---|
| 20260911_1 BUG 1 (reassign before accept) | TC-DV-DISPATCH-052 | TC-COMP-001 |
| 20260911_1 BUG 2 (table layout) | None | TC-COMP-002 |
| 20260911_1 BUG 3 (button placement) | None | TC-COMP-003 |
| 20260911_2 BUG 1 (driver detail) | TC-DA-001 through 005 | TC-COMP-004 |
| 20260911_2 BUG 2 (driver app UI) | TC-DA-001, 002, 006 | TC-COMP-005 |
| 20260911_2 FEATURE 1 (customer cards) | None | TC-COMP-006 |
| 20260911_2 FEATURE 2 (handover photos) | None | TC-COMP-007 |
| 20260911_3 BUG 1 (nha xe dropdown) | None | TC-COMP-008 |
| 20260911_3 BUG 2 (all containers) | TC-DDP-001 through 004 | TC-COMP-009 |
| 20260911_3 BUG 3 (auto-approve) | 18f4a2dd Cluster A | TC-COMP-010 |
| 20260911_3 BUG 4 (task tags format) | driverTaskNote.test.ts | TC-COMP-011 |
| 20260911_3 BUG 5 (driver app UI) | TC-DA-* | TC-COMP-012 |

## QA gates

```
pnpm lint                           # 0 errors
cd backend && npx tsc --noEmit      # 0 errors
cd backend && pnpm test             # all pass
cd frontend && npx tsc -b           # 0 errors
cd frontend && pnpm test            # all pass
make build                          # succeeds
```

## What is NOT covered

- Mobile viewport for dispatch detail (desktop-first)
- Landscape orientation
- Offline/PWA paths
- Concurrency on carrier assignment
- Staging rollback path
- Customer card layout responsive breakpoints at all sizes
- Delivery handover photo size limits / EXIF stripping
