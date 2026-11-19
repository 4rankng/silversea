# Regression spec — `SIL-855` Preview Xuất Debit Note: VAT theo đợt + BKS BÁO KHÁCH

**Ticket:** SIL-855 (Chốt đợt Lần/Tháng/Năm + bảng xem trước Xuất Debit Note)
**Owner (implement):** fullstack
**Owner (verify):** qa
**Status (this doc):** LANDED 2026-11-19 (worktree wt-sil855861) — verify on staging
**Cycle:** 2026-11 wave

## Goal

Trang /accounting/chot-debit → [Xuất Debit Note] → 'Xem trước Debit Note': footer 4 dòng tổng
phải tính VAT theo đợt đã chọn (round.vatRate ghi ở [Chọn Debit]) và cột BKS BÁO KHÁCH phải
đổ BKS thật của lô (effectiveBillingPlate, rơi xuống biển số trip do ĐV gán) thay vì '—'.
Fix nằm ở BE preview service + BE issuance (cùng stamp round.vatRate lên dòng frozen để
preview ≡ Công nợ, FE reconcile không lệch); FE dialog chỉ render — pin vitest giữ 4 số.

## Out of scope

- Không đổi luật BKS trên dòng phát hành (renderData vẫn effectiveBillingPlate — GAP-3).
- Không đổi popup Chọn Debit, Luật khóa lô, luật idempotency selection-key.
- Không đổi wire shape `DebitNoteRoundPreview` (chỉ giá trị đúng hơn).

## Acceptance criteria

### TC-855-001 — Footer VAT theo đợt

- **Given** hoapt trên /accounting/chot-debit, đợt 'Lần 1 · 2026/11' (VAT 8%) gồm 2 lô 3.952.000 ₫ đã khóa.
- **When** chọn 2 lô → [Xuất Debit Note] → chọn đợt 'Lần 1 · 2026-11' trong preview.
- **Then** footer: trước thuế 7.904.000 ₫ · Giảm giá 0 ₫ · VAT 632.320 ₫ · sau thuế 8.536.320 ₫ (≡ dòng đợt trên cùng trang).
- **Assert:** DOM của bảng 'Bảng tổng hợp Debit Note'; số học `vatForAmount(net, vatRate)`.
- **Evidence:** `qa/2026-11-19_sil855_gates.log` (vitest pin DebitNotePreviewDialog QA regression); BE pin debit-note-round-vat.test.ts.

### TC-855-002 — BKS BÁO KHÁCH 100%

- **Given** cùng preview, lô có BKS trip ĐV gán 15H-104.03 (SilverSea) nhưng ô BKS báo khách trống.
- **When** đọc cột BKS BÁO KHÁCH từng dòng.
- **Then** mỗi dòng in 15H-104.03 — không có '—'.
- **Assert:** DOM; BE unit `previewPlateOf` fallback + wiring pin.
- **Evidence:** như trên.

### TC-855-003 — [Lưu] không lệch preview

- **Given** preview đúng VAT đợt.
- **When** bấm [Lưu] (hoặc [Lưu và tải file XLSX]).
- **Then** FE reconcile (issued totals vs preview) không ném 'lệch bảng xem trước'; billing_documents.totalTax = 632.320.
- **Assert:** API createDebitNoteBatch totals; DB row qua API công nợ.
- **Evidence:** rung 2+3 khi QA chạy staging.

## What is NOT covered (be honest)

- Chưa drive UI thật ở lane này (rung 1+2: BE unit/FE vitest + typecheck) — staging drive là việc của QA theo TC trên.
- Đợt VAT 0%/5%/10% trên UI thật (chỉ pin đơn vị); đợt TRA (không phát sinh phải thu).
- Error path đợt còn lô chưa khóa đã có pin cũ; replay idempotency của selection cũ (document cũ EXEMPT) sẽ báo 'lệch' — đúng thiết kế, chưa pin E2E.
