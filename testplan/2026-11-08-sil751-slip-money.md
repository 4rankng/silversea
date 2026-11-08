# SIL-751 (id 871) — Header phiếu không khớp tổng dòng + 2 quan sát nhỏ

- **Ticket:** plan.tingting.vip SIL-751 (id 871), priority HIGH. Base `origin/main` (10766dc3), branch `fix/k13-slip-money`.
- **QA report:** 08/11 — OS-2611-0005 header 1.080.000₫ vs dòng cộng 1.070.000₫; OS-2610-0001 header 320.000₫ vs dòng 270.000₫; (2) sau 'Hủy phân xe' API status lô vẫn DISPATCHED dù grid 'Chưa phân xe' + không trip sống; (3) ô 'Tiền hoàn lại' không tự điền, lưu 0 → 400 'Phiếu chưa cân đối'.

## Case SIL-751-1 — Header phiếu quyết toán ≠ tổng các dòng hiển thị

- **Surface:** Phiếu quyết toán OPS — `OpsSettlementsPanel.OpsSettlementSheet` (Ops + kế toán "Xem phiếu") + export xlsx (`exportOpsSettlementXlsx`).
- **Reproduction:** Phiếu có dòng âm (VD OS-2610-0001 trên DB :5441: −50.000 + 200.000 + 120.000). Header `total_amount` = 320.000₫ (`sumExcludingNegative`, card 20260928_197 — dòng âm bị loại, không cộng) nhưng người xem cộng cả dòng âm trên bảng = 270.000₫ → lệch 50.000₫ không có giải thích trên phiếu.
- **Root cause:** Header và mọi tổng (rổ/lô/TỔNG CỘNG) đều dùng luật "không cộng dòng âm" (card 20260928_197) nhưng bảng kê không hiển thị phần loại trừ → số học không kiểm chứng được bằng mắt.
- **Expected:** Header giữ nguyên luật tổng (không mở lại quyết định owner) nhưng phiếu hiển thị rõ: dòng âm đã loại trừ −X ₫ và tổng nếu cộng cả dòng âm Y ₫ → 320.000 − 50.000 = 270.000 kiểm chứng được. Export xlsx có cùng dòng giải thích. `reopenOpsSettlementDraft` zero `total_amount` khi VOIDED (dòng đã detach, header cũ thành ghost).
- **Pin:** unit `ops-settlement-grouping.test.ts` với đúng 2 case ticket: (1.080.000 dương + −10.000 → grand 1.080.000, raw 1.070.000) và (200.000 + 120.000 + −50.000 → grand 320.000, raw 270.000). DB staging thật OS-2611-0005 không tồn tại trên DB local :5441 (ở đó OS-2611-0005 là VOIDED 60.000 không có dòng) — case 1 pin bằng số liệu ticket.

## Case SIL-751-2 — 'Hủy phân xe' xong, API status lô vẫn DISPATCHED

- **Surface:** BE `transitionTripStatus` nhánh CANCELED (`trip-status-machine.service.ts`) + `shipments.status`.
- **Reproduction:** Lô 1 container ở READY_FOR_DISPATCH → phát lệnh điều xe (lot → DISPATCHED, `dispatch-planning-commands.service.ts`) → 'Hủy phân xe' (cancelTrip + savePlan neutral) → grid hiện 'Chưa phân xe' (đọc từ plan row) nhưng API lô vẫn trả `status: 'DISPATCHED'`. DB :5441 có ≥10 lô DISPATCHED không còn chuyến sống.
- **Root cause:** Chỉ nhánh COMPLETED của trip status machine gọi `recomputeShipmentCompletion`; nhánh CANCELED không sync shipment status.
- **Expected:** Khi chuyến bị hủy là chuyến sống cuối của lô (không còn trip sống, không trip COMPLETED) và lô đang DISPATCHED → lô về READY_FOR_DISPATCH (legal edge mới DISPATCHED→READY_FOR_DISPATCH), cùng tx với việc hủy; handoff điều vận được reset để lô quay lại hàng chờ. Lô có trip COMPLETED hoặc đã IN_TRANSIT/COMPLETED/CANCELED không bị đụng tới. Không backfill dữ liệu cũ.
- **Pin:** unit predicate `shouldRewindShipmentToReady` + source pins (status machine gọi rewind, LEGAL_TRANSITIONS có edge mới, reopen zero total).

## Case SIL-751-3 — 'Tiền hoàn lại' không tự điền; lưu 0 dính 400

- **Surface:** FE 2 form lập phiếu hoàn ứng — `AdminAdvanceSettlementCreateDialog` (kế toán) + `ForwarderSettlementCreatePage` (tự phục vụ); BE guard `assertSettlementBalanced` (`advance-settlement.service.ts:699`).
- **Reproduction:** Chọn tạm ứng + khoản chi, ô 'Tiền hoàn lại' stays 0 → Ghi nhận → BE 400 'Phiếu chưa cân đối: tạm ứng X, chi phí Y, hoàn lại 0'.
- **Expected:** Ô tự điền = tạm ứng − chi phí (có dấu, FB-100) khi người dùng chưa tự sửa; nếu tự sửa thì giữ số nhập; cảnh báo 'Chênh lệch' hiện có vẫn là đường backup rõ ràng thay cho 400 im lặng.
- **Pin:** `ForwarderSettlementCreatePage.test.tsx` + test admin dialog: chọn 1.000.000 ứng + 250.000 chi → ô tự hiện 750.000, submit payload `refundAmount: 750000`; nhập tay đè thì dùng số nhập.
