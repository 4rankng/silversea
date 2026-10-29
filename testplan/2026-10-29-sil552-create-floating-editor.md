# SIL-552 (id 626) — Tạo lô: dòng LOẠI/TRỌNG LƯỢNG mở editor nổi

- **Case ID:** case-2026-10-29-sil552-create-floating-editor
- **Ticket:** SIL-552 (board id 626) — "[BUG] Tạo lô — Thông tin hàng: cell container render vỡ…"
- **QA bounce (29/10, build 28c3a120):** bấm dòng TRỌNG LƯỢNG/LOẠI trong ô SỐ CONTAINER trên /shipments/new vẫn chỉ edit in-cell (spinbutton/listbox), không mở panel nổi.

## Reproduction (trên build chưa fix)

1. Đăng nhập vai CUS → `/shipments/new` → Thông tin hàng → thêm container.
2. Bấm dòng **TRỌNG LƯỢNG** trong ô SỐ CONTAINER → chỉ focus ô số in-cell (spinbutton), không có panel nổi.
3. Bấm dòng **LOẠI** → chỉ mở listbox trong ô, không có panel nổi.

## Expected (quyết định owner 28/10 — lần 2, mockup SIL-552)

- Bấm dòng (hoặc Tab tới) → **panel nổi** `role="dialog"` (~300px, mũi tên trỏ về dòng) chứa editor: TRỌNG LƯỢNG = ô số + kg + Lưu; LOẠI = combobox giữ nguyên luồng "+ Thêm" (TC-CUS-CREATE-020).
- Enter/Lưu commit vào draft dòng; Escape/ngoài hoàn draft; focus quay lại trigger; trigger khai báo `aria-haspopup="dialog"` + `aria-expanded` + `aria-controls`.
- Ô SỐ CONTAINER không còn editor in-cell cho 2 dòng này; bảng không bị bóp cột.

## Guard (không được phá)

- LOẠI combobox phải **luôn mounted** trong dòng (invisible lúc rest — value-first law): react-aria validation focus "first invalid control" phải gặp LOẠI trước NHÀ MÁY. Nếu unmount combobox, validation nhảy sang NHÀ MÁY (menuTrigger='focus') → `ariaHideOutside` leak che cả trang (repro 29/10, pin: `ShipmentCreateContainerRow.sil552-floating.test.tsx` case đầu).
- Tab rời ô SỐ container mở editor LOẠI + menu đúng một lần (card 20261002_272).

## Test

- `ShipmentCreateContainerRow.sil552-floating.test.tsx` (6 case) — click/Tab mở panel, Enter/Lưu commit, Esc hoàn, guard Lưu, "+ Thêm" còn đó, combobox rest-reachable.
- `ClerkShipmentCreatePage.styles.test.ts` — pin CSS: rest invisible in-line, `is-open` = `position: fixed` + chrome, arrow chỉ trên card mở.
- Suites cập nhật flow mới: ClerkShipmentCreatePage.test.tsx, ShipmentCreateWorkspace.{mode-toggle,copy-appointment,factory-cell,invalid-required-paint}.test.tsx.
