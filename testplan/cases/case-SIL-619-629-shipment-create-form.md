# case-SIL-619-629 — family Form tạo lô /shipments/new (6 ticket, id 723/728/730/731/732/733)

- **Board:** SIL-619 (723) · SIL-624 (728) · SIL-626 (730) · SIL-627 (731) · SIL-628 (732) · SIL-629 (733) — cùng family ShipmentCreate*.
- **Reported:** 31/10/2026, vai CUS, `/shipments/new`, sweep widths 1307px + 390px.
- **Branch:** fix-sil-619-629 (worktree-isolated lane).

## SIL-619 (723) — Ghi chú cuối form bị action bar cố định che

**Repro:** mở /shipments/new (CUS, FCL), cuộn xuống cuối form ở 1307px — 2 ô Ghi chú bị cắt, thanh Huỷ/Lưu nháp/Tạo lô hàng (viewport-fixed footer) đè lên; cuộn hết cỡ vẫn không thấy đủ.

**Root:** clearance đáy trang chỉ áp dụng ≤1279px (`@media (max-width: 1279px) .csc-page { padding-bottom: calc(var(--csc-action-bar-height) + 12px) }`); band onescreen ≥1280 đặt `.csc-page { padding: 4px 0 }` KHÔNG có clearance — giả định "1 viewport không scroll" của SIL-499 sai ở 1307×(chiều cao thực) khi nội dung tràn, nên phần cuối không bao giờ cuộn lên trên bar.

**Expected:** trang đủ khoảng trống đáy = chiều cao bar đo thực + gap; cuộn hết cỡ thấy trọn 2 ô Ghi chú phía trên bar (1307 và 390).

## SIL-624 (728) — ô "Chọn ngày giờ" trong bảng container cao gấp đôi control chuẩn

**Repro:** cột NGÀY GIỜ ĐÓNG TRả trong bảng container (FCL) — cụm segmented datetime đo ~48px (band `--uui-control-h: var(--control-max-h)` 40px + wrapper/segment `py-1` 4px×2), trong khi control chuẩn trong sheet đo 30px compact (`--control-compact-h`).

**Root:** card 051026230627 cố tình nâng cụm ngày giờ thành tap-surface 40px; ticket owner 31/10 đòi về chiều cao control chuẩn (khác SIL-616 = band đầu đã fix riêng).

**Expected:** ≥769px fine pointer: cụm seg đóng đúng 30px như mọi control khác trong sheet. Touch form factor (≤768/coarse) giữ token touch 44px (SIL-583 r2 giữ nguyên).

## SIL-626 (730) — "+ Thêm nhà máy" phải nằm TRONG dropdown NHÀ MÁY

**Repro:** header section Thông tin hàng có nút riêng "+ Thêm nhà máy"; dropdown NHÀ MÁY không có mục thêm.

**Expected:** bỏ nút riêng (`csc-fcl-factory-action`); dropdown nhà máy (mỗi dòng container) có mục "+ Thêm nhà máy..." cuối danh sách (createOption house pattern 20260920_26, như "+ Thêm" của Tuyến/Cảng) mở dialog tạo nhà máy. "+ Thêm container" GIỮ NGUYÊN (out of scope).

## SIL-627 (731) — bỏ banner "Cần bổ sung N thông tin"

**Repro:** để trống trường bắt buộc, bấm Tạo lô hàng — banner `csc-validation-summary` ("Cần bổ sung N thông tin / Chọn từng mục để chuyển đến trường cần sửa…") hiện trên form.

**Expected:** bỏ hẳn banner tóm tắt khỏi form tạo lô. Validation per-field (viền đỏ + lỗi dưới từng trường + focus lỗi đầu) GIỮ NGUYÊN. Lỗi server (`csc-submit-error`) không thuộc banner này.

## SIL-628 (732) — bỏ icon ⓘ khỏi cột thao tác cuối bảng container; nút icon không chồng nhau

**Repro:** cột thao tác cuối bảng container — icon ⓘ (chi tiết nhà máy) đè lên nút xoá, rõ nhất ở dòng 2.

**Root (chứng minh bằng source + browser measure):** `ShipmentContainerCell` render `actions` vào `.csc-container-cell__actions { position: absolute; top:0; right:0; bottom:0 }` nhưng trên desktop KHÔNG có ancestor định vị đúng (`.csc-container-cell` không `position: relative` ngoài ≤620px) → span ⓘ trôi sang phải-của-card cargo (`#shipment-section-cargo` là positioned ancestor duy nhất ≥1280), đè đúng cột xoá 44px; nút 24px nằm giữa theo chiều cao card → trùng nút xoá dòng giữa.

**Expected:** (1) icon ⓘ biến mất khỏi bảng container create form (kèm popover chi tiết nhà máy — affordance duy nhất của nó); (2) luật chống chồng: mọi overlay `csc-container-cell__actions` từ nay bị neo trong cell của nó (`position: relative` trên `.csc-container-cell`), không bao giờ trôi ra ô khác.

## SIL-629 (733) — xoá dòng container không được trên form ĐÃ ĐIỀN

**Repro (đúng trạng thái đã điền — KHÔNG kết luận từ form trống):** dòng 1 đầy đủ (cont EGHU3768799 + loại + nhà máy + tuyến + cảng + ngày giờ), thêm dòng 2; bấm nút xoá dòng có nhà máy đã chọn → dòng KHÔNG bị xoá. Cú bấm rơi vào ⓘ misplaced (đè nút xoá) → mở popover chi tiết nhà máy thay vì xoá.

**QA probe 31/10 (staging):** form TRỐNG xoá được (2→1) — nút xoá hoạt động ở trạng thái trống ⇒ lỗi chỉ ở trạng thái có nhà máy đã chọn (ⓘ render). Cùng root 628.

**Expected:** form đã điền (dòng 1 đầy đủ + dòng sau thiếu): bấm xoá mở confirm "Xóa container?" (dòng có dữ liệu) → xác nhận → dòng mất; đếm dòng giảm. Form trống giữ hành vi xoá ngay không confirm.

## Regression guards

- `ShipmentCreateWorkspace.sil619-notes-clearance.styles.test.ts` — clearance đáy ≥1280 pin.
- `ShipmentCreateContainerRow.sil624-appointment-height.styles.test.ts` — appointment seg = compact token + zero py (fine pointer), touch giữ token touch.
- `ShipmentCreateContainerRow.create-option.test.tsx` — mở rộng: "+ Thêm nhà máy..." trong dropdown nhà máy; header button retired.
- `ShipmentCreateSummary.test.tsx` — banner retired, submit-error giữ.
- `ShipmentCreateContainerRow.sil628-actions.test.tsx` + `ShipmentContainerCell.styles` — ⓘ absent; `.csc-container-cell` position:relative pin (anti-overlap law).
- `ShipmentCreateWorkspace.sil629-filled-delete.test.tsx` — xoá trên form đã điền (dòng 1 đủ + dòng 2 thiếu) qua confirm.
- Rung evidence: `qa/2026-10-31_sil619-*`, `qa/2026-10-31_sil624-*` (1307 + 390), driver logs.
