# SIL-511 — Form tạo lô: remove chip 'Áp dụng cho N container' (Lịch & ghi chú)

- Ticket: SIL-511 (board SIL, id 573) — owner 26/10.
- Role/flow: shipmentCreatorOnly (CUS/ADMIN/DISPATCHER/MANAGER), /shipments/new,
  FCL, section "Lịch & ghi chú", cạnh input "Ngày giờ đóng trả cho tất cả cont".

## Yêu cầu owner

Bỏ chip/link "📅 Áp dụng cho N container" — text thừa. Behavior apply-all VẪN
GIỮ (copy-down / copy-ALL + input nhóm) nhưng chip không render nữa.

## Case pin (expected sau thay đổi)

1. Form FCL mới: section "Lịch & ghi chú" KHÔNG có button nào khớp
   /Áp dụng cho \d+ container/; input "Ngày giờ đóng trả cho tất cả cont" vẫn
   render khi còn ≥1 cont chưa có lịch.
2. Có dòng nguồn có lịch + ≥2 cont: 2 nút apply-all còn nguyên —
   "Copy giờ hẹn cho tất cả N cont" (ghi đè cả lịch đã có) và
   "Copy giờ hẹn xuống cont trống" (chỉ dòng trống); chip vẫn vắng mặt.
3. Không reset/không đổi gì khác trong section (notes, clipboard copy).

## Regression lock

- Unit: `ShipmentCreateWorkspace.copy-appointment.test.tsx` — case
  "keeps the bulk input as a clipboard source but renders no apply chip
  (SIL-511)" (thay case R14-02 cũ click chip).
- UI drive @1440: `qa/scripts/2026-10-26-sil511-apply-chip-ui-drive.mjs`
  → `qa/2026-10-26-sil511-apply-chip/` (assertions JSON + screenshots).

## Lịch sử

- Chip sinh từ case 2026-10-11-R14-02 (FB-008): nhập ngày giờ loạt không cần
  dòng nguồn. Owner 26/10 quyết định text thừa, rút về 2 đường apply-all còn
  lại; case này pin quyết định đó để merge (SIL-509 alignment) không hồi phục
  chip.
