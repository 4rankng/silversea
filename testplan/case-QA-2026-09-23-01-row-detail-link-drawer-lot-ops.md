# Case QA-2026-09-23-01 — Row "Chi tiết" link + lot ops (thêm/xóa cont, xóa lô) in the drawer (card `20260923_1`)

- **Case ID:** QA-2026-09-23-01
- **Reported:** 2026-09-23, card `20260923_1` (operator ruling, direct exchange + desktop screenshot of
  "Tổng quan lô hàng" with the red-circled chevron). Second clarification same session: *"drawer khi bấm
  Chi tiết button, không phải trang shipment detail"*.
- **Verbatim requirement:** *"thay vì dùng chevron hãy dùng link button Chi tiết, bỏ icon trash xoá lô ở
  dòng đi, muốn xoá lô thì bấm vào chi tiết trong đó có nút thêm cont xoa cont và xoá lô"*.
- **Surface:** the `/shipments` CUS workboard — the row's Trạng thái cell and the Chi tiết drawer
  (header lot bar + container ledger).
- **Status:** case PREPARED — code landed (see the fix commit in `plans/reports/c1-drawer-deepseek.md`);
  rung 3 (UI DRIVEN, desktop 1280/1440/1920/2560 + mobile 390) is owed to the QA lane.

## Why this case exists (regression fence)

The first landing of this card (`cd862de4`) shipped three surface defects that its own suite could not see,
because the assertions read `textContent`/DOM presence instead of what the operator actually sees:

1. `.cus-dashboard-detail [data-text] { display: none }` (chevron-era icon-only override) survived the
   chevron's removal → the row action rendered as an EMPTY clickable box.
2. The drawer's "Xóa lô" rendered only when `operational.deletable === true` → a dispatched lot had no
   affordance and no reason.
3. `.cus-container-row__remove` was hover-reveal only → invisible on touch (the operator's own root cause).

## Steps (fixture: FCL lot with 3 containers, one of them attached to a live trip)

1. Open `/shipments` as CUS (`testplan/testaccounts.txt`), no date filter.
2. Inspect the Trạng thái cell of any lot row.
3. Press "Chi tiết" on a lot that still has containers.
4. In the drawer, press "Xóa lô" while containers remain.
5. Remove every container whose row is not attached to a live trip (icon Xóa on the row).
6. Press "Xóa lô" again with the lot container-free.
7. Repeat step 2/4 on a lot whose `operational.deletable` is false (trip already issued).
8. Repeat steps 2–5 at a 390px viewport (mobile) / touch device.

## Expected behavior

| # | Expectation |
|---|---|
| 1 | The row shows a **text-only link button "Chi tiết"** — no chevron icon, no pill/border chrome, and the label is **visible** (not hidden by a `[data-text]` override). Pressing it opens the **drawer** (never navigates to `/shipments-detail`). |
| 2 | The row carries **no** lot-delete affordance — no trash icon, no "Xóa lô hàng" control. |
| 3 | The drawer header shows **"Xóa lô"** in every state. With containers remaining it does NOT call the delete API; it shows the inline error `Chưa xoá hết container — hãy xoá bớt/xoá hết container trước khi xoá lô` (inline/toast, never a raw `alert`). |
| 4 | With zero containers and a dispatched lot (`deletable === false`) it shows the lifecycle guard's own reason: `Không thể xóa lô hàng đã có container được điều xe. Chỉ xóa được khi mọi container chưa phát lệnh.` |
| 5 | With zero containers and `deletable === true` it routes into the existing confirmed delete flow (reason field → `deleteCusShipment`) → lot leaves "Tổng quan" and the drawer closes. |
| 6 | The container ledger offers **"Thêm container" directly below the last container row**; the form takes số cont, loại cont (house `UuiSelectField` — native selects are banned), trọng lượng, ngày-giờ đóng/trả; success adds the row and refreshes the lot's container summary + weight. |
| 7 | Each container row offers an **Xóa icon** (icon-only with `aria-label`, design law §4). It is **visible on touch/coarse pointers** (no hover available) and hidden-until-hover on fine-pointer desktop, mirroring the existing copy affordance. |
| 8 | A container row attached to a **live** trip is disabled with tooltip `Không thể xóa container đã gắn chuyến xe`; a row whose trip is **CANCELED** stays deletable (over-blocking has no in-UI recovery). The backend 409 (`Container đã gắn chuyến xe (…)`) stays authoritative and surfaces as a toast when the client state is stale. |
| 9 | Both FCL and LCL lots behave identically for steps 3–8. |
| 10 | The "Tổng quan hàng hóa" cell opens **quick-edit cargo for every cargo mode**; the "Quản lý container" dialog is gone (component + CSS + wiring + assertions deleted). |

## Out of scope

- `/shipments-detail` (the standalone container page) — untouched by this ruling.
- Backend guards/contracts — unchanged; the client only stops inviting doomed clicks.
- Quick-edit cargo field semantics.

## Automated fence (red-first, must stay green)

- `frontend/src/pages/ShipmentsPage.test.tsx`
  - `row actions: text "Chi tiết" without an icon; no trash on the row` — asserts the `[data-text]` label
    is visible and the `.cus-dashboard-detail` rule carries no border/background chrome.
  - `keeps Xóa lô reachable and states why a dispatched lot cannot be deleted (card 20260923_1)`.
  - `keeps the container remove icon reachable on touch and blocks trip-attached rows (card 20260923_1)`.
  - `places Thêm container directly below the last container row (card 20260923_1)`.
  - `blocks Xóa lô while containers remain; deletes with the confirmed flow when clear (card 20260923_1)`.
  - `adds a container from the drawer and refreshes the row summary immediately (card 20260923_1)`.
  - `surfaces the 409 guard on a trip-attached container removal (card 20260923_1)`.
- Evidence: `qa/2026-09-23_c1-drawer-ops_red-first.log` (RED before the fix, GREEN after),
  `qa/2026-09-23_c1-drawer-ops_frontend-vitest.log`.
