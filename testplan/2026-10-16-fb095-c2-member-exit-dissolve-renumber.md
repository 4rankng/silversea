# FB-095 / QA C-2 — Tách member: survivor giữ nhóm ma, response/audit nói dối với DB

Ngày: 2026-10-16 · nguồn: QA staging round 2, build 8971fde9 (FB-095 LCL
merge/unmerge) · mức CAO.

## Vấn đề đã báo

`unmergeLclLot` nhánh member-exit (`leaverOrder !== 1`) chỉ clear leaver rồi
return — không bao giờ gọi `rewriteSurvivors` (grep: đúng 3 call-site — định
nghĩa, `promotePrincipalOnRemoval`, `promoteLclGroupsOnShipmentDelete`). Hậu quả
live trên staging:

- **(a)** nhóm REV 2 lô, tách member (order 2) → 200 `{dissolved:true,
  remaining:[]}` nhưng survivor vẫn giữ `revGroupId`/`revGroupOrder`/
  `revVehicleClassId` (nhóm ma) → merge lại trả 409 "Lô ... đã thuộc nhóm ghép".
- **(b)** nhóm COST 3 lô, tách member giữa → DB còn order 1 và 3 (gap) với 2
  member, trong khi response claim đã renumber `[{I,1},{J,2}]` — response nói
  dối với DB.
- **(c)** audit `SHIPMENT_LCL_GROUP_UNMERGED` payload `dissolved:true` theo
  response, mâu thuẫn DB.

Test hiện có FB095-04 chỉ assert response (`remaining` renumbered) mà không đọc
DB row — đúng chỗ bug lọt lưới.

## Nguyên nhân gốc

`backend/src/services/lcl-grouping.service.ts` — `unmergeLclLot` tính
`survivors`, `dissolved = survivors.length <= 1`, `remaining` renumbered index+1
rồi ghi vào cả response lẫn audit, nhưng nhánh member-exit không có lệnh ghi DB
nào cho survivors.

## Cách sửa

Nhánh member-exit gọi `rewriteSurvivors(tx, dimension, survivors, groupId,
actor)` — đúng engine C-1 đã sửa (commit 8af79aa8): 2 survivor trở lên →
renumber `[1..N]` dưới cùng groupId; đúng 1 survivor → dissolve (chỉ null
membership, survivor GIỮ vehicle class theo luật FB-095/C-1). Tiền không di
chuyển khi member rời (luật FB-095-04 giữ nguyên). Response/audit từ đó trùng
DB vì cả ba cùng tính từ mảng `survivors` đã sắp thứ tự.

## Case ID

- **C2-01**: nhóm REV 2 lô, member (order 2) exit → survivor `revGroupId`/
  `revGroupOrder` null, GIỮ `revVehicleClassId`; leaver clear đủ cả class;
  merge REV survivor với lô mới THÀNH CÔNG (không còn 409); audit payload
  `dissolved:true` + `remaining:[]` trùng DB — `lcl-grouping.test.ts`.
- **C2-02**: nhóm COST 3 lô, member giữa (order 2) exit → survivors renumber
  contiguous `[1,2]` trong DB (không gap), response `remaining` == DB, audit ==
  response — `lcl-grouping.test.ts`.
- **C2-03 (củng cố FB095-04)**: test member-exit hiện có bổ sung assert DB row
  (renumber COST + REV) — test này hụt đúng chỗ bug.

## Phạm vi hồi quy trước khi sửa

| # | Khu vực | Rủi ro | Kiểm bằng |
|---|---|---|---|
| R1 | FB095-01..06 (`lcl-grouping.test.ts`) | rewriteSurvivors giờ chạy thêm 1 đường — lệch promote/guards | suite xanh nguyên vẹn sau bổ sung |
| R2 | Đường principal-exit + soft-delete (đã có rewriteSurvivors) | Không đổi code path đó | FB095-01/02/06 + C1-01..03 xanh |
| R3 | Merge path (`assertGroupable` 409) | Không đổi merge | C2-01 merge lại thành công; FB092-06 xanh |
| R4 | Frontend đọc response unmerge | Response shape không đổi | fe tsc + vitest xanh |

Ghi chú môi trường: integration suite backend bị treo `client.end()` pool leak +
5 file known-red (pre-existing, không thuộc phạm vi này) — chạy file
`lcl-grouping.test.ts` riêng để lấy evidence.
