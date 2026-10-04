# Case QA-2026-10-04-321 — Cột PHÂN BỔ NHÀ XE gọn, 1 link "Chi tiết", chip không glyph (card 20261004_321)

- Card: 20261004_321-dispatch-list-phan-bo-column (UI bug P3, QA-found staging 04/10)
- Environment: local dev (:7175) DEV evidence; staging https://vantai.tingting.vip QA rung
- Account: dungnv / Abc123 (Điều vận)
- mutates: 1 fixture lot (SHP-2610-01088) allocation saved locally for the allocated-state rung

## Repro (pre-fix)
1. Đăng nhập, vào /dispatch (Kế hoạch Tổng quát).
2. Dòng "Chưa phân bổ" cột PHÂN BỔ NHÀ XE: khoảng trống dọc giữa tóm tắt hàng hóa và link "Chi tiết" bị ghim đáy ô (dead band 20–40px).
3. Mỗi dòng có 2 link "Chi tiết" (một dưới TỔNG QUAN HÀNG HÓA, một dưới GHI CHÚ) — gây nhầm lẫn; dòng Xuất/Nhập không nhất quán.
4. Ô đã gán ("SilverSea: 1x20'"): glyph bút chì bị cột cắt (báo cáo gốc — ghi nhận nondeterministic, không tìm thấy glyph trong lịch sử mã).

## Expected (post-fix)
- Link "Chi tiết" bám sát tóm tắt hàng hóa (≤2px), KHÔNG dính đáy ô.
- Đúng MỘT link "Chi tiết" mỗi dòng có container (cấu trúc Xuất/Nhập giống hệt); dòng chưa có cont → không có link; ghi chú dài → "Xem thêm".
- Ô đã gán: chip nằm gọn trong cột (không cắt), không glyph/icon thừa.

## Rungs
- UI DRIVEN: real-tap rung + geometry đo thật (dead-band 2px, 47px khỏi đáy ô), census 20 dòng det counts, chip "SilverSea: 2x20'" 11px/42px clearance; matrix 1280/1440/1920/2560.
- TEST VERIFIED: MasterPlanGrid.dense-cell-actions.styles.test.ts (red-first 2→4), MasterPlanGrid.single-detail-affordance.test.tsx (4 pins).
- Staging rung: re-run after staging cut; record buildHash.

## Status
- [x] local visual rung executed (lead) — 04/10
- [ ] staging rung executed (lead)
