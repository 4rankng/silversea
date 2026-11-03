# SIL-660 (id 767) — Form tạo lô hàng lẻ: bổ sung ô nhập Số tờ khai

- **Lane:** `feat/sil660-lcl-declaration-input` (worktree, base `main` = `da2e6fc2`)
- **Ngày:** 03/11/2026 · **Ruling:** owner 02/11 (verbatim trong ticket) — CẬP NHẬT luật
  SIL-600 cho RIÊNG hàng lẻ, cơ sở SIL-601 (lẻ = 1 lô 1 cont)
- **Phạm vi:** FE-only. Backend KHÔNG đổi (entity API `shipment_declarations` dùng nguyên trạng).

## 1. Diff — file đã sửa

| File | Thay đổi |
|---|---|
| `frontend/src/features/shipments/create/shipment-create-model.ts` | + `declarationNumber` vào `ShipmentCreateFormState`/EMPTY; + `buildShipmentDeclarationPayload()` (LCL-only; FCL → `null`; blank → `{declarationNumber: null}` = clear có chủ ý) |
| `frontend/src/features/shipments/create/shipment-edit-prefill.ts` | + prefill tờ khai từ `detail.declarations` (row id nhỏ nhất = row đại diện); `ShipmentEditSeed.declaration {rowId, declarationNumber}` (FCL không mang key) |
| `frontend/src/features/shipments/create/use-shipment-create-workflow.ts` | + máy reconcile HẸP: LCL → POST `/shipments/:id/declarations` khi chưa có row, PUT theo rowId khi đã có; signature-skip khi không đổi; state đặt trên **ref cấp session** (sống sót qua attempt reset — POST entity là INSERT thuần, attempt-scoped sẽ sinh row trùng); re-seed theo edit-seed identity |
| `frontend/src/features/shipments/create/ShipmentCreateLclCargoFields.tsx` | + ô "Số tờ khai" (`data-field-id="shipment-lcl-declaration-number"`) trong grid Thông tin hàng, cùng primitive `UTextField` với các ô siblings |
| `frontend/src/features/shipments/create/ShipmentCreateWorkspace.tsx` | mode-scoped: LCL→FCL xoá `declarationNumber`; `hasModeData` (LCL) tính thêm tờ khai → confirm "Chuyển loại hàng?" |
| `ShipmentCreateWorkspace.sil502-declaration-draft.test.tsx` | **Pin cập nhật luật (có lý do ghi rõ):** ruling 02/11 thay luật SIL-600 cho LCL — máy chip-strip SIL-502 (`shipment-declarations` field, `.csc-declaration-strip`, Sửa hàng loạt/Xóa tất cả) VẪN CHẾT (giữ nguyên pin); ô cấp lô tồn tại CHỈ trên tab LCL; FCL giữ absence pin |
| `ShipmentCreateWorkspace.sil600-declaration-column.test.tsx` | Header comment cập nhật lịch sử luật (SIL-660 tách pin LCL sang file sil660) |
| `shipment-create-model.test.ts` / `shipment-edit-prefill.test.ts` / `use-shipment-create-workflow.test.tsx` | + pin đơn vị (payload LCL/FCL/blank; prefill + seed; POST/PUT/skip/clear/FCL-never/re-save-no-duplicate) |
| **Test mới:** `ShipmentCreateWorkspace.sil660-lcl-declaration.test.tsx` | 3 pin DOM (ô LCL tồn tại + nhập được; Lưu nháp → POST declarations + root payload sạch; FCL không có ô cấp lô) |
| **QA:** `qa/scripts/2026-11-03-sil660-lcl-declaration-ui-drive.mjs`, `qa/scripts/2026-11-03-sil660-390-sweep.mjs` | rung-3 driver (PHASE=before tái hiện defect; PHASE=after full chain) + 390px sweep |

KHÔNG sửa (đúng ràng buộc): `trip-container-link.service.ts`, `forwarder-container.service.ts`,
`trip-create.service.ts`, `pages/ShipmentsPage.tsx`, `features/dispatch/**`, toàn bộ `backend/src`.

## 2. Gates — lệnh + output verbatim

### FE vitest (toàn bộ create dir + 2 page clerk)
```
$ cd frontend && pnpm exec vitest run src/features/shipments/create \
    src/pages/clerk/ClerkShipmentCreatePage.test.tsx src/pages/clerk/ClerkShipmentEditPage.test.tsx

 Test Files  52 passed (52)
      Tests  414 passed (414)
```
(create dir standalone: `50 passed (50) / 354 passed (354)`; clerk pages: `2 passed / 60 passed`.)

### FE typecheck
```
$ cd frontend && pnpm exec tsc -b ; echo "tsc-exit=$?"
tsc-exit=0
```

### Full FE suite — xem §6 (chạy lại sạch sau khi variant stash can thiệp 1 lần chạy giữa chừng).

### BE — không đụng, không chạy gate BE (FE-only lane).

## 3. UI verification (§9) — coverage table

| Claim / bug | Rung | Evidence | Not covered |
|---|---|---|---|
| Tab LCL trước fix KHÔNG có ô tờ khai (defect khách báo, tái hiện tại base `da2e6fc2`) | UI DRIVEN (before) | `qa/2026-11-03_sil660/sil660-before-lcl-tab-no-declaration-field.png` + `ui-driver-before.log` (`PASS BEFORE … hasField=false`) | staging (chỉ local), role khác CUS |
| Tab LCL sau fix CÓ ô "Số tờ khai" nhập được | UI DRIVEN | `sil660-after-create-lcl-field.png`; driver PASS "tab HÀNG LẺ có ô Số tờ khai" | — |
| Nhập số + Lưu nháp ⇒ persist entity `shipment_declarations` | UI DRIVEN | driver log: `API POST /api/shipments/quick → 201` + `API POST /api/shipments/999/declarations → 201`; DB proof `116\|TK660-42097064` (`db-side-effect-proof.txt`); `sil660-after-create-filled.png` | — |
| Root payload không mang key cấp lô (SIL-521 giữ nguyên) | UI DRIVEN + unit | sil660 DOM test assert `body.not.toHaveProperty('declarationNumber')`; workflow test cùng pin | — |
| Edit round: prefill đúng + sửa + Lưu ⇒ PUT **cùng row** (không trùng) | UI DRIVEN | driver log: `API PUT /api/shipments/999 → 200` + `API PUT /api/shipments/999/declarations/116 → 200`; DB proof sau edit: vẫn 1 row `116\|…-B`; `sil660-after-edit-prefill.png` | — |
| View mode: hiện giá trị + disabled | UI DRIVEN | driver PASS view pre/post-edit (`{"value":"…-B","disabled":true}`); `sil660-after-view-mode-disabled.png` | — |
| Ledger Chứng từ (Tổng quan /shipments) hiện số (read-side SIL-657 merge) | UI DRIVEN | driver PASS: cell text `["BL660-097064TK660-42097064-B", …]`; `sil660-after-ledger-chungtu.png` | — |
| Dispatch handoffs / data-status merge 2 store | NOT VERIFIED end-to-end trên lô mới — lô DRAFT ngoài window kế hoạch chi tiết xe (`dispatch-detail-plan-rows?q=` → 0 row, NOTE trong driver log). Merge logic do pin BE `sil657-declaration-number-sync.test.ts` bảo lãnh + aggregate FE `docs.declarationNumbers` đọc cùng service | NOTE line trong `ui-driver-after.log` | cần lô có trip/window kế hoạch để assert end-to-end (ngoài scope SIL-660) |
| 390px: ô hiển thị full-width, không tràn ngang | UI DRIVEN | `qa/scripts/2026-11-03-sil660-390-sweep.mjs` output: `{"viewport":390,"fieldX":16,"fieldW":358,…docNoHScroll:true}` + `sil660-390-create.png`, `sil660-390-view.png` | 768px (grid auto-fit không có breakpoint riêng — 390/1440 chốt 2 biên) |
| FCL không đổi (per-cont column + absence ô cấp lô) | Unit (DOM) | sil660 test 3 + sil502 pin đầu (FCL tab) | — |

### Bằng chứng phụ phát hiện trên đường drive (app hoạt động đúng luật)
- `POST /quick → 409` khi Số Bill trùng lô khác (driver dùng Bill tĩnh) — guard trùng Bill/Booking/
  tờ khai hoạt động; workflow surface đúng `duplicateConflict` (không rơi vào submitError).
- Driver iteration đầu để lại vài lô QA trên DB dev local: **994–998** (994–996 partial draft do
  driver chưa set được Hình thức XNK; 997 mang số bị nối chuỗi do lỗi select-all của DRIVER —
  không phải bug app; PUT vẫn update-in-place đúng). Lô sạch dùng làm bằng chứng: **999**.
  Đề xuất QA dọn theo `make qapurge` nếu cần.

## 4. UI/UX — skill + provenance

- Skill `shipmate-uiux` chế độ **POLISH** (thêm 1 ô theo pattern nhà sẵn có — mockup-first BỎ,
  lý do: field dùng lại nguyên si house primitive + grid của section, không có quyết định
  layout/màu mới; bù bằng ảnh trước/sau).
- Provenance: Untitled UI MCP `get_component('input')` (base, public) — khớp primitive nhà
  `UTextField` (`frontend/src/features/shipments/create/uui-fields.tsx`) đang dùng cho cả nhóm
  Số lượng/Trọng lượng/Thể tích; Tailkit KHÔNG consult (không cần layout mới — ghi rõ theo luật).
- Verdict (accessibility → layout → writing → typography → colors → polish): **Approve** —
  0 findings. Ô có `<label>` gắn đúng (UTextField), disabled theo `saving` (validate-on-submit
  không gate nút), lỗi render qua `issueByField` như siblings, không color-only, không CSS mới
  (design-drift không đụng), label "Số tờ khai" trùng vocabulary cột FCL + ledger.
- Đã drive thật 1440 + 390 (bằng chứng ở §3).

## 5. TDD loop

- Vòng 1 (đơn vị): pin đỏ 12 fail đúng seam (model import/prefill seed/workflow calls) →
  implement → 73/73 xanh. Sửa giữa vòng: state declaration chuyển từ attempt-scope sang
  session-ref sau khi test "re-save không đổi" bắt được nguy cơ POST trùng row.
- Vòng 2 (DOM): pin sil660 đỏ đúng seam (field vắng) → implement field + mode-scope → xanh;
  cập nhật pin sil502/sil600 kèm lý do ruling 02/11.

## 6. Full FE suite

Lần chạy đầu (`pnpm test`) bị lane stash trước/sau can thiệp giữa chừng → 3 fail ở prefill là
artifact cửa sổ stash (test mới chạy đúng lúc implementation đang stash). Đã chạy LẠI sạch:
kết quả được ghi ở comment board (kèm lệnh + số test). Kết quả: 785 files / 6137+ tests —
kết quả cuối đính kèm comment ticket.

## 7. Điểm còn sót

1. **Dispatch/data-status end-to-end trên lô mới**: NOT VERIFIED (lô DRAFT ngoài window kế hoạch;
   NOTE trong driver log). Merge đọc được pin BE sil657 + cùng read service; cần lô trong window
   để assert trọn vẹn — đề xuất QA chạy lại driver sau khi lô vào kế hoạch.
2. **768px** không drive riêng (grid auto-fit không breakpoint; đã chốt 2 biên 390/1440).
3. **Lô QA rác** 994–998 trên DB dev local (liệt kê §3) — chưa xoá (không SQL tay theo ràng buộc).
4. **Staging** chưa drive (constraint: chỉ staging/local; local đã đủ rung-3). `make deploy` KHÔNG
   chạy đúng ràng buộc.
