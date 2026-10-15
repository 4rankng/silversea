# FB-091 — LCL hiển thị sai trên Kế hoạch Tổng quát

Nguồn: DEV SPEC §II.2.1 · kanban/TODO/FB-091-lcl-kehoach-tongquat-display.md
Ngày: 2026-10-15 · P1 · độc lập với FB-090

## Vấn đề đã báo

Một lô **Hàng lẻ** (LCL) mở ở `/dispatch` (Kế hoạch Tổng quát) hiển thị:

| Cột | Hiện tại | Đúng phải là |
|---|---|---|
| Cảng nâng | `Chưa có cont` | Kho lấy (CUS nhập ở intake) |
| Cảng hạ | `Chưa có cont` | Điểm trả (nhà máy / site giao) |
| Tổng quan hàng hóa | `Chưa có cont` | `5 PALLET` / `1.922 kg · 4 CBM` |

## Phạm vi hồi quy trước khi sửa

| # | Khu vực | Rủi ro hồi quy | Kiểm bằng |
|---|---|---|---|
| R1 | Dòng FCL trên cùng lưới | Nhánh LCL nuốt cả container demand / cặp cảng của FCL | `MasterPlanGrid.lcl-display.test.tsx` case FCL + `MasterPlanGrid.test.tsx` (869 dòng, không sửa 1 dòng nào) |
| R2 | Xuất XLSX phải khớp màn hình | Export gọi helper riêng làm lệch với lưới | `mapMasterPlanExportRow` dùng chung `cargoCellLines` / `aggregateContainerPortGroupLines`; `masterPlanExport.test.ts` xanh nguyên vẹn |
| R3 | Lọc 1 ngày | Lọc ngày làm trắng site của lô LCL | Case "does not narrow an LCL lot on a single-day filter" |
| R4 | CBM là tuỳ chọn (helpdesk 2026-10-13) | Ép `CBM` vào dòng khi lô không có thể tích | Case "drops the CBM measure — not the line" |
| R5 | Query list có 2 biến thể | Chỉ vá `pageQuery`, bỏ sót `rowsQuery` | Case backend chạy cả `includeDispatchSummary=false/true` |
| R6 | Lô chưa chọn kho | In `null`/`undefined` ra ô | Case "reads — on each side" + case null của backend |

## Nguyên nhân gốc (đã xác minh trong mã)

1. **Cảng nâng / Cảng hạ.** `aggregateContainerPortGroupLines()` chỉ đọc
   `containerPortGroups`. Lô LCL không được có container (`shipment-fulfillment.service.ts`
   cấm LCL + container), nên `containerPortGroups` luôn rỗng → nhánh
   `allGroups.length === 0` trả về placeholder `Chưa có cont` cho cả hai phía.
   Dữ liệu CUS nhập (`pickup_warehouse_site_id`, `operational_site_id`) không
   được project ra danh sách: `list-summaries.ts` chỉ join `operational_sites`
   trên `operational_site_id`, và còn gộp tên site đó vào `factoryName`.
2. **Tổng quan hàng hóa.** Ô gọi `formatContainerSummaryLines(containerTypeSummary)`;
   với LCL, `containerTypeSummary` là `null` nên hàm trả đúng mảng
   `['Chưa có cont']` (`MasterPlanGrid.tsx:87`).

## Cách sửa

- **Backend** (`shipment-queries/list-summaries.ts`): join thêm alias
  `shipment_list_pickup_warehouse_site` trên `pickup_warehouse_site_id`, chọn
  `pickupWarehouseSiteName` (short-name authority như mọi site khác) trong **cả**
  `pageQuery` và `rowsQuery`, và project ra item.
- **Frontend** (`MasterPlanGrid.tsx`):
  - `aggregateContainerPortGroupLines()` có nhánh LCL đặt trước: Cảng nâng =
    `pickupWarehouseSiteName`, Cảng hạ = `factoryName` (cùng `operational_site_id`
    mà facet "Điểm trả" của Kế hoạch Chi tiết lọc — `dispatch-detail-plan-fulfillment-less.ts:93`).
    Thiếu site → `—`.
  - `cargoCellLines()` mới, là **nguồn duy nhất** cho lưới và export: FCL giữ nguyên
    (nhu cầu container + trọng lượng), LCL in `[số lượng] [bao bì]` / `[kg] · [CBM]`.
- **Dùng chung**: `masterPlanExport.ts` bỏ phép tính trùng lặp, gọi `cargoCellLines`.

## Quyết định thiết kế

- **Tra cứu catalog (Untitled UI PRO `search_components`)**: kết quả trả về đều là
  metrics/pricing section dạng marketing, không có pattern cho ô bảng dữ liệu.
  Ô hàng hóa vốn đã là text-only 2 dòng (`.master-plan-grid__cargo-summary`), nên
  **giữ nguyên layout text-only**, không thêm badge/pill — đúng luật §1
  `docs/design-guidelines.md` ("data cells are text-only", "no pill bubbles").
- **Trục đo**: `formatWeight` (kg) đã có sẵn trong cột; thêm `formatVolumeCbm` cạnh
  nó trong `lib/format.ts` với 3 chữ số thập phân khớp `numeric(12,3)` của
  `cargo_volume_cbm`. Không dùng `formatQuantity` của CUS (cap 2 chữ số) để tránh
  mất chữ số thứ 3.

## Kết quả mong đợi

Dòng LCL trên `/dispatch` hiện đúng Kho lấy / Điểm trả và `5 PALLET` /
`1.922 kg · 4 CBM`; dòng FCL không đổi; sheet XLSX khớp màn hình.

## Bằng chứng hồi quy (đã chạy)

- **ĐỎ thật, quan sát trước khi sửa** (đã tạm gỡ 2 nhánh LCL rồi chạy lại):
  - `MasterPlanGrid.lcl-display.test.tsx`: **9 fail / 1 pass** — case FCL vẫn pass
    (đúng: hành vi FCL không được đổi).
  - `shipment-list-lcl-site-projection.test.ts`: **fail** —
    `actual: undefined, expected: 'Kho lấy …'`.
- **XANH sau khi sửa**: cùng hai suite **10/10 pass** và **1/1 pass**.

## Chưa phủ

- Không migrate `formatQuantity` của CUS sang `formatVolumeCbm` — ngoài phạm vi thẻ này,
  các test pin của CUS phải xanh nguyên vẹn.

## Điểm cần owner ruling (không tự sửa)

1. **§1 "một khái niệm, một chỗ" vs Cảng hạ.** `loadShipmentListFactoryNames` đổ
   `operational_site_id` của lô LCL (không có container) thành `factoryNames`, nên ô
   "Khách hàng & nhà máy" đã hiện site giao. Sau thay đổi này cùng giá trị hiện ở
   "Cảng hạ". Thẻ chỉ yêu cầu phía Cảng hạ, nên **chưa xoá dòng ở ô khách hàng** —
   đó là quyết định hiển thị sản phẩm ngoài phạm vi thẻ.
2. **§1 "giá trị rỗng phải gọi tên" trong ô hàng hóa.** Nhánh FCL dùng placeholder có
   nghĩa (`Chưa có cont`); nhánh LCL dùng `—`. `Chưa có cont` sai (lô LCL không bao
   giờ có container) và thẻ không chốt copy thay thế cho ô này, nên tạm để `—`.

## Ghi chú reviewer

`code-reviewer` chạy độc lập, 2 blocker + 7 should-fix + 4 nit. Đã sửa hết phần có thể
sửa trong phạm vi thẻ:

- **blocker** key React trùng khi cả hai dòng LCL đều là `—` → `key={`${index}-${text}`}` + case hồi quy.
- **should-fix** comment sai của `formatVolumeCbm` (nói giữ chữ số thứ 3 trong khi
  `maximumFractionDigits` là trần, số 0 tận cùng bị bỏ) → viết lại đúng; chuyển sang
  `viVnWithDecimals(3)` cache có sẵn; thêm test trực tiếp cho formatter.
- **should-fix** tên test nói "generic package word" nhưng code không có fallback đó → đổi tên.
- **should-fix** assert export không theo vị trí cột → chuyển sang `cells[3..5]`.
- **should-fix** `data-empty` suy từ chuỗi `'—'` → thêm cờ `empty` tường minh.
- **should-fix** backend test thiếu dòng FCL → thêm và assert `pickupWarehouseSiteName === null`.
- **nit** join kho không lọc `deletedAt` — **giữ nguyên để đúng parity** với join
  `operational_sites` liền kề (cùng hành vi, cùng chủ đích); ghi nhận tại đây.
- **blocker giả** "working tree bị xoá" là do chính lệnh `git stash` đo baseline của
  reviewer trùng cửa sổ review; đã khôi phục nguyên vẹn từ stash commit
  `6faf4e93` (dangling) — xem mục "Sự cố workspace" bên dưới.