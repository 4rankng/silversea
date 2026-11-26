# SIL-1091 (id 1267) — Đổi tên nhà máy không được lặng lẽ đổi tên trên lô đang chạy (K3.103)

Case ID: TC-SIL1091-FACTORY-SNAPSHOT-01
Feature: tên Nhà máy hiển thị trên lô hàng (chi tiết lô, danh sách lô, workspace CUS, tài liệu debit) phải giữ nguyên như lúc tạo lô; đổi tên trong danh mục Nhà máy không được trượt vào các lô đã có dữ liệu.

## Repro (staging vantai.tingting.vip, build trước fix)
1. Tạo nhà máy "R2E-K103-XM" (mã R2E-K103-01, khách Long Minh) qua POST /api/shipments/operational-sites.
2. Tạo lô dùng nhà máy đó → lô hiện "R2E-K103-XM".
3. PATCH /api/shipments/operational-sites/22 đổi tên thành "R2E-K103-XM2".
4. Mở lại lô: tên nhà máy trên lô ĐỔI NGAY thành "R2E-K103-XM2" — mọi bề mặt resolve tên từ join live `operational_sites` (ưu tiên tên danh mục trước `factory_name`), version lô không đổi, lịch sử lô không ghi gì.

Kỳ vọng (KB §3.5.5 K3.103): lô giữ nguyên tên nhà máy lúc tạo.

## Phương án đã chọn (theo spec ticket)
Snapshot tên tại thời điểm tạo/gán nhà máy:
- Cột mới `shipments.factory_name_snapshot` + `shipment_containers.factory_name_snapshot` (varchar 255). Reference `operational_site_id` GIỮ NGUYÊN cho tìm kiếm/lọc.
- Ghi snapshot tại mọi điểm ghi `operational_site_id` (tạo lô, sửa định danh, reconcile container, CUS sửa dòng container, CUS thêm container). Xóa nhà máy khỏi lô ⇒ snapshot null theo reference.
- Mọi bề mặt hiển thị tên nhà máy của lô đọc snapshot TRƯỚC, chỉ fallback join live khi snapshot null (dòng cũ chưa backfill).
- Migration backfill: dòng cũ được đóng băng TÊN HIỆN TẠI (không đổi tên gì — đúng ràng buộc "KHÔNG đổi tên trên các lô đã có dữ liệu"); từ đó rename sau này không còn trượt vào lô cũ.
- PATCH rename master data: audit đã có sẵn (ENTITY_UPDATED generic); bổ sung stash old→new `name`/`shortName` lên `res.locals.auditFieldChanges` (same channel K4.61/SIL-1046) để dòng audit mang được giá trị cũ.

## Bề mặt display phải ưu tiên snapshot
- `shipment-detail-reads.service.ts` `resolveEffectiveFactoryName` (header chi tiết lô).
- `cus-workspace-builders.service.ts` `effectiveFactoryNames` + nhãn nhóm lịch hẹn (`buildAppointmentGroups`, precedence theo tầng: snapshot từng tầng dẫn live cùng tầng).
- `cus-shipment-workspace-reads.service.ts` container flat row `factoryName` (cũng là nguồn ledger chi tiết phía ĐV).
- `shipment-queries/list-summaries.ts`: `loadShipmentListFactoryNames`, `loadShipmentListAppointmentGroups`, `listShipmentsPaginated.operationalSiteName`.
- `driver.service.ts` + `driver-journey-board.service.ts`: các nhãn Nhà máy của lái xe.
- `accounting-debit-close.service.ts`, `accounting-transport-register.service.ts` (+ tìm kiếm ilike), `debit-merge.service.ts`, `ops-expenses.service.ts` (Kiểm soát phiếu), `shipment-debit-summary.service.ts`.
- Helper thuần dùng chung: `operationalSiteDisplayLabel` + `factoryLabelFromSnapshot` + `findFactorySiteDisplayLabel` (shipment-lifecycle-shared.service.ts, có unit test `sil1091-factory-snapshot.test.ts`).

## Không thuộc phạm vi snapshot (chủ đích)
- `billing-document-draft.service.ts` (Debit/ hóa đơn in): tài liệu tài pháp dùng authority TÊN ĐẦY ĐŨ của danh mục (coalesce site.name) — snapshot chỉ lưu nhãn hiển thị (short-first), đưa nhãn short vào tài liệu pháp lý là hạ cấp đầu ra. Đổi tên nhà máy phản ánh trên tài liệu in SAU thời điểm in là đúng nghĩa master data cho hóa đơn; luật K3.103 áp cho bề mặt VẬN HÀNH của lô (đã liệt kê trên).
- `dispatch-planning-detail-plan-read.service.ts` `customerRoute.factoryName`: đã đọc snapshot fulfillment (`siteSnapshot.deliverySite`) đóng băng lúc decompose — không join live, không trượt rename.

## Expected (sau khi sửa)
- Lô tạo sau fix: rename danh mục ⇒ tên trên lô không đổi (mọi bề mặt trên).
- Lô cũ (trước fix): giữ tên đang hiển thị tại thời điểm backfill; rename sau backfill không trượt vào.
- Tìm kiếm/lọc theo nhà máy (site id, ilike tên) vẫn hoạt động qua reference + snapshot.
- Audit log PATCH /operational-sites/:id có metadata.changes {field: name/shortName, before, after}.

## Not covered bởi hồ sơ này
- Kho (CFS/Cảng) `pickupWarehouseSiteId` và cảng nâng/hạ (SIL-1046 đã có phương án riêng) — không thuộc ticket.
- Bằng chứng UI DRIVEN (rung 3): lane thực hiện verify mức API/DB (rung 2) trên stack local; không drive UI thật.
