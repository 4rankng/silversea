# Test plan — Gomhang hygiene + grid polish (các dòng còn lại sau wave 60d0c576)

Scope: FE + wire read-side (settlement summary mang tấn/CBM) trên nền
60d0c576. KHÔNG đụng `pages/MasterPlanPage*` + `features/dispatch/master-plan/*`
(lane khác sở hữu) — sót "BKS báo khách" trong `DispatchAllocationLclDialog`
(master-plan) liệt kê nhưng để lane đó sửa.

## Case GP-01 — CUS floating bar mang tổng tấn/CBM như bar ĐV

Steps (CUS Chi phí – Quyết toán, bật [📦 Gộp hàng], tick ≥1 lô):

1. Wire `shipment-debit-summary` trả `cargoWeightKg`/`cargoVolumeCbm` per lot.
2. Floating bar: "Đang chọn N lô: Tổng X tấn | Y CBM — Lô 1 giữ 100%…".
3. Lot không kg hoặc CBM → tổng bỏ thành phần đó, không bịa 0.

## Case GP-02 — Tag "Ghép thu cước cùng Lô 1" hiển thị gọn

1. Lô thành viên nhóm rev (hoặc lý do override dài) render tag dưới cước.
2. Tag = 1 dòng, truncate + `title` = toàn văn (tooltip) — cả desktop row lẫn
   phone card lẫn strip NHÓM GHÉP. NGHĨA (text theo wire) giữ nguyên.

## Case GP-03 — Hết "BKS báo khách" trong dialog ĐV gán/nhóm

1. `LclGroupTruckEditDialog` (Đổi BKS nhóm ĐV): chỉ còn BKS thực — không ô
   "BKS báo khách (ảo)", payload không `billingTruckNo`.
2. `DetailedPlanGrid` inline sửa BKS nhóm: bỏ ô "BKS báo khách (riêng lô này)",
   validation theo BKS thực, payload không `billingTruckNo`.
3. `AssignTruckGroupDialog` giữ nguyên 4 trường (GH-FE-02 trước đó).
4. Sót ngoài scope: `DispatchAllocationLclDialog` (master-plan lane — KHÔNG đụng).

## Case GP-04 — Server-error gộp CUS khác-KH không im lặng

1. Client gate: chọn lô khác KH (kể cả lô `customerId` null) → chặn trước khi
   gọi API, thông báo rõ "cùng một khách hàng".
2. Server 400 (gate lọt, BE từ chối — vd customerId stale) → FE hiện lỗi rõ:
   inline `role=alert` + error toast, dialog giữ nguyên, sửa được rồi lưu lại.

## Case GP-05 — Card mobile: status badge vs nút ⋯

1. 390px: chip trạng thái ("Đã phát lệnh cho tài xế"…) 1 dòng, max-width +
   ellipsis, `title` = toàn văn.
2. Chip cách nút ⋯ ≥8px (head gap + chip co lại trước, ⋯ không bị đẩy/đè).

## Case GP-06 — Touch target ⋯/tick ≥44px trên card

1. Mọi dpcard: trigger ⋯ ≥44px, không bị flex co dưới 44 khi head chật.
2. Tick chọn (kể cả compact merge-mode khi head có thêm tick): vùng chạm ≥44px.

## Evidence

- Vitest scoped: ShipmentDebitPage.lcl-merge, ShipmentDebitRecords,
  MergeRevGroupDialog (mới), DispatchIssueStatus, DetailedPlanGrid
  (lcl-truck-edit/row-menu/compact-cards), LclGroupTruckEditDialog.
- Playwright 390: `qa/2026-10-23-gomhang-polish/` — 1 ảnh mục GP-01 (bar có
  số tấn/CBM) + 1 ảnh GP-05 (badge vs ⋯).
