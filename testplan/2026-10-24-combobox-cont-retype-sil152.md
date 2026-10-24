# SIL-163 (board SIL) / SIL-152 family — Combobox loại cont: gõ đè lựa chọn đã chọn bị revert label cũ

Ticket lane này: **SIL-163** (id 184) — "vẫn bị revert label cũ — regression
sau SIL-152/SIL-68". Fix gốc đã land trên main qua **2e0bdaae** (SIL-152:
`inputDriven` draft/committed split trong `uui-searchable-field.tsx`).
Lane này: repro before/after trên browser thật, xác nhận fix trunk GIỮ
(trên main tip 6bc3acc3 regression KHÔNG tái hiện), và đóng pin regression
cho cả 2 surface (create workspace + CUS add row).

Theo dõi sau SIL-68 (CUS-04, commit 08c838f5). Cùng pattern ở ô Loại container
của màn Tạo lô (từ 2026-09).

## Nguyên nhân (code-read trước khi repro)

`USearchableField` nhánh non-searchable (`openOnType`/`createOption`):
`onInputChange` ghi vào state `inputValue` cục bộ (từ 08c838f5) nhưng prop
`inputValue` truyền xuống ComboBox vẫn là `selected?.label` — khi đã có pick,
input thành controlled cứng: mọi phím gõ bị useControlledState kéo lại label
cũ, filter cũng chạy theo label cũ. `searchable` mode đã có đúng law: phân
bi biệt "typing draft" (state `inputValue`) vs "committed selection" (prop
`value`/`selectedKey`).

## Case SIL-152-A — chọn 20DC → gõ '4' → chọn 40HC: giá trị MỚI thắng

1. Mở create workspace (hoặc CUS add row), trường Loại cont/container.
2. Chọn 20DC → ô hiển thị '20DC', committed id của 20DC.
3. Focus lại ô, gõ '4' (select-all + gõ đè): text đã gõ KHÔNG bị kéo về
   '20DC'; menu mở và lọc theo '4' → thấy 40HC, không thấy 20DC.
4. Chọn 40HC (click hoặc ArrowDown+Enter).
5. KỲ VỌNG: ô hiển thị '40HC' và onChange/committed id = id của 40HC.
   LỖI CŨ: text gõ bị revert về '20DC'; không thể chọn loại khác không bấm Xoá.

## Case SIL-152-B — gõ rồi bỏ đi (blur không chọn): label committed được phục hồi

1. Đang chọn 20DC, focus, gõ '4' (draft='4'), blur khỏi ô (không chọn).
2. KỲ VỌNG: ô trở về '20DC' (label của selection đã commit), value vẫn id 20DC.
   Không được giữ lại text rác '4'.

## Case SIL-152-C — chọn lại CHÍNH lựa chọn đang có: vẫn giữ nguyên

1. Đang chọn 20DC, gõ '2' → menu lọc còn 20DC → Enter/chọn 20DC.
2. KỲ VỌNG: hiển thị '20DC', id không đổi, không bị toast/lỗi.

## Tác động

- `uui-searchable-field.tsx` dùng chung: create flow (ContainerTypeCellPicker),
  CUS add row (SIL-68), và mọi caller `searchable` (không đổi law).
- `openOnType` hiện chỉ có 2 surface trên (grep 24/10).
- Fix cuối cùng trên main: `2e0bdaae` (`inputDriven` + `lastPickLabelRef` +
  chosenKey release). Pin của lane này FAIL trên base cũ (96b1a9b5) và PASS
  trên main tip (6bc3acc3) — chứng minh regression net bám đúng defect.

## Kết quả (24/10)

- BEFORE (base 96b1a9b5): gõ '4' bị revert '20DC' cả 2 surface; keyboard
  re-pick commit từ list KHÔNG lọc. AFTER (main tip): 12/12 PASS, DB row
  container_type_id=40HC. Xem `qa/2026-10-24_sil152-cont-retype/`.

## Chạy

- Unit: `cd frontend && pnpm vitest run src/features/shipments/create/ContainerTypeCellPicker.test.tsx src/features/shipments/cus/CusContainerAddRow.tab-suggest.test.tsx src/features/shipments/create/uui-searchable-field.typing-session.test.tsx`
- UI driver: `qa/scripts/2026-10-24_sil152_repro.mjs` (chụp trước/sau).
