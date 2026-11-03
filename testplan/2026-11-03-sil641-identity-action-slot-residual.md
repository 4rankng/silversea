# SIL-641 (id 745) — residual round 03/11: inner typing boxes Δ42/Δ40 + '+' trôi gutter + pencil ngoài ô Hãng tàu

## Problem (QA fail staging da2e6fc2, viewport 1307px — board comment id 3541)

Round 1 (`0e5d0e4c`, slot placeholder ở cả 4 ô) đã làm FIELD boxes bằng nhau
(558.5/558.5/558.5/558.5 @1307) nhưng QA đo lại vẫn FAIL:

- **"Ô nhập trong" vẫn lệch**: Khách hàng 517 vs Hình thức XNK 559 (Δ42);
  Số Bill 557 vs Hãng tàu 517 (Δ40). Yardstick của QA (đã reproduce đúng từng px
  bằng driver local, xem `qa/scripts/2026-11-03-sil641-qa-yardstick-probe.mjs`):
  - Khách hàng / Hãng tàu = **native `<input>` của ComboBox** (516.5 @1307) —
    hẹp hơn field box đúng 42px vì hàng flex bên trong combobox dành chỗ cho
    icon tìm kiếm trang trí (16px) + gap (6px) + `pl-2.5` (10px) của wrapper
    `[data-combobox-value]`, cộng `pr-2` (8px).
  - Hình thức XNK = **trigger button của Select** (558.5).
  - Số Bill = **native `<input>` của TextField** (556.5).
- **'+' lơ lửng ở gutter** (x637): nút nằm đúng slot 803..839 nhưng là nút
  36px trong suốt với icon 15px căn giữa → mắt thấy glyph cách viền field
  ~19px, trôi giữa hai cột.
- **Pencil ngoài ô Hãng tàu** (x1249 vs mép ô 1232): cùng nguyên nhân — nút
  vô hình sau viền field box.

## Root Cause

1. Inner typing box của combobox hẹp hơn plain input đúng phần reserve nội bộ
   cho icon search (Δ42 row 1, Δ40 row 2).
2. Nút hành động 36px hoàn toàn trong suốt → glyph trôi giữa khoảng trống,
   không có "box" nàoneo lại nó.

## Fix (đúng DESIGN LAW action slot — flex sibling, slot 36, placeholder mọi ô)

1. **Bỏ icon search trang trí KHỎI DOM ở 2 combobox của section** (Khách hàng,
   Hãng tàu): `USearchableField` nhận `hideSearchIcon`, truyền
   `icon={<></>}` vào ComboBox — Fragment qua `isValidElement` → KHÔNG render
   gì, zero flex footprint (khác `display:none` CSS: DOM sạch, pin được).
   Precedent house: `combobox.css` đã display:none icon này ở container ≤192px
   ("Only the default decorative search glyph yields space").
2. **Parity inner box** (CSS scope `.csc-identity-grid`): `[data-combobox-value]`
   `padding-inline: 0; gap: 0`; input combobox `padding-inline: 10px 8px` (điểm
   bắt đầu chữ = 81 = đúng điểm chữ của Số Bill); value span
   `padding-inline-start: 10px`. → 4 ô nhập trong: 556.5 / 558.5 / 556.5 /
   556.5 → Δ≤2 (AC1).
3. **Nút hành động thành chip nhìn thấy được**: `.csc-append-button` giữ nguyên
   hình học luật (flex sibling, 36×36, margin-top 26, slot 44px) nhưng thêm
   `border: 1px solid var(--border-1); background: var(--surface)` → '+'/pencil
   là một control box thật gắn sau ô nhập (mẫu Tailkit
   `a-c-form-input-groups-06` Append Button, dựng lại bằng house token, KHÔNG
   paste class; vẫn gap 8 theo luật, không nối viền).

## Regression Case

- Case ID: SIL-641-R2
- Repro: `/shipments/new` (CUS, FCL) → đo native input của Khách hàng vs
  trigger Hình thức XNK, input Số Bill vs input Hãng tàu (Δ42/Δ40); quan sát
  '+' và pencil trôi sau viền field.
- Expected: 4 ô nhập trong chênh ≤2px; nút là chip viền nhìn thấy được nằm
  trong slot 36px của ô mình; placeholder slot 36px còn nguyên ở 2 ô không nút.

## Design-Language Source Consulted

- Tailkit `a-c-form-input-groups-06` (Append Button) — mẫu nút action sau ô
  nhập; luật SIL-641 giữ gap 8 + slot 36 riêng nên KHÔNG nối viền `-ml-px`.
- Untitled UI PRO MCP `search_components` trả rỗng (limitation đã ghi).
- House precedent: `frontend/src/components/untitled-ui/base/select/combobox.css`
  (icon search trang trí nhường chỗ ở container hẹp).

## Verification

Xem `qa/2026-11-03_sil641/` (driver before/after, DOM metrics, screenshots
1440/768/390, DB read-only proof) và pins DOM mới trong
`ShipmentCreateIdentitySection.sil641-action-slot.test.tsx`.
