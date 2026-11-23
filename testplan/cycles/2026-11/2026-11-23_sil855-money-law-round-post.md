# Regression spec — `SIL-855` Money law: tổng Debit Note ≡ tổng đợt chốt (R3P-677-C = 0 ₫)

**Ticket:** SIL-855 (re-open 23/11 — QA fail build `6bcc081e`)
**Owner (implement):** fix lane (omp, main checkout)
**Owner (verify):** qa
**Status (this doc):** LANDED 2026-11-23 — verify on staging
**Cycle:** 2026-11 wave

## QA repro (verbatim facts)

Round 5 (Lần 1 · 2027-05, Long Minh, Phải thu, VAT 8%): lô A + C, cước 3.952.000 ₫/lô.
`[Chốt đợt]` ghi đúng round id 5 = 7.904.000 / 632.320 / **8.536.320** (lotCount 2 — tính theo
bảng, ô cước nhập đè SIL-805). Preview lại hiện **R3P-677-C = 0 ₫** (footer 3.952.000/316.160/
**4.268.160**) và `[Lưu]` đẩy đúng một nửa: Công nợ phải thu +4.268.160 ₫ — thiếu 4.268.160 ₫.
API: `debit-merge` C có `revenue.cuoc 3952000` nhưng `control.tongTc null` (A có tongTc).

## Root cause (3 lớp, đúng theo code)

1. **Freeze bỏ sót override SIL-805.** Cước C chỉ tồn tại trong ghi đè inline
   `shipments_debit_rate_overrides.cuocThu` (bảng giá thiếu tuyến/loại xe → pricing projection
   MISSING_AUTHORITY). Mọi ô bảng merge ghi đè đó (`applyDebitRateOverridesToCells`) và
   `[Chốt đợt]` lấy tiền từ ô merge; `buildCostSnapshot` chỉ đóng băng kênh giá tự động →
   `freightAuto/receivableTotal = null` trong snapshot khóa lô.
2. **Builder im lặng trước snapshot không tiền.** `buildFrozenShipmentDebitLines`: guard SIL-693
   chỉ chặn basis **SKIP**; verdict đủ căn cứ (**LOCK**) mà bảng giá không trả giá (và không có
   override) → không dòng nào, lô = 0 ₫ mà không 409.
3. **Không ai đối chiếu note ↔ đợt.** Preview ≡ [Lưu] (cùng builder, cùng sai) nhưng ≢ đợt;
   `[Lưu]` 201 với một nửa tiền.

## Fix (commit trên main)

- `buildCostSnapshot` đọc ghi đè cước thu mức-lô (containerId null — đúng ô TOP-level bảng đọc)
  và đưa vào `getShipmentDebitSummary` qua `options.freightOverrideByLot` → freeze freeze đúng ô
  merge. UI calls không truyền options → byte-identical.
- `buildFrozenShipmentDebitLines`: basis **LOCK** + `freightAuto` null → **409** với remedy
  (nhập ô Cước thu / bổ sung bảng giá, mở khóa — khóa lại). Luật cũ giữ nguyên: SKIP/AD_HOC,
  legacy snapshot, và **0 đã tính là một giá trị** (D02).
- `assertRoundIssuanceTotals` (debit-settlement-shared): tổng note ≡ đợt (net exactly, gross =
  amount + `vatForAmount`), wire vào **CẢ** preview và `[Lưu]` gộp — lệch → 409 trước khi tạo
  document/claim nào.
- Repair lever: `POST /api/finance/billing-documents/:id/cancel` (ADMIN/MANAGER/ACCOUNTANT, lý
  do bắt buộc, idempotent) → lifecycle CANCELED (SENT→CANCELED đã legal) → nhả claim lô + mọi
  aggregate Công nợ loại CANCELED; `billingDocumentIsLive` coi CANCELED là dead để cùng
  selection phát hành lại được.

## Out of scope

- Không đổi luật BKS, VAT theo đợt (đã landing 19/11), luật khóa lô, wire shape preview.
- Không tự sửa số liệu staging trong code — repair là runbook thủ công (dưới đây).

## Acceptance criteria (staging)

### TC-855-100 — Freeze thấy cước nhập đè (regression gốc)

- **Given** lô mới không có bảng giá (pricing MISSING_AUTHORITY), kế toán nhập cước inline trên
  Kiểm soát lô hàng (SIL-805), rồi Khóa lô.
- **When** GET `/api/accounting/debit-merge` sau khóa.
- **Then** lô đó `control.tongTc = cước đã nhập`; preview hiện đúng số đó (không 0 ₫).
- **Evidence:** BE pin `debit-note-money-law.test.ts` (wiring freeze + builder LOCK-miss 409).

### TC-855-101 — Tổng post ≡ tổng đợt (money law)

- **Given** đợt như round 5 (2 lô × 3.952.000 @8% = 8.536.320).
- **When** [Xuất Debit Note] → [Lưu].
- **Then** footer 7.904.000 / 0 / 632.320 / 8.536.320; Công nợ phải thu **+8.536.320**. Bất kỳ
  trạng thái snapshot thiếu tiền → preview/[Lưu] **409** có hướng dẫn (không còn đẩy nửa tiền).
- **Evidence:** BE pin `assertRoundIssuanceTotals` (QA numbers), wiring preview + issueInTx.

### TC-855-102 — Repair path (chạy 1 lần trên staging data lệch)

Runbook cho round 5 hiện trạng (note đã đẩy 4.268.160; lô A+C 'Đã khóa' trong round 5):

1. `GET /api/finance/billing-documents?…` → tìm note id đã tạo 23/11 (totalNet 3.952.000,
   settlementRoundId 5). Note là **CORRECTION candidate**: vì `debitNoteStatus = 'SENT'`
   (không xóa được) và claim lô còn active — điều chỉnh nguồn (DEBIT_NOTE_ADJUSTMENT) sẽ
   409 'Không có chênh lệch nguồn' khi snapshot chưa sửa. ⇒ **RE-POST: hủy + phát hành lại**.
2. `POST /api/finance/billing-documents/<noteId>/cancel` — body `{"reason":"SIL-855 round 5 thiếu 4.268.160 ₫ (R3P-677-C khóa khi chưa có cước) — hủy note nửa tiền, phát hành lại"}` (kèm
   `Idempotency-Key`). Kết quả: Công nợ trả về 157.945.320; claim lô A+C nhả
   (`DOCUMENT_CANCELED`).
3. Unlock 2 lô (POST `/api/shipments/800/unlock`, `/801/unlock` — lý do SIL-855; cước nhập đè
   SIL-805 KHÔNG mất khi unlock).
4. Khóa lại 2 lô — freeze mới gắp cước override (TC-855-100).
5. [Chọn Debit] → [Xuất Debit Note] → chọn round 5 → preview 2×3.952.000, footer 8.536.320 →
   [Lưu] → Công nợ phải thu = 162.213.480 (≈ net +4.268.160 so với trước, đúng bằng round 5;
   note mới có tổng == round, đối chiếu không lệch).

## Gates (this landing)

- BE unit full: **1368 pass / 0 fail** (mới: `debit-note-money-law.test.ts`).
- BE integration full: **398 pass / 0 fail**.
- `tsc --noEmit` (shared) + `tsc -p tsconfig.build.json --noEmit` (BE): 0 lỗi.
- eslint 9 file đụng: clean.
