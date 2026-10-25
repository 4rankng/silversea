# SIL-485 — Hồi quy: Drawer Chi tiết lô đọc-only (owner mockup 25/10) + SIL-486 label 'Sửa'

Ngày: 2026-10-26 · SIL-485 + SIL-486 · branch `fix-485-drawer-form`

## Bối cảnh

Drawer Tổng quan lô hàng đổi toàn bộ body: bỏ bảng container custom SIL-483 và
phương án workspace-view consult — thay bằng view review đọc-only theo mockup
owner (chips header + stepper 4 bước + 4 card + bảng 11 cột). Bảng container
chỉnh sửa được xóa khỏi drawer; chỉnh sửa đi qua footer "Sửa" →
`/shipments/:id/edit`. label nút view đổi 'Chuyển sang sửa' → 'Sửa' (SIL-486).

## Phạm vi hồi quy

| # | Khu vực | Rủi ro | Trường hợp kiểm |
|---|---------|--------|-----------------|
| R1 | Header drawer | chips mất/le layout khi title dài; icon action nhầm lô khi chuyển row | mở 2 lô liên tiếp: title + chips + aria-label icon khớp lô đang mở |
| R2 | Workflow icon block | bấm khi disabled phải có lý do, không được mở modal | action.enabled=false: bấm → banner role=alert hiện disabledReason; apiPost không gọi |
| R3 | Footer 'Sửa' | sai route/sai role; lot khóa vẫn hiện nút | CUS bấm → `/shipments/:id/edit`; ACCOUNTANT không thấy nút; activeLock ≠ null → nút disabled + lý do hiển thị |
| R4 | Stepper | sai bước hiện tại | SCHEDULED+READY+PENDING: current = Đối soát; CONFIRMED: current = Khóa lô; all-done: không aria-current |
| R5 | Bảng 11 cột | null hiện giá trị ảo; NHÀ MÁY sai label | mọi cell null = '—'; SỐ CONT null = 'Chưa có số cont'; operationalSiteId resolve qua selectors |
| R6 | Số tờ khai | count ≠ join | count = declarationNumbers.length, join cùng nguồn (không đếm row không số) |
| R7 | Đóng/mở lặp | state recognize chênh giữa các lần mở | 3 vòng mở/đóng: DOM dialog byte-identical, không tablist |
| R8 | Edit page | modal/form hỏng theo đổi label | nút 'Sửa' trên /shipments/:id (view page) + drawer cùng mở edit workspace; tests pin label mới |
| R9 | Screen reader | icon block chẽ lý do | aria-label gộp lý do khi disabled; nút aria-disabled, không disabled attr |

## Evidence

- `qa/2026-10-25-sil485/` — vitest full 5518/5518, tsgo 0, eslint 0, build,
  design:drift no-growth, screenshots 390/768/1440 (drawer view + edit) +
  `ui-driver.log` (click thật + DOM assert).
- Tests: `ShipmentsPage.test.tsx` (chips/stepper/cards/bảng/banner/Sửa role
  gate/reopen×3), `ShipmentsPage.density.test.ts`, view-mode/topline pin
  label 'Sửa'.
