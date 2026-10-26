# SIL-507 (retry) — Kế hoạch Tổng quát mobile: card data-dense 3 dòng, wrap-full

- Ticket: SIL-507 (board SIL, id 569, cột QA 26) — owner 26/10 P0, ảnh `kh-tongquat-mobile.jpg`.
- Surface: `/dispatch` card list (<640px), role Điều vận (ĐV) — desktop bảng ≥640 giữ nguyên.

## Yêu cầu owner

1. Card "khổng lồ" (~40% màn hình/lô, chữ to, nút "Phân bổ nhà xe" full-width)
   phải thành data-dense: 3 dòng/lô, cao ~72-88px.
2. Nút "Phân bổ nhà xe" compact 32px, KHÔNG full-width, ẨN khi lô đã phân
   (dòng roster "Xe: …" đọc thay).
3. Typography 13/11px; list-divider thay card-box.
4. Lần 1 (26/10 sáng) dùng ellipsis cho dòng meta — trái luật SIL-515 (cấm
   truncate) vừa đổ main cùng ngày → retry: mọi value line wrap full.

## Case pin (expected sau thay đổi)

1. Cấu trúc 3 dòng: D1 head = [tick gộp khi mode bật] + KH · mã (Bill/Booking)
   + badge loại (Nhập/Xuất · Cont/Lẻ, Chạy ngoài) + GIỜ (schedule heads) + ⋯;
   D2 route = "Nâng … → Trả … · nhà máy ngày đó · tuyến · hãng tàu" WRAP FULL;
   D3 meta = hàng hóa (13px identity) · đo lường · Xe + nút "Phân bổ nhà xe"
   32px (không full-width, ẩn khi đã phân).
2. Mọi mpcard value line computed `white-space: normal` + `overflow-wrap:
   anywhere` — không nowrap, không ellipsis, không clip; `nowrap` duy nhất còn
   trong scope là label của chính nút allocate.
3. Nút allocate: height 32px, bề rộng ≤60% card (không full-width), chỉ render
   khi chưa phân + chưa khóa; bấm mở popover phân bổ trong viewport 390.
4. Row budget: base ≈71px đã phân / ≈88px có nút; card có dòng điều kiện
   (status/note) hoặc route wrap thêm dòng thì cao hơn — wrap thắng budget
   (SIL-515).
5. Typography 13px primary / 11px meta (re-map token tại scope `.mpcard-list`).
6. Desktop ≥640: bảng `master-plan-grid` nguyên vẹn (không card list).

## Regression lock

- Styles pin: `MasterPlanGrid.test.tsx` (case "SIL-507 3-dòng divider list
  (wrap-full, SIL-515)": divider, padding 3px, no text-overflow/clip trong
  scope card, duy nhất 1 nowrap = nút allocate, 32px button),
  `MasterPlanGrid.rowheights.styles.test.ts`,
  `src/styles/table-no-truncation.styles.test.ts` — case doctrine
  "master-plan phone card wraps full (SIL-507 retry under SIL-515)".
- Component pin: `MasterPlanCardList.test.tsx` (giờ D1, route D2 kèm nhà máy
  appointment, facts D3, ẩn-nút-khi-đã-phân, popover wiring).
- UI drive: `qa/scripts/2026-10-26-sil507-dense-retry-ui-drive.mjs`
  (@390 audit computed-style + hình học + popover click; @768 bảng nguyên
  vẹn) → `qa/2026-10-26-sil507-dense-retry/` +
  `qa/2026-10-26_sil507-dense-retry_ui-drive.log`.

## Provenance thiết kế

- House primitive tiếp diễn: mpcard divider-list (lần 1 26/10) + rail sizes
  30px của dpcard (8a28c094) + 32px compact primary action theo spec owner
  trong ticket. Không consult catalog ngoài (Untitled UI/Tailkit) — không có
  layout mới, chỉ siết primitive nhà đang có.
