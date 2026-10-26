# SIL-505 — Kho lấy hàng (CFS/Cảng): gõ đủ 'GLC' không thấy, gõ 'LC' thấy

- Ticket: SIL-505 (board SIL, id 567) — QA Glint 26/10, build staging 6d53c4c0.
- Role/flow: CUS, Tạo lô hàng, hàng lẻ Nhập khẩu, field "Kho lấy hàng (CFS/Cảng)".

## Triệu chứng

1. Mở /shipments/new, chọn hàng lẻ + Nhập khẩu (kho GLC đã có trong danh mục chung).
2. Gõ đầy đủ "GLC" vào combobox kho → không hiện kết quả.
3. Xóa, gõ "LC" → option "GLC" hiện (screenshot ticket: dropdown hiện GLC khi gõ LC).

## Phân tích (evidence-first)

- Filter `matchesComboboxSearch` là contains + monotonic: mọi option match 'LC' đều
  match 'GLC' (cùng textValue). "GLC mất / LC còn" KHÔNG thể sinh ra từ filter
  trên code hiện tại → thủ phạm nằm ở nhánh CHỈ 'GLC' kích hoạt: exact-label
  resolution (`createAdhocFieldLogic.warehouseCustomText`) flip form id giữa chừng.
- Family lịch sử: card 261022213755b + TiepVu22Oct-3 (3638e0b3) — menu đóng ngầm
  khi gõ đủ label; fix pin bằng typing-session (`typedCustomTextRef`) với luật
  `fromLiveTyping = selectedLabel === typedText` — so khớp CASE-SENSITIVE.
- Lỗ hổng còn lại: khi label catalog lệch case/dấu với text gõ (vd gõ 'glc',
  label 'GLC'), một resolution fire kèm `selectedLabel !== typedText` sẽ bị đọc
  là REAL PICK → chosenKey nhận id → react-aria đóng menu đúng keystroke cuối
  ("gõ đủ không thấy, gõ lệch vẫn thấy"). Đồng thời passthrough `===` strict
  khiến gõ 'glc' (filter vẫn hiện GLC) KHÔNG resolve id → rơi vào free-text name.

## Expected behavior (case pin)

1. Gõ 'GLC' → option GLC hiển thị, menu mở (giữ nguyên, đã pin 261022213755b).
2. Gõ 'glc' / 'Glc' → resolution về id danh mục (cùng luật normalize với filter)
   VÀ menu vẫn mở, option GLC hiển thị đến khi user thật sự pick/Enter.
3. Gõ 'LC' → KHÔNG resolve (khớp substring filter thôi), menu mở, GLC hiển thị.
4. Pick thật/Enter-commit vẫn commit id như cũ.

## Gates

- Scoped vitest: `uui-searchable-field.exact-label.test.tsx` +
  `create-adhoc-field-logic` unit + typing-session sibling.
- `cd frontend && npx tsgo --noEmit` (0 error).
- UI drive thật (CUS /shipments/new): pre/post driver + screenshots.

## Không thuộc phạm vi

- Staging/prod verification (§2 cấm đụng) — owner đối chiếu build hash nếu
  symptom vẫn còn trên staging sau fix này.
- Backend search API (không tồn tại keystroke search — filter 100% client-side,
  qa/2026-10-23-search-glc-race network log).

## Ruling đã ghi (review 26/10)

- Hai label KHÁC nhau nhưng normalize giống nhau (vd 'GLC' vs 'glc') giờ resolve
  theo `find()`-first — nhất quán với dropdown filter (cả hai cùng hiện dưới một
  query). Report "resolve nhầm kho" sau này: trace về luật normalization dùng
  chung, không phải bug mới.
- onClear/blur session-end paths chưa có pin trực tiếp (gap cũ, diff này không
  đụng) — follow-up pin nếu chạm lại uui-searchable-field.
