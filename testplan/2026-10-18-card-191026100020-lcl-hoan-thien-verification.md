# Card 191026100020 — LCL hoàn thiện: xác minh 10 work items trên main

Nguồn spec: `lclspec1.docx` (HOÀN THIỆN LUỒNG HÀNG LẺ), `lclspec2.docx`
(Gán xe nhóm hàng lẻ + §7 form tạo lô), `chungtu-dieuvan.docx` mục D
(D.1–D.7). Chi nhánh xác minh: `fix-lcl-hoan-thien-v2` = origin/main
`20d4cb27` (0 commit lệch, đã fetch).

**Kết luận: cả 10 work items trong brief đã được hiện thực và có test pin
trên main. Không còn gap code nào cần sửa trong vé này.** Các wave đã land:
FB-090…FB-095 (15–16/10), card 181026143000 (form LCL labels + dispatch
sync, rung-3 evidence `b03af5a9`), card 181026145000 + rb1 (gán xe nhóm,
review fixes), card 181026185900 A/B/D, card 365 (D.6), card 191026100000
(CUS A.1–A.7).

## Bảng xác minh theo work item của brief

| # | Work item | Trạng thái | Code | Test pin |
|---|---|---|---|---|
| 1 | DM Loại xe/trọng tải (1.25T…15T + CONT20/40) + bảng giá Tuyến × KH/Nhà thầu (cước thu + cước trả theo tấn) | ĐÃ CÓ | `backend/src/db/schema/pricing.ts` (`vehicle_size_classes`, `carrier_route_pricing`), `backend/src/seed/seed-demo-freight-pricing.ts` (9 mã chuẩn), `pricing.service.ts` (`resolveCustomerVehicleClassPrice`, `resolveCarrierVehicleClassPrice` cascade), UI `frontend/src/pages/config/VehicleSizeClassesConfigPage.tsx` + `PricingTablesConfigPage.tsx` + `CarrierPricingConfigPage.tsx` | `container-price-classes-catalog`, `freight-pricing-config-routes`, `PricingTablesConfigPage.vehicle-class.test`, `CarrierPricingConfigPage.test`, shared `lcl-vehicle-sourcing.test` |
| 2 | Fix "Chưa có cont" (Kế hoạch Tổng quát): CẢNG NÂNG/HẠ = Kho lấy/Điểm trả hoặc "—"; TỔNG QUAN HÀNG HÓA = [SL][Bao bì] / [kg]·[CBM] | ĐÃ CÓ | `MasterPlanGrid.tsx` (`cargoCellLines` LCL branch; "Chưa có cont" chỉ còn là fallback FCL không demand), `list-summaries.ts` join `pickup_warehouse_site`, lift/drop đổi chiều theo Xuất/Nhập qua `liftDropPoints.ts` (FB-105) | `MasterPlanGrid.lcl-display(.fb090-foundation).test` (assert `queryByText('Chưa có cont')` = null trên dòng lẻ), `shipment-list-lcl-site-projection` |
| 3 | Cột CONTAINER 3 dòng (Chi tiết Xe): D1 "Lô hàng lẻ"/"Lẻ · Xe {mức}", D2 [SL][Bao bì], D3 [kg]·[CBM] | ĐÃ CÓ | `DetailedPlanGrid.tsx:460-474` (3 dòng qua `lclCargoLine`/`lclMeasureLine`) | `DetailedPlanGrid.lcl-grouping.test` |
| 4 | Tag "Lẻ · Ghép (1/N)…(N/N)" cột PHÂN LOẠI | ĐÃ CÓ | `DetailedPlanGrid.tsx:592,599` (`order`/`memberCount` từ wire) | `DetailedPlanGrid.lcl-grouping.test`, backend `lcl-grouping` (FB-093 debit-summary projection) |
| 5 | CUS Quyết toán: checkbox + [Ghép cước thu khách]; chặn khác khách; popup loại xe thu + BKS ảo; rev_group: Lô 1 = 100% AUTO, 2..N = 0đ + chú thích Bill; CHI HỘ giữ nguyên; tách = unmerge | ĐÃ CÓ | `ShipmentDebitPage.tsx:369-377` (nút + gate), `MergeRevGroupDialog.tsx` (cùng-khách client + combobox), backend `mergeLclRevGroup` (`lcl-grouping.service.ts:1082-1185` — same-customer 400 kèm Bill xung đột, 100%/0đ, `revenueOverrideReason: "Ghép cước cùng Bill X"`), `revenue-override-read.service.ts` | `ShipmentDebitPage.lcl-merge.test` (nút, chặn "cùng một khách hàng"), backend GAP 2 (`blocks merging lots of different customers…`), `lcl-single-lot-rev-class` |
| 6 | CUS Chi tiết lô hàng — PHÂN XE 2 dòng + sửa nhanh BKS ảo (combobox/gõ tay) | ĐÃ CÓ | `ShipmentContainerLedger.tsx` (`lotSpecLine`, dòng 1 `[Nhà xe] - BKS Thực:`, dòng 2 quick-edit `billingPlateEditor` qua `POST /api/shipments/lcl/truck`) | `ShipmentContainerLedger.test` AC1 ("Lô hàng lẻ \| Thu: Xe 3.5T \| Trả: Xe 10T") + AC2 (2 dòng, ẩn Ảo khi trùng), `cus-lot-flat-row` AC1–AC5 |
| 7 | Kế toán chốt debit: THÔNG SỐ CONT "Lẻ · Thu: 5T / Trả: 10T (+ Ghép cùng Bill)"; PHÂN XE D1 thực + D2 badge cam "Báo khách (Ảo)"; PHẢI THU theo rev_group, PHẢI TRẢ theo cost_group | ĐÃ CÓ | `AccountingDebitClosePage.columns.tsx:73-108`, `accounting-debit-close.service.ts` (đọc kênh override F-2) | `AccountingDebitClosePage.lcl-columns.test`, backend `lcl-grouping` FB-094 |
| 8 | Edge hủy ghép/xóa Lô 1 → thăng cấp Lô chính, 100% tiền chuyển lô kế (cả rev lẫn cost) | ĐÃ CÓ | `promotePrincipalOnRemoval` + `promoteLclGroupsOnShipmentDelete` (`shipment-lifecycle.service.ts:482`), unmerge lot/group 2 chiều, chặn khi chốt sổ; UI: Hủy ghép trong `DebitLotLclFacts.tsx` (COST + REV, confirm auto-promote) và group-badge menu Chi tiết Xe | `lcl-grouping` FB-095-01..06 + GAP 1 (bảo toàn tiền), `DispatchDetailPlanPage.lcl-unmerge.test`, `DebitLotLclFacts.test` |
| 9 | Debit Note export: BKS bắt buộc từ billing_truck_no (ảo), không in BKS thực; loại xe = loại thu; 0đ + "Ghép xe cùng Bill [Bill Lô 1]"; bảng kê nhà xe = BKS thực + loại trả | ĐÃ CÓ | `billing-document-draft.service.ts:575-579,652-656` (`REV_GROUP_MERGE_NOTE`), `billing-export-shared.service.ts:209,324` | `shipment-debit-note-export.test` (assert `cells.includes(billingPlate)` && `!cells.includes(actualPlate)` — "BKS thực tế must never reach a customer Debit Note"; cả frozen-path lẫn legacy) |
| 10 | Form LCL D.1–D.6 | ĐÃ CÓ | D.1 label "Ngày giao hàng" (`ShipmentCreateWorkspace.tsx:784`); D.2 CBM không bắt buộc (`ShipmentCreateLclCargoFields.tsx:82-97`, comment QA1-007); D.3 "+ Thêm kho" qua shared dashed utility (`ShipmentCreateLclRouteSection.tsx:231,250`, card 181026143000 §1c); D.4 bỏ "Lịch & ghi chú", còn 1 nút "Thêm ngày giao hàng" (`ShipmentCreateWorkspace.tsx:770-806`); D.5 "Quy cách đóng gói" combobox gợi ý `LCL_PACKAGE_TYPE_SUGGESTIONS` + gõ tự do; D.6 lô lẻ mất ở Chi tiết — fix card 365: `cus-shipment-workspace-reads.service.ts:1145-1150` (`rowSource = or(isNotNull(container.id), cargoMode = LCL)` thay INNER JOIN cũ làm rơi lô lẻ) | `ShipmentCreateWorkspace.asterisk-contract.test` (D.1), `ShipmentCreateWorkspace.lcl-points.test` (D.3 + label động Nhập/Xuất §7.1–7.3 spec2), `ClerkShipmentCreatePage.test`, `cus-workboard-lcl-parity-365` + `cus-lot-flat-row` (D.6) |

## Gate evidence (exit 0, artifact trong `qa/`)

| Gate | Log | Kết quả |
|---|---|---|
| BE tsc | `qa/2026-10-18_card-191026100020_be-tsc.log` | 0 error |
| FE tsc | `qa/2026-10-18_card-191026100020_fe-tsc.log` | 0 error |
| BE tests (cus workboard/flat-row/classification) | `…_be-tests-cus-workboard.log` | 13/13 pass |
| BE tests (lcl-grouping + rev-class) | `…_be-tests-lcl-grouping.log` | 62/62 pass |
| BE tests (debit-note export + pricing + projection) | `…_be-tests-pricing-debitnote.log` | 50/50 pass |
| FE tests (dispatch LCL) | `…_fe-tests-dispatch.log` | 43/43 pass |
| FE tests (CUS/debit/accounting LCL) | `…_fe-tests-cus-debit-accounting.log` | 95/95 pass |
| FE tests (form LCL + config bảng giá) | `…_fe-tests-form-config.log` | 74/74 pass |
| Shared lcl-vehicle-sourcing | `…_shared-tests.log` | pass |

Tổng: 337 scoped tests pass, 0 fail; tsc BE/FE = 0.

## Rung & phạm vi bằng chứng của phiên này

- Phiên này KHÔNG drive UI (không sửa code nên không có control thay đổi để
  click). Rung của bảng trên: CODE-READ + kết quả chạy test tự động (unit +
  integration DB thật) — không phải claim UI DRIVEN mới.
- Claim UI DRIVEN của các luồng LCL thuộc các card trước, evidence rung-3
  đã lưu: `qa/2026-10-16_lcl-loop_ui-driver.log`, driver
  `qa/drivers/2026-10-16-lcl-loop-ui-drive*.mjs`, commit `b03af5a9` (rung-3
  form LCL + dispatch), `a6e4d924` (fresh-tab E2E Gán xe nhóm).
- Không covered: sweepp UI lại toàn bộ 3 width cho các màn trên commit
  hiện tại (không có thay đổi code trong vé này nên không bắt buộc theo §9);
  staging/prod chưa deploy (owner: NEVER deploy).

## Ghi chú liên quan

- Branch `origin/fix/lcl-spec-gaps` (5 commit, chậm hơn main 270 commit) có
  3 fix trùng nghiệp vụ (same-customer, BKS ảo debit note, money
  conservation) — nội dung đã được hiện thực lại trên main phong phú hơn
  (FB-093/095). KHÔNG merge trong vé này (chưa có chỉ định owner).
- Brief nhắc branch `fix-lcl-hoan-thien` tại `/Volumes/LexarSSD/...` —
  branch này không tồn tại trên origin; worktree được giao
  `fix-lcl-hoan-thien-v2` ngang hàng main là base xác minh.
