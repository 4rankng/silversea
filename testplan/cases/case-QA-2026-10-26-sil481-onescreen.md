# Case: SIL-499 — view /shipments/:id nén 1 viewport không scroll @1280×800

- **Ticket:** SIL-499 (board id 561, In Progress) — tách từ SIL-481; lane
  fix-481-onescreen (worktree paseo, branch off main 7b7180fe).
- **Date:** 2026-10-26
- **SPEC:** board comment 1840 — nén vertical @1280×800 KHÔNG scrollbar dọc:
  card padding 12-16, table row 48, section band 36, gap 12, font giữ nguyên,
  KHÔNG bỏ thông tin; 768: scroll chấp nhận.
- **Provenance mockup:** ảnh mockup đính theo ticket KHÔNG tới được agent —
  poll 3 lần (list_attachments + view_issue_images rỗng lúc 02:05, 02:20,
  02:24), chat không có ảnh; orchestrator xác nhận board rỗng 10:41. Cấu
  trúc 2 cột chọn bằng số đo (proof bên dưới); owner đối chiếu mockup ở QA,
  lệch thì chỉnh `ClerkShipmentCreatePage.onescreen.css`, không đụng DOM.

## Bug / yêu cầu

Sau SIL-481 postview, `/shipments/:id` xếp dọc 1 cột — tổng cao vượt viewport:
**.app-body scrollHeight 1199px vs clientHeight 744px @1280×800** (admin, lot
270 FCL 1 cont, đo trước khi sửa — `qa/2026-10-26-sil481-onescreen/before-*`).

Phân tích: đúng SPEC density trên layout 1 cột chỉ xuống được ~868px (vẫn
trượt 124px) → cấu trúc duy nhất đạt là form ngang màn hình rộng (§5 law:
"a form must never force vertical scrolling on a wide screen"). 1 cột bị loại
bằng số đo; orchestrator authorize 2 cột 10:41.

## Implement (wide band ≥1280px — `ClerkShipmentCreatePage.onescreen.css`)

- `.csc-workspace` = grid 2 cột 4fr/8fr, gap 12; `.csc-form` display:contents
  (giữ nguyên DOM + tab order — placement thuần CSS).
  r1: mode | identity(spans r1-r3) · r2: freight preview (rail) ·
  r3: schedule (FCL) / route (LCL) full · r4: cargo full · r5: actions.
  Không freight → `:has()` kéo schedule/route lên, không để track rỗng.
- Identity nội tâm: choices chips 1 hàng full-width (label "Tuỳ chọn" sr-only,
  giữ a11y) · contact r3 + refs r4 cột rộng (fields ~210px, giá trị không clip)
  · tờ khai strip cột hẹp span 2 hàng (field tự scroll, cap 120px).
- Section band 36 (padding 7px), card padding 12/14, gap nội bộ 8,
  worksheet gap 12 · legend Loại hàng float ngang hàng segmented (Chrome
  fieldset-flex stack) · table row padding 7px (row 48 SPEC), thead 5px.
- 2 hàng affordance của cargo (Thêm nhà máy; count + Thêm container) overlay
  lên heading band thành section toolbar — tiết kiệm ~80px.
- Textarea notes height 48 (read-only xem ~2 dòng, tự scroll nội bộ).
- Bỏ 2 helper text §8 (lecturing copy): hint hãng tàu (2 câu — pin test cập
  thành assert-vắng-mặt), hint tờ khai (không test pin).
- DOM order/tab order/focus/action KHÔNG đổi; create/edit/view cùng hưởng.

## Expected / measured (sau)

| Lot | Nội dung | scrollH | clientH | Overflow |
|---|---|---|---|---|
| 270 | FCL 1 cont (GATE) | 744 | 744 | **0** |
| 273 | FCL 3 cont | 744 | 744 | **0** |
| 5 | FCL 2 cont + 1 tờ khai | 744 | 744 | **0** |
| 5 | freight variant (mock pricing qua interception, card 104px) | 744 | 744 | **0** |
| 272 | LCL | 744 | 744 | **0** |
| tất cả | @1440×900 | — | — | **0** |
| 270 | @768×1024 (SPEC: scroll chấp nhận) | 1272 | 968 | layout dọc giữ nguyên |

Evidence: `qa/2026-10-26-sil481-onescreen/` (before/after fullpage + viewport
screenshots từng lot, ui-driver.log, driver scripts).

## Không đổi

- Read-only: mọi control disabled, không nút mutation mới, Enter không submit
  (tests SIL-481 view-mode pass nguyên trạng).
- ≤1279px: bands cũ nguyên vẹn (chỉ ≥1280 có wide band).
- Font size: không thay đổi (SPEC "font giữ"); chỉ bỏ 2 helper text.

## Gates

- Scoped vitest: `src/features/shipments/create/`, `src/pages/clerk/`,
  `src/features/shipments/cus/` — **50 files / 460 tests pass**.
- `tsgo --noEmit`: 0 lỗi. eslint (5 file đụng): 0. design:drift: no growth.
- UI DRIVEN: driver click-không-cần (read-only); screenshot + geometry DOM
  đo .app-body scrollHeight trực tiếp; evidence đầy đủ trong qa/ path trên.

## Known limits (không cover)

- Freight variant dùng mocked pricing payload (DB local 0 hàng pricing) —
  card thật từ engine sẽ cùng khối 104-130px, đã trừ quỹ rail.
- Screenshot vai trò admin; role khác chỉ khác nút Sửa (đã pin test).
- 4+ container chưa đo (mỗi cont +48px; 3 cont vẫn 0 overflow, budget còn
  68px slack ở gate lot → 4 cont dự kiến vẫn ≤744 nhưng chưa chạy evidence).
