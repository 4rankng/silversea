# SIL-658 (id 765) — Gộp hàng CUS mất tích chọn khi tìm kiếm (Chi tiết lô hàng)

- **Ngày báo cáo:** 02/11/2026 (staging 3ba1d3b9, CUS tiepvv) · **Ngày fix:** 03/11/2026
- **Mức:** Bug chức năng (mất trạng thái người dùng nhập)

## Repro (nguyên trạng)
1. `/shipments-detail` → [Gộp hàng] → tick 1 lô (VD bill `K5K5347857345`) — bar "Đang chọn 1 lô".
2. Gõ số bill lô khác vào ô tìm kiếm + Enter — danh sách lọc còn 1 dòng.
3. **Bug:** bar về "0" — ô chọn của lô cũ mất.
4. Xoá tìm kiếm → lô cũ hiện lại nhưng **không còn tích**.

Bên Điều vận (Kế hoạch Tổng/Chi tiết) không bị — boss Phạm Trung Kiên xác nhận.

## Expected
Tích chọn phải giữ nguyên qua tìm kiếm/lọc/phân trang/sắp xếp — tìm lô khác rồi quay lại, lô đã chọn vẫn còn tích để gộp tiếp; bar đếm đúng số lô đã tick (kể cả lot đang bị ẩn bởi filter).

## Root cause
`ShipmentContainersPage.tsx`: mọi filter/page/sort write gọi `dropPicks()` + bar derive selection từ danh sách đang hiển thị (`items.filter`). Pattern đúng = bên Điều vận: selection là mảng row đầy đủ sống ngoài danh sách lọc.

## Regression case (đã pin)
- Vitest: `frontend/src/pages/ShipmentContainersPage.gop-hang.test.tsx` — describe `SIL-658`, 3 tests (AC1 tick sống qua search; AC2 đếm đủ + popup gộp với Lô 1 đúng thứ tự tick; AC3 bỏ tick 1 lô khi filter).
- UI drive (rung 3): `qa/scripts/2026-11-03-sil658-659-ui.mjs` — PASS, artifacts `qa/2026-11-03-sil658-659/`.

## Expected behavior sau fix
- Tick → tìm → quay lại: tick còn, bar không đổi.
- Tick nhiều rồi filter: mọi tick giữ nguyên, bar đếm đúng.
- Bỏ tick khi đang filter: chỉ lô đó drop.
- Selection chỉ mất khi: thoát gộp hàng / hoàn tất gộp / [Bỏ chọn] / bật lại toggle.
