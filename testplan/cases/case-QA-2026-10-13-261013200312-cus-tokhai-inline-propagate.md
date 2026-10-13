# Case QA-2026-10-13-261013200312 — CUS "Chi tiết lô hàng": tờ khai per-container entry + copy + divergence

## Claim
1. On `/shipments-detail` (CUS "Chi tiết lô hàng" workboard), the per-container
   "Chỉnh sửa ô chứng từ và hãng tàu" inline editor carries a **Số tờ khai field per
   container** (dev-lead ruling 2026-10-13: "số tờ khai … chuyển thành thông tin nhập
   theo từng cont"). CUS adds/edits the number in place — no tab-out to another surface.
   Previously the editor deferred tờ khai ("Tờ khai dùng luồng chứng từ có kiểm soát
   riêng") and the cell showed "Chưa có tờ khai" with no inline remedy.
2. **Copy propagation**: an explicit "Copy số tờ khai sang N cont chưa có số" button in
   the editor repeats the source container's number onto the lot's still-empty containers
   in ONE server call; it never overwrites a container that already carries a number.
3. **Divergence after copy**: each container's number stays individually editable.
4. **Single-container lot unchanged**: no copy affordance (no sibling to fill); the field
   edits exactly like any other container.

## Data model (ruling)
- `shipment_containers.declaration_number` (new column, migration
  `20261013210105_container_declaration_number`) is the per-cont operational truth.
- Backfill `20261013210106…`: each lot's first non-empty declaration entity number
  (id-asc) lands on EVERY container of that lot.
- The `shipment_declarations` ENTITY table is unchanged (globally-unique numbers,
  documents flow, finance exports) — its unique index cannot hold the same number on N
  rows, which is why the per-cont value is an attribute, not a linked declaration row.

## Reproduce (pre-fix defect)
1. Log in as CUS, open `/shipments-detail`, pick a multi-container lot.
2. Click a row's "Chứng từ & hãng tàu" cell: the editor offered only Nhập/Xuất,
   Số Bill/Booking, Hãng tàu — no tờ khai field — while the cell showed
   "Chưa có tờ khai". Numbers could only be entered per-LOT on other surfaces.

## Expected behavior
- Editor: `Số tờ khai` input (max 50, trim) gated by `fieldAccess.declarationNumber`
  (CUS/ADMIN/MANAGER; READ_ONLY with reason under an active accounting lock).
- Save: lot document fields PATCH the shipment only when they changed; the number rides
  the container-line command (`POST /shipments/cus-workspace/:id/containers/:cid`) on
  the latest version — a number-only save never bumps the lot via the shipment PATCH.
- Copy: `POST /shipments/cus-workspace/:id/containers/:cid/copy-declaration` fills only
  empty siblings; returns `updatedContainerIds` + `shipmentVersion`; toast reports the
  real count. Role gate CUS/ADMIN/MANAGER; cross-lot duplicate numbers are refused
  (container attribute and declaration entity stores both checked).
- Displays: the flat row shows the container's own number; the workboard Chứng từ cell
  and search see the union (per-cont + entity) DISTINCT; the "Thiếu Số tờ khai"
  missing-bit clears when either store holds a number.

## Verification
- `frontend/src/features/shipments/cus/use-cus-detail.declarations.test.tsx`
  (per-cont edit contract incl. PATCH-skip and clear; copy = one call + refetch;
  409 self-heal; single-container-lot rejection surfaces).
- `frontend/src/features/shipments/detail/ShipmentContainerLedger.test.tsx`
  (editor seed/edit/save draft; copy visibility + trigger; READ_ONLY lock; per-cont
  display of copied then diverged numbers).
- `backend/src/tests/unit/cus-container-declaration-wire.test.ts`
  (schema-level wire contract: trim/nullable/max-50, copy request/result shapes).
