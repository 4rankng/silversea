# Case QA-2026-10-04-322 — Dialog "Phân bổ nhà xe" footer không còn khoảng trống (card 20261004_322)

- Card: 20261004_322-dispatch-dialog-footer-gap (UI bug P4, QA-found on staging 04/10)
- Environment: local dev (:7175) for DEV evidence; staging https://vantai.tingting.vip for QA rung
- Account: dungnv / Abc123 (Điều vận)
- mutates: none (dialog open + close via Huỷ)

## Repro (pre-fix)
1. Đăng nhập, vào /dispatch (Kế hoạch Tổng quát).
2. Bấm cột "Phân bổ nhà xe" của một dòng lô để mở dialog "Phân bổ nhà xe".
3. Phân bổ đủ số container → hộp xanh "Đã phân bổ đủ số container của lô hàng." xuất hiện.
4. Quan sát khoảng cách giữa hộp xanh và footer (Huỷ / Lưu phân bổ): seam ~33px — khoảng trống thừa.

## Expected (post-fix)
- Seam giữa hộp trạng thái và footer ~13px (margin-top ≤4px + padding-top ≤8px, hairline border-top phân cách) — footer bám sát nội dung theo luật "Popover footers hug their content" (docs/design-guidelines.md 2026-10-04).
- Ở 390px panel chuyển thành bottom sheet, 2 nút Huỷ / Lưu phân bố cục 2 cột, cao ≥44px, không bị cắt.

## Rungs
- UI DRIVEN (visual rung): full-page matrix /dispatch + dialog mở @ 1280/1440/1920/2560; criterion crop vùng seam hộp xanh → footer.
- TEST VERIFIED: `DispatchAllocationPopover.footer-gap.styles.test.ts` (red-first 1 failed → 6 passed).
- Staging rung: re-run after staging cut; record buildHash.

## Status
- [x] local visual rung executed (lead) — 04/10: real-tap dialog rung, seam 33px→10px measured on a Nhu cầu 2×20' lot, matrix 1280/1440/1920/2560 + 390 bottom sheet
- [ ] staging rung executed (lead)
