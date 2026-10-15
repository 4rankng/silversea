# FB-095 / QA C-1 — Nhóm tan (lone-survivor dissolve) xóa mất loại xe của lô sống sót

Ngày: 2026-10-16 · nguồn: QA staging report-only build 104dfd75 (`qa/2026-10-16_fb092-095-staging-qa.md`, finding C-1, commit cebe7697) · mức CAO

## Vấn đề đã báo

Nhóm 2 lô (COST hoặc REV), tách Lô 1 → survivor được promote và nhóm tan
(`dissolved:true`) nhưng survivor **mất `costVehicleClassId`/`revVehicleClassId`**
(QA api-matrix T3c: `cls:null`; T7b qua đường soft-delete cũng null). Board điều
vận/kế toán mất nhãn loại xe ("Lẻ · Trả: 5T" → "Lẻ"), Debit Note (FB-094) mất nguồn
label loại xe. Tiền + BKS vẫn giữ đúng.

## Nguyên nhân gốc

`backend/src/services/lcl-grouping.service.ts` — nhánh `dissolved` của
`rewriteSurvivors()` gọi `clearDimensionPatch(dimension)` vốn set cả
`costVehicleClassId: null` / `revVehicleClassId: null`, mâu thuẫn với comment ngay
trên nó ("the survivor keeps its class + BKS + money") và hợp đồng commit FB-095
("a lone survivor dissolves the group (ungrouped, keeps class + BKS + money)").

## Cách sửa

Tách hai patch: patch **dissolve survivor** chỉ null group id/order (giữ
`*VehicleClassId`); patch **leaver** (rời nhóm) giữ nguyên hành vi hôm nay (null cả
class stamp). Đường soft-delete principal (`promoteLclGroupsOnShipmentDelete`) đi
qua cùng `rewriteSurvivors` nên được sửa cùng lớp.

## Case ID

- **C1-01**: nhóm COST 2 lô class 5T, `unmerge` Lô 1 → `dissolved:true`; survivor giữ
  `costVehicleClassId = 5T`, `costGroupId/costGroupOrder = null` (red-first: hành vi cũ
  null mất class) — `lcl-grouping.test.ts`.
- **C1-02**: tương tự chiều REV với 3.5T — survivor giữ `revVehicleClassId`,
  `revGroupId/revGroupOrder = null`.
- **C1-03 (delete-path)**: soft-delete principal → survivor dissolve giữ
  `costVehicleClassId` (FB095-06 bổ sung assertion).
- **C1-04 (không hồi quy)**: member-exit / promote không dissolve giữ nguyên hành vi
  (FB095-01/04 xanh nguyên vẹn — leaver vẫn clear dimension như cũ, survivors renumber).

## Phạm vi hồi quy trước khi sửa

| # | Khu vực | Rủi ro | Kiểm bằng |
|---|---|---|---|
| R1 | FB095-01..06 (`lcl-grouping.test.ts`) | Sửa dissolve làm lệch promote/renumber/guards | suite xanh nguyên vẹn sau bổ sung |
| R2 | Board/kế toán đọc `*VehicleClassId` (`accounting-debit-close.service.ts`, debit summary, Debit Note label) | Class giữ lại nhưng label sai | FB-093/094 tests trong cùng suite xanh |
| R3 | Leaver path (member exit, principal exit không dissolve) | Fix dính sang leaver | FB095-01 (leaver costGroupId null, không assert class) + FB095-04 giữ xanh |
