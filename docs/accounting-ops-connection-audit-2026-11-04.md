# Đối chiếu Kết nối Kế toán ↔ Điều vận — Chi phí · Quyết toán · Debit — 2026-11-04

**Yêu cầu:** CTO 2026-11-04 — rà soát mọi điểm kết nối giữa 3 mặt Kế toán (xây theo đặc tả của Ngọc) với luồng vận hành; "chỗ nào đang khoá thì mở ra"; mọi chỗ cần đặc tả hoặc còn tranh luận lập thành câu hỏi cho CTC/khách hàng — không tự quyết trong code.
**Ngày kiểm tra:** 2026-11-04. **Phạm vi:** ops expense ↔ accounting mirror, Chi phí – Quyết toán L1/L2 (`/shipments-debit`), Kế toán chốt debit (`/accounting/chot-debit`).
**Kết luận:** module đã nối nhiều hơn giả định ban đầu. Khoá thật còn lại là **4 nhóm**: (1) khóa lô không có lối mở, (2) giá cước thu nhập tay bị tiêu khi lưu trên strip L2, (3) khóa lô chỉ được chạy trên đúng MỘT bề mặt ghi, (4) chồng câu hỏi thiết kế (Q1–Q10) phải chờ CTO/khách hàng. Nhóm (1)–(3) mở trong lần thay đổi này (§2); (4) giữ nguyên là câu hỏi (§4) — chưa có code.

---

## §1. Bản đồ 3 mặt ↔ vận hành (đã đối chiếu)

| Mặt | Đọc từ vận hành (VERIFIED) | Ghi ngược về vận hành (VERIFIED) |
|---|---|---|
| **Ops chi phí workspace** (khoản chi Ops) | `expense_accounting_sources` mirror ↔ `ops_expense_entries` / `driver_incidental_costs` / `trip_expenses` / `shipment_invoice_records` — hydrate + upsert tại `backend/src/services/expense-accounting-source.service.ts` (VERIFIED) | Xác nhận/điều chỉnh có liên kết ghi ngược qua `expense-accounting-write.service.ts` + `source-change.service.ts` (`propagateRecordedExpense`); điều chỉnh immutable tại `expense-accounting-correction.service.ts:15-80` (VERIFIED) |
| **Chi phí – Quyết toán L1/L2** (`/shipments-debit`) | Per-lot rollup: snapshot cước + override channel (`revenue-override-read.service.ts`), chi hộ = trip expenses, phải thu = debit lines + PS + ops charge (`shipment-debit-summary.service.ts:173-327`); L2 detail = freight/chi-hộ/payables (`shipment-debit-detail.service.ts`) | L2 ghi qua `PUT /:id/debit-edits` (có `assertShipmentCostUnlocked`, `shipment-debit-detail.service.ts:556` VERIFIED); BKS/loại xe/giá cước từng lô ghi thẳng lô (`lcl-grouping.service.ts` `setLclLotRevClass` / `updateLclGroupTruck`); ghép/tách nhóm đổi tiền các lô (`mergeLclRevGroup` / `unmergeLclLot`) |
| **Kế toán chốt debit** (`/accounting/chot-debit`) | Bảng live theo selection + khóa lô + đợt chốt (`debit-settlement-rounds.service.ts`) + trạng thái debit note (`debit-note-lifecycle.service.ts`) | Xuất Debit Note từ snapshot khóa lô (`shipment-cost-lock.service.ts` `createDebitNoteFromCostLock` / `createConsolidatedDebitNote`, claim 1-lô-1-note `:33-59` VERIFIED); hủy note thả claim (`debit-note-lifecycle.service.ts:183-208` VERIFIED) |

---

## §2. Mở khoá trong lần thay đổi này (code kèm ngày 2026-11-04)

| # | Khoá (trước) | Mở (sau) | Rào chắn |
|---|---|---|---|
| 1 | **Khóa lô không có lối mở**: schema có `unlockedBy/unlockedAt/unlockReason` + partial unique index `shipment_cost_locks_active_uniq … WHERE unlocked_at is null` (`backend/src/db/schema/financial.ts:788-793` VERIFIED) nhưng không endpoint nào ghi; thông báo 409 tự nhận "Cần mở khóa (sẽ cấp sau)…" (`shipment-cost-lock.service.ts:23` VERIFIED). Khóa rồi chỉ sửa được bằng DB. | `POST /api/shipments/:id/unlock` → `unlockShipmentCost`: ghi `unlockedBy/unlockedAt/unlockReason` lên khóa active; FE thêm nút **MỞ KHÓA** trên workspace L2. Re-lock tạo row active MỚI (partial index cho phép) — history giữ nguyên. | ADMIN-only (mirror governance mở lại khóa kế toán, `shipment-accounting-lock-shared.service.ts:114-117` VERIFIED) + lý do bắt buộc 1–2000 ký tự; từ chối khi lô đang bị Debit Note chưa release claim (`Lô đã nằm trong Debit Note #<id>…`, mirror `expense-accounting-correction.service.ts:34-36` VERIFIED); KHÔNG đụng khóa kế toán (reopen khóa kế toán vẫn là kênh ADMIN riêng). |
| 2 | **Strip L2 làm mất giá cước thu nhập tay**: `DebitLotLclFacts` seed `manualFreightRevenue` từ `''` và clear mỗi lần đổi row (`frontend/src/features/shipments/debit/DebitLotLclFacts.tsx:63,75-77` VERIFIED) — CHANGELOG 2026-10-28: "chưa nối `revFreightManual` vào wire debit; giá bị tiêu khi lưu". | Wire thêm `revFreightManual` (shared schema + producer + FE row type); strip seed từ giá đã lưu, dirty = lệch seed, response save re-seed (pattern SIL-548 đã chạy trên CUS container ledger). | Một kênh đọc duy nhất (`loadRevManualPriceByLot`), không kênh song song; "Bỏ trống = tự tra" giữ nguyên. |
| 3 | **Khóa lô chỉ chặn đúng MỘT bề mặt ghi**: `assertShipmentCostUnlocked` chỉ được gọi bởi `shipment-debit-detail.service.ts:556` (VERIFIED). Merge/unmerge, sửa loại xe/nhóm xe, Ops-wallet expense writes, forwarder trip-expense writes đổi tiền lô đã khóa không bị chặn — snapshot đóng băng lệch thầm lặng. PRD §7.9 (`docs/prd/QuyTrinhO2C.md:294` VERIFIED): "Sửa chi phí bị chặn khi lô đã khóa; các trường theo dõi thực tế vẫn bổ sung được". FE đã hứa trước: "Tách nhóm" disable theo `costLockedAt` (`AccountingDebitClosePage.tsx:207-209` VERIFIED) trong khi BE không chạy. | Thêm `assertShipmentCostUnlocked` vào: `setLclLotRevClass`, `updateLclGroupTruck` (named lot + mọi thành viên nhóm), merge (`assertMergeableMoney`) và unmerge (`assertGroupMutable`) — chặn **mọi lô thành viên**, không chỉ lô được click; `ops-expenses.service.ts` create/update; forwarder `createTripExpense`/`updateTripExpense`/`deleteTripExpenseInTx` qua helper mới `assertTripShipmentCostUnlocked` (mirror `assertTripShipmentAccountingUnlocked` kể cả fail-open wave-model); Ops chi phí board tính `locked` kể cả khóa lô active (`expense-accounting-reads.service.ts:301`) để disable hàng thay vì để 409 bất ngờ. | Trường theo dõi thực tế vẫn ghi được theo PRD (`setPhoiPhieuDeposit` ngày/tiền về — không đổi). KHÔNG chặn `updateAccountingExpense` + các edit nguồn kế toán (Q5 — chờ khách hàng phán quyết kênh `cost-adjustments`). |

---

## §3. Khoá CÓ Ý CHÍ — giữ nguyên (đã kiểm, không phải bug)

| Khoá | Bằng chứng (VERIFIED) | Lý do giữ |
|---|---|---|
| Phiếu hoàn ứng tay bất biến sau RECORDED | `forwarder.service.ts:518-519,635-636` — chỉ MANUAL link khóa; FB-033 auto-offset **release** thay vì chặn | Quy tắc đối soát thủ công hai bước; điều chỉnh phải qua governed adjust/reverse |
| Mở lại khóa kế toán = ADMIN + lý do | `shipment-accounting-lock-shared.service.ts:114-117` — "ADMIN cần mở lại lô hàng với lý do hợp lệ" | Governance khách hàng đã chấp nhận; unlock khóa lô (§2.1) mirror đúng cấp này |
| Một Debit Note đã issued / một lô đã khóa | `shipment-cost-lock.service.ts:30-59` (claim `debit_note_lots`) | Ruling 2026-09-19 — chống xuất trùng; hủy note thả claim rồi mới mở tiếp |
| Đợt chốt từ chối chồng lapped | `debit-settlement-rounds.service.ts:195-196` (advisory lock + unique `debit-settlement-round` per customer+period) | Đúng đặc tả; semantics đợt chốt là Q1 |
| e-POD/COMPLETED gates trên pipeline note theo chuyến | `billing-document-draft.service.ts` (DRAFT→PAID lifecycle, VAT thật) | Pipeline chuyến có vòng đời chứng từ riêng |
| Tạm ứng phải có tiền trước khi chi | `advance-consumption.service.ts` (seam chống double-count duy nhất) | Bảo toàn quỹ; đã có test riêng |
| Điều chỉnh sau khóa yêu cầu khóa kế toán đang mở | `shipment-cost-lock.service.ts:210` | Sanctioned channel; dead-end khi lô nằm dưới cả hai khóa là **Q3** (câu hỏi, không phải bug) |

---

## §4. Câu hỏi cho CTO / khách hàng — CHƯA CÓ CODE, chờ trả lời

> Mỗi câu: ngữ cảnh (file:line đã đối chiếu) + đề xuất. Không câu nào được quyết trong code trước khi có trả lời.

| # | Câu hỏi | Ngữ cảnh (VERIFIED) | Đề xuất |
|---|---|---|---|
| **Q1** | **Semantics đợt chốt**: hiện chỉ là ghi sổ — 2 insert (round + round_lots), không post ledger, không khóa edit, không reopen; ops sửa sau chốt không tính lại/không cắm cờ số đông băng; tiền bảng live tiếp tục sống ⇒ live board / snapshot đóng băng / số đợt chốt có thể lệch nhau vô hạn. Chứa ý? | `debit-settlement-rounds.service.ts:194-212` | Giữ bookkeeping-only (ghi rõ cho khách) HOẶC nâng thành design round: posting + staleness flag + reopen. Nếu chốt phải buộc tiền ⇒ một vòng design riêng. |
| **Q2** | **Debit-note VAT truth**: pipeline lô đóng băng phát hành mọi dòng EXEMPT/0-VAT và nhảy thẳng SENT; đợt chốt ghi VAT 0/5/8/10; pipeline chuyến tính VAT thật với vòng DRAFT→PAID. Cái nào là chuẩn sự thật của hóa đơn? *(Smoke 2026-11-04 tìm thêm: KHÔNG có route nào gọi được chuyển trạng thái CANCELED của note — nhánh release claim `debit-note-lifecycle.service.ts:183-208` chỉ tới được từ code; hủy note trên UI hôm nay không tồn tại.)* | Frozen: `shipment-cost-lock.service.ts:301-377` + `shipment-cost-lock-lines.ts:52-54`; chuyến: `billing-document-draft.service.ts`; vòng đời: `debit-note-lifecycle.service.ts:29-37` | Chọn một kênh sự thật; nhất thiết không để 3 mạch VAT song song. Cần surface hủy note nếu quy trình đòi. |
| **Q3** | **adjustShipmentCost dead-end dưới hai khóa**: kênh chỉnh sau khóa hợp lệ vẫn yêu cầu khóa kế toán đang mở — lô nằm dưới cả hai khóa KHÔNG còn kênh điều chỉnh nào. | `shipment-cost-lock.service.ts:210` | Nới `adjustShipmentCost` chạy dưới khóa kế toán (đã là ACCOUNTANT/ADMIN + lý do). Phương án khác: bắt ADMIN mở lại khóa kế toán trước. |
| **Q4** | **Phiếu quyết toán OPS không có void sau RECORDED**: entries đóng băng vĩnh viễn; phía kế toán sửa cũng dead-end khi đã đối chiếu/thu-chi. Cần governance void/reopen? | `ops-settlements.service.ts:170-172`; `ops-expenses.service.ts:142-144`; `expense-accounting-source.service.ts:146,151` | Thêm void có lý do + audit (mirror Q10 pattern) nếu quy trình cần. |
| **Q5** | **Edit phía kế toán vs khóa lô**: `updateAccountingExpense` đổi tiền lô dưới snapshot đóng băng, không kiểm khóa lô (chủ ý không chặn ở §2.3). | `expense-accounting-write.service.ts` | **ĐÃ GIẢI QUYẾT r2 2026-11-04 (QA comment 3834):** nhánh ghi tiền (`!evidenceOnly`) của `updateAccountingExpense` giờ `assertShipmentCostUnlocked` → 409 message khóa lô; `correctAccountingExpense` (đi cùng hàm) và xóa dòng phôi-phếu (`voidPhoiPhieuRow`) + xóa khoản ops (`deleteOpsExpense`) cùng lớp được gate; trip-link/evidence-only giữ nguyên. Tracking-reality (deposit/money-received/phoi-meta) vẫn mở per PRD §7.9. Bằng chứng: `qa/2026-11-04-lock-audit-r2/`. |
| **Q6** | **Chi tài xế trên xe ngoài**: kế toán không bao giờ confirm được dòng tài xế nhập ("Xe ngoài không đối chiếu chi do tài xế nhập…") — nhập lại là con đường duy nhất. Chốt quy trình? | `trip-carrier-scope.ts:34-37` | Ghi rõ SOP: kế toán nhập lại dòng riêng (đã hỗ trợ) thay vì sửa dòng tài xế. |
| **Q7** | **Dòng thanh toán legacy không đối tượng** đọc vĩnh viễn: tiền nhìn thấy nhưng không bao giờ voucher được. | `expense-accounting-reads.service.ts:140-156` | Chấp nhận read-only có ghi chú, HOẶC dự án dọn dữ liệu một lần. |
| **Q8** | **Đảo chi công ty**: `/expenses` (`expense.service.ts`) không mirror vào `expense_accounting_sources` (0 tham chiếu) — tàng hình với mọi mặt Chi phí/Quyết toán/Debit. Chứa ý? | `expense.service.ts` (đối chiếu: không ghi expense_accounting_sources) | Nếu chi công ty phải hiện ở workspace kế toán ⇒ đặc tả mirror; nếu không ⇒ ghi rõ island. |
| **Q9** | **Inbox/đăng ký kế toán chỉ có link**: blockers xử lý bằng cách nhảy sang trang ops. Cần action inline? | `work-inbox.service.ts` (blockers chỉ label + ownerRole); `frontend/src/features/accounting/AccountingTransportRegister.tsx:396-399` (link `Công nợ`) | Ưu tiên thấp; nếu khách muốn, liệt kê action nào xứng đáng inline. |
| **Q10** | **UX phụ**: (a) filter khoản mục chưa ship — cần wire field trước (`frontend/src/features/shipments/ShipmentDebitRibbon.tsx:24-28`); (b) CUS drawer hiện `isLoss` không kèm số tiền, không link-out Debit Note (`cus-workspace-builders.service.ts:522-526`); (c) cap export 200 chỉ nằm trong tooltip (`AccountingDebitClosePage.tsx:407-411`); (d) Phí RU trắng tới khi khách đổ `pricing_tables` (data entry, không phải code); (e) `DebitNoteFreightOverride.tsx` đã build tại `frontend/src/components/billing/DebitNoteFreightOverride.tsx` nhưng chưa mount đâu — gắn ở đâu? | Như cột ngữ cảnh | Xếp theo lựa chọn của khách; (e) cần chỉ định mặt mount. |

---

## Ngoại phạm vi (3 dòng)

- Không đổi governance vai trò nào ngoài unlock (ADMIN-only, một dòng `requireRoles` + FE gate nếu khách muốn thêm ACCOUNTANT).
- Không viết code cho Q1–Q10; không phát minh schema mới trong lúc chờ trả lời.
- Đợt chốt là bản ghi sổ: unlock lô KHÔNG viết lại/không cắm cờ đợt chốt đã tạo (Q1 giữ tương lai của semantics đó).
