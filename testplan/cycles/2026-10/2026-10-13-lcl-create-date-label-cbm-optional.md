# 2026-10-13 — Hàng lẻ (LCL): nhãn "Ngày giao hàng" + CBM không bắt buộc

Ngày: 2026-10-13 · Nguồn: 2 phiếu helpdesk của ops Tiếp Vu (form Tạo lô hàng, `/shipments/new`)

## Phiếu 1 — nhãn ngày giao (TC-LCL-DATELABEL-01)

> 'PHÀN HÀNG LẺ: CHỖ NGÀY GIAO DỰ KIẾN THAY LUÔN LÀ NGÀY GIAO HÀNG GIÚP E NHA'

Trường `shipment-expected-delivery` chỉ render trong nhánh `form.cargoMode === 'LCL'`
(ShipmentCreateWorkspace.tsx) nên đổi thẳng nhãn, không cần điều kiện.

- **Tái hiện:** mở `/shipments/new`, chọn "Hàng lẻ", mục Lịch & ghi chú hiển thị
  nhãn "Ngày giao dự kiến".
- **Kỳ vọng mới:** nhãn là "Ngày giao hàng"; id trường và tên API
  `expectedDeliveryDate` giữ nguyên; bản tóm tắt validate đổi "Chọn ngày giao dự kiến."
  → "Chọn ngày giao hàng."; trang khác (OpsOrdersPage — bộ lọc ngày riêng) không đổi.

## Phiếu 2 — CBM không bắt buộc (TC-LCL-CBM-OPT-01 / 02)

> 'hàng lẻ : phần thể tích ( cbm ) k bắt buộc cần nhập sửa lại giúp e ạ'

- **Tái hiện (TC-LCL-CBM-OPT-01):** chọn "Hàng lẻ", điền đủ các trường LCL, để trống
  "Thể tích (CBM)" → `getShipmentCreateReadiness` vẫn đẻ issue `shipment-cargo-volume`
  ("Nhập thể tích lớn hơn 0.") chặn dispatch-readiness; backend `assertIntakeReady`
  chặn submit điều phối (409 "Hàng lẻ cần đủ quy cách, số lượng, trọng lượng và thể tích.").
- **Kỳ vọng mới:**
  - TC-LCL-CBM-OPT-01: CBM rỗng (hoặc chỉ khoảng trắng) KHÔNG sinh issue; giá trị đã
    nhập vẫn phải > 0 (giữ rule zero-rejection hiện có đã pin trong model test).
  - TC-LCL-CBM-OPT-02: payload tạo lô LCL gửi `cargoVolumeCbm: null` khi rỗng
    (round-trip null, không phải 0); backend intake (submit-for-dispatch) bỏ yêu cầu
    CBM > 0, giữ quy cách + số lượng + trọng lượng; shared schema vốn
    `.optional().nullable()` — không đổi.

## Khu vực ảnh hưởng (sweep)

| # | Bề mặt | Xử lý |
|---|---|---|
| S1 | `ShipmentCreateWorkspace.tsx` DateField label | đổi nhãn (phiếu 1) |
| S2 | `shipment-create-model.ts` message + readiness CBM + payload CBM | sửa (phiếu 1+2) |
| S3 | `shipment-intake.service.ts` assertIntakeReady LCL CBM | bỏ điều kiện CBM, sửa message (phiếu 2) |
| S4 | `OpsOrdersPage.tsx` "Ngày giao dự kiến" (bộ lọc riêng) | KHÔNG đổi (không phải field này) |
| S5 | `testplan/flows/01-cus-create-shipment.md` TC-CUS-CREATE-003 | cập nhật nhãn + CBM không bắt buộc |
| S6 | Backend 409 'Hàng lẻ cần ngày giao dự kiến.' | KHÔNG đổi (copy lỗi API, ngoài phạm vi phiếu nhãn; ghi nhận) |

## Chạy xác minh

- FE: `cd frontend && npx vitest run src/features/shipments/create src/pages/clerk/ClerkShipmentCreatePage.test.tsx`
- Cross-check: `OpsOrdersPage.test.tsx` (pin nhãn riêng của trang đó — phải giữ xanh).
- Gate: `pnpm lint`, `cd frontend && npx tsc -b`, `cd backend && npx tsc --noEmit`.
- Backend suite DB chung: KHÔNG chạy (hang đã ghi nhận trong chỉ dẫn của controller).

## Re-run 2026-10-16 — kanban wave 1016c (Phiếu 1 · FB-083 nhãn "Ngày giao hàng")

Implementation status: đã có trên `origin/main` từ dispatch gốc `69708174`, pin
đã ghim bởi wave 1016b (`8374666c`); wave này chỉ re-run bằng chứng theo §6/§7,
không sửa mã.

| Gate | Kết quả | Evidence |
|---|---|---|
| `frontend npx tsc --noEmit` | exit 0 | `qa/2026-10-16_kanban-1016c-fb083_fe-tsc.log` |
| FE vitest 2 file pin `-t "Ngày giao hàng"` (asterisk-contract + ClerkShipmentCreatePage) | 2/2 PASS | `qa/2026-10-16_kanban-1016c-fb083_fe-vitest.log` |

Rung giữ nguyên mức 3 của lần drive 2026-10-16 (w3a-r17-verify `cus-create_log.json`);
lần re-run này là rung ≤2 (chạy pin, không drive UI).
