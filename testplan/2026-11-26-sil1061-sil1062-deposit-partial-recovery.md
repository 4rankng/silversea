# SIL-1061 + SIL-1062 — Hoàn cược từng phần (số đã hoàn + ngày nhận thực tế) + cảnh báo quá hạn công văn đếm đủ lô

Case ID: SIL-1061-R1..R5 · SIL-1062-R1..R3 (QA reopen 26/11, staging build `99c711f2`, role
ketoan `hoapt` / `Abc123`, `/accounting/deposit-tracker` + `/accounting`).

**Ticket:** SIL-1061 (id 1232) · SIL-1062 (id 1233) — board `plan.tingting.vip/tingtingsoft/SIL`
**Owner (implement):** backend + frontend
**Owner (verify):** qa
**Status (this doc):** READY — fix landed on `main` (chưa deploy); QA chạy khi staging chứa fix
**KB:** Ch.2 §2.4.7 (K2.118, K2.150) · Ch.2 §2.5.1 V24 (K2.151) · card 370 R4 · card 369

---

## Goal

Bảng theo dõi hoàn cược phải ghi được **số đã hoàn từng phần** + **ngày nhận thực tế**
(0 ≤ đã hoàn ≤ số cược; đã hoàn > 0 bắt buộc có ngày nhận), và cảnh báo quá hạn nộp
công văn phải đếm **mọi** lô quá 7 ngày chưa nộp CV — kể cả lô chưa ghi ngày cược.
Sau khi hoàn được từng phần, **mọi mặt tiền** của hoàn cược đọc cùng một luật: tiền đã
về = số đã hoàn, tiền còn nợ = số cược − đã hoàn.

## Out of scope

- Không đổi luật bút toán quỹ: tiền hoàn vẫn là `treasury IN` mã `DEPOSIT_TRACKER:{id}`
  (`TxnType.ADJUSTMENT`, credit-only), **không** phải doanh thu vận tải.
- Không đổi luật `Đã hoàn cược` tick 2 lần trên dòng đã đủ → 409.
- Không mở lại `POST /api/accounting/deposits` (tạo dòng) cho số đã hoàn — KT ghi số đã
  hoàn qua tick hoặc hộp "Cập nhật hoàn cược".
- Không đụng ngân sách quỹ, hạch toán ngoài hoàn cược, hay phân quyền RBAC.
- Không sửa dữ liệu cũ: dòng legacy (chưa có cột `recovered_amount`) giữ nguyên nghĩa.

---

## Case SIL-1061-R1 — Ghi được số đã hoàn từng phần + ngày nhận thực tế

- **Given** kế toán `hoapt` ở `/accounting/deposit-tracker`, một dòng cược **2.000.000 ₫**
  (Bill test, ví dụ `F2TEST261126`), trạng thái *Chưa hoàn cược*.
- **When** bấm **Đã hoàn cược** → hộp *Ghi nhận hoàn cược* mở ra.
- **Then** hộp có ô **Số tiền đã hoàn (₫)** (prefill = phần còn lại = 2.000.000) và ô
  **Ngày nhận thực tế**; nhập `500.000` → **Xác nhận đã hoàn cược**.
- **Assert** dòng bảng in phụ dưới Số tiền cược: `Đã hoàn 500.000 · Còn lại 1.500.000 ₫`;
  trạng thái vẫn *Chưa hoàn cược*; banner **Chưa hoàn cược số tiền** giảm 500.000.
- **API** `GET /api/accounting/deposits` → row có `recoveredAmount: "500000"`,
  `refundReceivedDate: "<ngày nhận>"`, `status: "CHUA_HOAN_CUOC"`.
- **DB** `treasury_movements` có 1 movement `IN` **500.000** (không phải 2.000.000),
  `physicalReference` `HOAN-CUOC-{id}-{bill}`; `ledger_entries` credit 500.000,
  `receiptId` `DEPOSIT_TRACKER:{id}`.

## Case SIL-1061-R2 — Đã hoàn > 0 bắt buộc có ngày nhận thực tế

- **Given** cùng dòng như R1.
- **When** xóa ngày nhận thực tế → **Xác nhận đã hoàn cược**.
- **Then** hộp báo lỗi (role=alert) *Số tiền đã hoàn lớn hơn 0 bắt buộc có Ngày nhận
  thực tế.* và **không** gọi API.
- **API** `POST /api/accounting/deposits/{id}/refund` với `recoveredAmount` mà không
  `refundReceivedDate` → **400** cùng thông điệp.

## Case SIL-1061-R3 — Vượt số cược bị chặn

- **Given** dòng cược 2.000.000 ₫ đã hoàn 500.000 ₫ (còn 1.500.000 ₫).
- **When** nhập số đã hoàn `1.600.000` (> phần còn lại) → xác nhận.
- **Then** hộp báo lỗi *Số tiền đã hoàn không được vượt số tiền cược còn lại (1.500.000 ₫)*.
- **API** `POST /api/accounting/deposits/{id}/refund {recoveredAmount: 1600000}` → **400**.

## Case SIL-1061-R4 — Tích tiếp đợt còn lại; dòng đã đủ vẫn 409

- **Given** dòng đã hoàn 500.000 ₫ (R1).
- **When** bấm **Đã hoàn cược** lần nữa → hộp prefill **1.500.000** → xác nhận.
- **Then** dòng in `Đã hoàn 2.000.000 · Còn lại 0 ₫`, trạng thái *Đã hoàn cược*; quỹ có
  **2** movement IN (500.000 + 1.500.000) — mỗi đợt một movement.
- **When** bấm **Đã hoàn cược** lần 3 trên dòng đã đủ.
- **Then** **409** *Dòng này đã ghi nhận hoàn cược — không thể tích lại.*

## Case SIL-1061-R5 — Hộp "Cập nhật hoàn cược" sửa được 2 trường

- **Given** dòng *Chưa hoàn cược*.
- **When** bấm **Ngày CV / số tiền**.
- **Then** hộp có thêm ô **Số tiền đã hoàn (₫)** và **Ngày nhận thực tế**; sửa rồi
  **Lưu thay đổi** → `PATCH /api/accounting/deposits/{id}/dates` trả 200 và row đọc lại
  đúng 2 trường; số đã hoàn > 0 mà xóa ngày nhận → **400**.

## Case SIL-1061-R6 — Cảnh báo quỹ và biểu đồ tuần đọc CÙNG luật với bảng

- **Given** dòng cược 2.000.000 ₫ đã hoàn 500.000 ₫ (R1), còn 1.500.000 ₫.
- **When** mở `/accounting` (tab Tổng quát về tiền).
- **Then** AlertStrip **Container chưa hoàn cược** → *Tổng tiền* = **1.500.000 ₫**
  (phần còn lại), **không** phải 2.000.000 ₫ — bằng đúng banner của bảng theo dõi hoàn
  cược (card 370 R4: cảnh báo phải trùng bảng).
- **And** biểu đồ cột **cược container theo tuần** → series **Đã hoàn cược** của tuần
  có đợt tích = **500.000 ₫** (tiền đã về), không phải 0 ₫ và không phải 2.000.000 ₫.
- **API** `GET /api/accounting/money-alerts` → `unrefundedDeposits.amount` =
  tổng phần còn lại của các lô chưa hoàn cược;
  `GET /api/accounting/deposits/weekly-summary` → `weeks[].refundedAmount` = tiền đã về.

## Case SIL-1062-R1 — Cảnh báo quá hạn công văn đếm đủ lô (kể cả lô chưa có ngày cược)

- **Given** 3 lô chưa nộp CV và đã quá 7 ngày: `JH202609258` (23/09/2026, 64 ngày,
  **depositDate = null** — ngày hiển thị lấy từ ngày tạo lô), `TOPL2609008` (07/10/2026),
  `NOSTC26HF67962` (07/10/2026).
- **When** mở `/accounting/deposit-tracker`.
- **Then** banner ghi **03 lô hàng** (trước fix: **02** — lô không có ngày cược biến
  mất khỏi đếm).
- **API** `GET /api/accounting/deposits` → `warnings.cvOverdueCount = 3`.
- **Mốc đếm** = ngày cược nếu có, không thì **ngày tạo lô theo lịch VN** (đúng ngày
  đang hiển thị ở cột NGÀY) — quyền ưu tiên này đè luật SIL-914 cũ (bỏ qua lô thiếu
  ngày cược).

## Case SIL-1062-R2 — Biên 7 / 8 ngày

- **Given** một lô có ngày cược hôm nay (0 ngày) và một lô có ngày cược 8 ngày trước.
- **When** đọc `warnings.cvOverdueCount`.
- **Then** chỉ lô quá 7 ngày được đếm (ngày thứ 8 trở đi tính); lô đã có ngày nộp CV
  hoặc đã hoàn cược không bao giờ được đếm.

---

## Fix law (landed)

**SIL-1061** — tick "Đã hoàn cược" nhận thêm `recoveredAmount` + `refundReceivedDate`
(`POST /api/accounting/deposits/{id}/refund`): 0 ≤ đã hoàn ≤ số cược (vượt → 400), đã
hoàn > 0 bắt buộc có ngày nhận thực tế, còn lại > 0 thì dòng giữ *Chưa hoàn cược* và
tích tiếp được đợt còn lại, dòng đã đủ vẫn 409. Cột mới `recovered_amount` +
`refund_received_date` (`backend/drizzle/20261126140000_sil1061_deposit_partial_recovery.sql`).
Hộp "Cập nhật hoàn cược" sửa được 2 trường (`PATCH /api/accounting/deposits/{id}/dates`),
không giảm được số đã hoàn sau khi bút toán quỹ đã chạy. Tiền hoàn **vẫn** là bút toán
quỹ `treasury IN` mã `DEPOSIT_TRACKER:{id}` — mỗi đợt một movement, không phải doanh thu
vận tải.

**SIL-1062** — `isCvOverdue` lấy mốc = ngày cược **?? ngày tạo lô (lịch VN)** thay vì bỏ
qua lô `depositDate = null`; mốc là đúng ngày đang hiển thị ở cột NGÀY nên banner và
bảng không lệch nhau.

**§4 — hai mặt tiền còn lại (phần lane r31a bỏ sót)** — sau khi hoàn được từng phần, mọi
mặt tiền phải đọc cùng một luật (card 370 R4):
`depositReceived` (tiền đã về = số đã hoàn; dòng legacy đã hoàn cược trọn → trọn số
cược) + `unrefundedDepositsTotal` (tiền còn nợ = số cược − đã hoàn) — dùng chung cho
banner bảng theo dõi hoàn cược **và** cảnh báo "Container chưa hoàn cược" ở `/accounting`;
series "Đã hoàn cược" của biểu đồ tuần tính theo `depositReceived` nên lô hoàn một phần
vẫn có tiền về trong tuần đó.

## Verification

- BE unit (`backend/src/tests/unit/deposit-refund-partial.test.ts`) — **37/37 pass, 0 fail**
  (gồm `depositReceived` / `unrefundedDepositsTotal` / `computeDepositWeeks`: lô hoàn
  một phần → tuần có 500.000 ₫ tiền về; dòng legacy → trọn số cược; tiền về ngoài kỳ
  không vào series).
- BE unit (`backend/src/tests/unit/deposit-intake-laws.test.ts`) — luật `isCvOverdue`
  (lô `depositDate` null 64 ngày, biên 7/8 ngày).
- BE `npx tsc --noEmit` — 0 error. FE `npx tsc -b` — 0 error.
- FE `vitest run` DepositRefundTrackerPage(.test/.helpers/.alerts/.styles) +
  DepositWeeklyChart + AccountingOverview + accountingCommandRetry — pass.

## What is NOT covered (be honest)

- Chưa có bằng chứng staging/DB cho vòng QA này (fix **chưa deploy** — lane này chỉ
  commit + push, không `make deploy`).
- Lô hoàn nhiều đợt **khác tuần**: series "Đã hoàn cược" gán toàn bộ số đã hoàn vào
  tuần của đợt tích cuối (`refundPostedAt`) — giới hạn đã biết của mô hình 1 cột mốc
  thời gian, không phải lỗi của luật số tiền.
- Vai trò khác kế toán, viewport mobile, rollback path, và dữ liệu production: ngoài
  phạm vi.

## Linked artifacts

- Tickets: SIL-1061 (id 1232) · SIL-1062 (id 1233) — board SIL, cột **QA** (26)
- Code: `backend/src/services/deposit-refund-tracker.service.ts`,
  `backend/src/services/money-alerts.service.ts`,
  `frontend/src/pages/accounting/DepositRefundTrackerPage.tsx`
- Migration: `backend/drizzle/20261126140000_sil1061_deposit_partial_recovery.sql`
