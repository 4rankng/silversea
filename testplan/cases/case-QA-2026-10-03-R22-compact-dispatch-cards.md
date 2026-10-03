# Case QA-2026-10-03-R22 — Compact dispatch records and cards layout (card 20261002_287, R22)

## Claim
The dispatch records and cards on `/dispatch-detail` (Kế hoạch Chi tiết) eliminate excessive spacing and stacked label/value gaps around customer, bill, route, container, carrier, plate, driver, notes, status, edit, and send actions.
1. The height of each dispatch card decreases by at least 25% to 30% through restructured information grids and tighter vertical budgeting.
2. Related information (Biển số & Lái xe, Tuyến đường & Chiều) sit on the same line or in a compact pair.
3. Action buttons are compact with height not exceeding 36px.
4. Both desktop and mobile views display more trips per screen without losing clarity or readability.

## Reproduce (pre-fix defect)
1. Login as `dieuvan` (or `admin`) at `http://localhost:7175`, navigate to `/dispatch-detail`.
2. On viewport 390×844 (mobile phone):
   - The dispatch card stacks 7 rows vertically, with separate rows for schedule, route, ports, documents, container, assignment, and notes.
   - Inside the assignment cell, carrier, plate, driver, and status each take their own line (driver takes full width below plate).
   - In the documents cell, route and direction (Nhập / Xuất) sit on separate stacked lines.
   - The action button in notes ("Hoàn thành") stretches to full width (100%) with 40px height.
   - Card height is ~470px, displaying only 1 to 2 cards per screen, requiring heavy scrolling.
3. On desktop (viewport 1440×900):
   - Table rows have 12px vertical padding on cells.
   - Assignment cell stacks 5 lines (carrier, plate, driver, status, edit button), inflating row height to ~125px.

## Expected behavior
- On mobile (viewport 390px):
  - Card height drops by ≥ 25%–30% (from ~470px down to ~260–310px).
  - Biển số and Lái xe sit together on the same row (`15C-123.45 · Nguyễn Văn A` or `Chưa phân xe`).
  - Tuyến đường and Chiều sit together on the same line (`Hải Phòng - Hà Nội · Nhập`).
  - Action buttons ("Sửa", "Hoàn thành", "Ghép chuyến") are compact, with heights ≤ 36px.
  - More cards visible per screen without loss of legibility.
- On desktop (viewport 1440px):
  - Cell padding tightened from 12px to 8px 10px.
  - Assignment cell pairs plate & driver on one line and status & edit button on one line.
  - Tuyến đường & Chiều pair on one line.
  - Action buttons ≤ 36px.
  - More rows visible on desktop screens without scrolling.

## Automated pins
- `frontend/src/features/dispatch/detailed-plan/DetailedPlanGrid.test.tsx` — verifies compact pairing of Tuyến đường & Chiều, card height reduction, button size bounds.
- `frontend/src/features/dispatch/detailed-plan/DispatchPlanEditorCell.test.tsx` — verifies Biển số & Lái xe rendered together in vehicle group, compact action group with status and edit button.
- `frontend/src/features/dispatch/detailed-plan/DetailedPlanGrid.compact-cards.styles.test.ts` — CSS regression test pinning card height reduction, inline pairing of plate/driver and route/direction, and action button ceiling ≤ 36px.
