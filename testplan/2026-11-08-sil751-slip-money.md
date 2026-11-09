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

## Case SIL-751-4 (r4, 09/11/2026) — header phiếu vẫn lệch 10.000₫ (OS-2611-0005)

- **Surface:** `/advances?view=ops-expenses` → 'Phiếu quyết toán Ops' (list +
  Xem chi tiết) và `/advances?view=settlements`; BE readers
  `listOpsSettlements` / `getOpsSettlementDetail`
  (ops-settlements.service.ts) + `listOpsSettlementsForForwarderPaginated` /
  `getAdvanceSettlementFromOps` (advance-settlement.service.ts).
- **Reproduction (QA comment 4691/4703/4715, staging e6db602f):** OS-2611-0005
  header 1.080.000₫ nhưng 5 dòng POSITIVE cộng đúng 1.070.000₫ (150k QBOBD39C
  + 210k R3Q-680-B + 60k R3Q-679-D + 500k R4B-CC-001 + 150k R4B-3E-FCL1);
  TỔNG CỘNG chi tiết 1.070.000₫. Không có dòng âm — gap 10.000₫ là STORED
  header chết: `ops_settlements.total_amount` được ghi lúc lập phiếu rồi
  KHÔNG BAO GIỜ được recompute khi kế toán sửa amount dòng qua
  `updateAccountingExpense` (OPS branch), trong khi r3 chỉ đi disclosure dòng
  âm (fixture r3 giả OS-2611-0005 có dòng −10.000₫ — SAI với dữ liệu thật).
- **Expected (quyết định fix lần này):** header phiếu LUÔN bằng tổng dòng
  theo luật sumExcludingNegative (card 20260928_197):
  1. Mọi reader (list + detail + 2 advance reader) DERIVE header từ dòng tại
     thời điểm load — stored column không bao giờ được in lại nữa.
  2. Sửa amount dòng (kế toán, `updateAccountingExpense` kind OPS) trên dòng
     đang nằm phiếu ⇒ recompute stored total trong cùng tx.
- **Pin:** `ops-settlement-grouping.test.ts` fixture OS-2611-0005 SỬA theo số
  thật (5 dòng dương, rawGrand = grand = 1.070.000, excludedNegative = 0) +
  OS-2610-0001 giữ nguyên (320.000 = 200k + 120k, dòng âm −50.000 loại trừ,
  raw 270.000); unit mới pin luật header=dòng + source-scan recompute tại
  đúng cửa sửa kế toán.
