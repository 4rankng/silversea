# SIL-1095 — 5 trạng thái lô tách biệt trên chi tiết lô

Case ID: SIL-1095-R1..R5 (QA complaint 26/11, lô 167, bill `R39B1-LCL01`, `/shipments/167`).

**Ticket:** SIL-1095 (id 1271) — board `plan.tingting.vip/tingtingsoft/SIL`
**Owner (implement):** backend + frontend
**Owner (verify):** qa
**Status (this doc):** READY — regression recorded prior to implementation per AGENTS.md §6
**KB:** §1.4.3 (K1.13) — năm tình trạng là năm tình trạng khác nhau, không được gộp

---

## Goal

Chi tiết lô `/shipments/:id` có **một block trạng thái** hiển thị tách biệt đủ 5 trạng thái
theo KB §1.4.3, mỗi dòng derive từ dữ liệu có sẵn (KHÔNG phát minh trạng thái mới ở DB):

1. **Ghi nhận chi phí** — từ lưới chi phí/đối soát (khoản chưa xác nhận / chưa có).
2. **Thiếu chứng từ** — đọc từ dữ liệu Lớp 2 (document-set facts, SIL-1073) + Lớp 1
   (e-POD) + Lớp 3 (nhận phơi); nêu tên tài liệu thiếu. Không xây lại Lớp 2.
3. **Hoàn thành vận chuyển** — từ trạng thái chuyến (trips COMPLETED).
4. **Đã thanh toán** — từ công nợ phải thu (đã trả đủ / còn nợ / quá hạn).
5. **Đã khóa kỳ** — từ kỳ khóa kế toán (`period_locks` domain DEBIT_NOTE qua
   `debit_settlement_round_lots` → `debit_settlement_rounds.periodKey`): hiển thị
   *Đã khóa kỳ X* / *Đã vào kỳ X — chưa khóa* / *Chưa vào kỳ nào*.

Phần lỗi riêng của ticket: trước đây thiếu nhãn/khu vực (3) *Hoàn thành vận chuyển* và
(5) *Đã khóa kỳ* (0 lần xuất hiện trong frontend), và thiếu chỗ TỔNG HỢP 5 trạng thái.

## Out of scope

- Không trùng SIL-1073: không đổi Lớp 2, không rebuild DocumentSetCard/document-debt.
- Không đổi nghĩa "khóa lô" (`shipment_cost_locks`, chip *Đã khóa*/*Mở* trên Ghép bộ
  Debit) — đó là khóa lô, không phải khóa kỳ.
- Không tạo bảng/cột/trạng thái DB mới; không đổi wire cũ (chỉ thêm field read-only).
- Không đụng các file lane khác: `expense-accounting-voucher.service.ts`,
  `treasury.service.ts`, `frontend/src/features/expense-accounting/**`,
  `shared/src/expense-accounting*`.
- Block chỉ đặt trên chi tiết lô `/shipments/:id`; không rải sang màn khác trong ticket này.

---

## Case SIL-1095-R1 — Block tổng hợp 5 trạng thái, không gộp

- **Given** người dùng mở `/shipments/:id` (view mode, ví dụ lô 167).
- **When** xem khu vực trạng thái lô.
- **Then** có block 5 dòng trạng thái tách biệt, nhãn đúng nguyên văn KB: *Ghi nhận chi
  phí*, *Thiếu chứng từ*, *Hoàn thành vận chuyển*, *Đã thanh toán*, *Đã khóa kỳ*.
- **Assert** không có trạng thái tổng hợp gộp (ví dụ một dòng "Trạng thái: hoàn thành"
  thay 5 dòng); mỗi dòng có giá trị derive riêng; khối là static text (không giả làm
  control); không truncate nhãn/giá trị.

## Case SIL-1095-R2 — Dòng "Thiếu chứng từ" đọc đủ Lớp 2 + Lớp 1 + Lớp 3

- **Given** lô có document-set facts Lớp 2 `Còn thiếu` với danh mục thiếu, e-POD đang
  *Chờ khách xác nhận*, chưa nhận phơi.
- **When** xem dòng *Thiếu chứng từ*.
- **Then** dòng nêu trạng thái Lớp 2 kèm **tên tài liệu thiếu** (đọc từ
  `missingDocuments`), kèm tín hiệu e-POD (Lớp 1) và nhận phơi (Lớp 3).
- **Assert** Lớp 2 `Đã đủ` + e-POD đã xác nhận + đã nhận phơi → dòng xanh *Đã đủ*;
  thiếu tên danh mục mà fact không có tên → *Chưa ghi nhận danh mục* (không bịa tên).
- **API** `GET /api/shipments/:id` trả `documentSet.missingDocuments` (SIL-1073) và
  trạng thái e-POD/nhận phơi dùng cho dòng này.

## Case SIL-1095-R3 — Dòng "Hoàn thành vận chuyển" derive từ trạng thái chuyến

- **Given** lô có chuyến: (a) tất cả chuyến sống đã `COMPLETED`; (b) có chuyến đang
  `IN_TRANSIT`; (c) lô chưa có chuyến sống nào.
- **When** xem dòng *Hoàn thành vận chuyển*.
- **Then** (a) *Hoàn thành*; (b) *Đang vận chuyển* kèm số chuyến hoàn thành/tổng;
  (c) *Chưa có chuyến vận chuyển*.
- **Assert** trạng thái derive từ `trips.status`/`completedAt` (qua podReviews/hasLiveTrips
  hoặc truy vấn chuyến của lô), không suy từ shipment status khác.

## Case SIL-1095-R4 — Dòng "Đã thanh toán" derive từ công nợ phải thu

- **Given** công nợ của khách có obligation gắn trip của lô: (a) `outstanding = 0`
  (đã trả đủ); (b) còn nợ trong hạn; (c) còn nợ quá hạn (quá `processingDueDate ??`
  `originalDueDate`); (d) lô chưa phát sinh công nợ.
- **When** xem dòng *Đã thanh toán*.
- **Then** (a) *Đã thanh toán*; (b) *Chưa thanh toán* kèm số còn nợ; (c) *Nợ quá hạn*
  kèm số còn nợ; (d) *Chưa phát sinh công nợ*.
- **Assert** derive từ `CustomerReceivableObligation` (sourceTripIds khớp chuyến của lô,
  outstanding/paid/due date) — không có flag "paid" bịa trong DB.

## Case SIL-1095-R5 — Dòng "Đã khóa kỳ" đọc kỳ khóa kế toán có sẵn

- **Given** (a) lô thuộc `debit_settlement_round_lots` → round có `periodKey` X và
  `period_locks` (domain DEBIT_NOTE, scope khách) X `CLOSED`; (b) round X nhưng kỳ
  chưa khóa; (c) lô chưa vào kỳ nào.
- **When** xem dòng *Đã khóa kỳ*.
- **Then** (a) *Đã khóa kỳ X*; (b) *Đã vào kỳ X — chưa khóa*; (c) *Chưa vào kỳ nào*.
- **Assert** không có khái niệm khóa kỳ mới trong DB; không hiển thị khóa lô
  (`costLock`) như khóa kỳ; kỳ `REOPENED` → nêu kỳ đã mở lại.

---

## Fix law

Block trạng thái là derived read-only: `getShipmentDetail` trả thêm `statusSummary`
(từ `expense_accounting_sources`, `trips`/`trip_financial_state.phoi*`, document-set
facts + e-POD, `customer-receivable-authority` obligations, `debit_settlement_round_*`
+ `period_locks`) — không cột mới, không state mới. Trình bày: text + house color-dot
(design-guidelines §1), wrap không truncate (§4), static text không giả làm control.

## Verification

- BE: `cd backend && npx tsc --noEmit` + unit test pure law
  `backend/src/tests/unit/sil1095-lot-status-summary.test.ts`.
- FE: scoped vitest (`ShipmentLotStatusBlock` render từ fixture wire) + `tsc` xanh.
- Bằng chứng chạy thật / độ phủ rung UI ghi rõ trong báo cáo lane (không claim rung 3
  khi chưa drive control thật).

## What is NOT covered

- Mọi role × mọi tổ hợp trạng thái lô trên staging; dữ liệu legacy thiếu obligation.
- Sibling surfaces (CUS workspace, debit boards) không mang block trong ticket này.

## Linked artifacts

- Spec: board SIL-1095 (id 1271).
- Lớp 2 đã có: SIL-1073, commit `f82c48ae`, `/shipments/document-debt`.
