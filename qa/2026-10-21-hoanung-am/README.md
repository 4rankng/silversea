# QA Guide — Hoàn ứng SỐ ÂM (chi phí vượt tạm ứng) — QA R30 follow-up

**Verdict: FLOW ĐÚNG nghiệp vụ — không cần fix code.** Đã verify E2E 20/20
PASS trên local dev (21/10/2026): tạm ứng 100.000 duyệt = giải ngân → chi phí
gắn chuyến 150.000 (OPS_ADVANCE) → phiếu hoàn ứng "Tiền hoàn lại" **−50.000**
hiển thị đúng + kế toán **DUYỆT** thành công. Số âm = **Cty trả thêm Ops phần
chi vượt tạm ứng** — đúng luật FB-100 (card 141026230770, `signedNumeric`).

## 1. Flow nghiệp vụ đã audit (trace code + chạy thật)

| Bước | Bề mặt | Hành vi hệ thống |
|---|---|---|
| 1. Tạm ứng | Ops `/my-advances` tạo 100.000 → Kế toán `/advances` duyệt | PENDING → RECORDED; **duyệt = giải ngân**: ledger `OPS_ADVANCE` credit 100.000 + dòng treasury `OUT` 100.000 (`approveAdvanceRequest` + `fundAdvance`, KP-148) |
| 2. Chi phí vượt | Ops ghi chi phí gắn chuyến 150.000, "Chi hộ tạm ứng" | Tự đối trừ (auto-offset) **cố ý bỏ qua**: tạm ứng 100k < chi 150k → hệ thống KHÔNG overdraw ví, khoản chi chờ quyết toán tay (`autoOffsetRecordedExpense` — "leave it for explicit reconciliation") |
| 3. Kê xong | Ops xác nhận kê xong chi phí | `completionStatus = COMPLETED` — điều kiện để chi phí vào phiếu |
| 4. Phiếu hoàn ứng | Ops `/my-settlements/new`: tick "Xác nhận hoàn ứng", nhập **Tiền hoàn lại = −50.000** | Schema `signedNumeric` nhận số âm; cân đối 100.000 − 150.000 − (−50.000) = 0 ⇒ 201 `PT-…`, `refundAmount = -50000`; bút toán `OPS_SETTLEMENT` debit = 150.000 + (−50.000) = **100.000** ⇒ số dư tạm ứng Ops về đúng 0 |
| 5. Kế toán duyệt | Kế toán `/advances?view=settlements` → **DUYỆT PHIẾU HOÀN ỨNG** | `checked_by`/`checked_at` stamp; nút biến mất, dòng thành "Đã duyệt (KT): …"; duyệt lại → 409 |

Số âm KHÔNG block duyệt — không có sign guard nào trên đường tạo/duyệt phiếu.
Luật "ai nợ ai" (card 2026-10-05_1544): phần CHƯA quyết toán — balance dương ⇒
"Công ty yêu cầu hoàn trả tạm ứng"; balance âm ⇒ "Công ty thanh toán hoàn ứng";
phiếu cân đối (case này) ⇒ không notice.

## 2. Data script (idempotent, LOCAL only)

```sh
node testplan/qa/scripts/2026-10-21-hoanung-am-e2e.mjs
```

- Tự đủ: tạo (nếu thiếu) user OPS `hoanungqa` gắn lô 311836 — **ví trống** để
  auto-offset không nhiễu (dùng user Ops có tạm ứng dư ≥ 150k sẽ bị tự đối trừ
  luôn khoản chi, không ra được phiếu âm).
- Chuỗi: tạm ứng 100.000 → duyệt/giải ngân → chi phí 150.000 trên chuyến
  193772 → kê xong → phiếu lệch (+50k) bị 400 → phiếu âm (−50k) 201 → UI kế
  toán hiển thị −50.000 ₫ → click DUYỆT → DB/API assert + double-duyệt 409.
- Env: `API_PORT` (3002), `FRONT_PORT` (7175), `ACCOUNTANT` (ketoan),
  `OPS_USER`, `SHIPMENT_ID`, `TRIP_ID`, `SKIP_UI=1` (chỉ API).
- Output: `qa/2026-10-21-hoanung-am/` — `e2e-driver.log`, `probe-result.json`,
  `db-proof.txt`, PNG từng bước. **Không trỏ staging.**

## 3. Bản đồ hiển thị số âm (để QA biết nhìn đâu)

| Bề mặt | Số −50.000 hiện ở đâu |
|---|---|
| Kế toán `/advances?view=settlements` (desktop) | summary strip từng phiếu: **"Hoàn lại -50.000 ₫"** (luôn hiện, có dấu) |
| Kế toán — mobile card | card "Hoàn lại" ẩn khi ≤ 0; số total "Tạm ứng quyết toán" = chi + hoàn vẫn đúng |
| Chi tiết phiếu `/settlements/:id` | balance "Chênh lệch sau quyết toán 0 ₫"; nếu chưa quyết đủ (balance < 0) → "Thiếu (phải bổ sung)" đỏ + notice "Quyết toán tạm ứng: Công ty thanh toán hoàn ứng" |
| Phiếu in/Xuất Excel (BE render) | "Thiếu (phải bổ sung)" khi balance âm; phiếu cân đối ⇒ balance 0 |
| Ops `/my-settlements` (list) | "Hoàn lại" chỉ khi > 0 — số âm xem ở chi tiết phiếu |
| Form tạo phiếu Ops | ô "Tiền hoàn lại" nhận số âm (đã bỏ `min=0` theo FB-100); banner "Chênh lệch" khi chưa cân |

## 4. Bằng chứng đợt chạy 21/10 (PT-2610-0009, settlement #2212)

- `e2e-driver.log` — 20 PASS / 0 FAIL.
- `ui-07-admin-summary-am.png` — dòng phiếu: `Hoàn lại -50.000 ₫`.
- `ui-08-after-duyet.png` — `Đã duyệt (KT): Nguyễn Thị Mai` sau click.
- `db-proof.txt` — `refund_amount=-50000`, `checked_by=3`; ledger
  `OPS_ADVANCE` credit 100.000 / `OPS_SETTLEMENT` debit 100.000; treasury OUT
  100.000 POSTED.
- Unit: `backend/src/tests/hoanung-am-signed-refund.test.ts` (5 PASS);
  be-tsc 0; scoped BE tests 9/9 (`be-tsc.log`, `be-tests-scoped.log`).

## 5. §9 — Verification coverage

| Claim / bug | Rung | Evidence | Not covered |
|---|---|---|---|
| Hoàn ứng âm (−50k) tạo được, cân đối, đúng tiền | UI DRIVEN | e2e-driver.log, db-proof.txt (ledger/treasury), probe-result.json | staging env |
| Hiển thị "Hoàn lại -50.000 ₫" kế toán desktop | UI DRIVEN | ui-07-admin-summary-am.png + DOM text assert trong log | 390/768 viewport cho strip này |
| Kế toán DUYỆT phiếu âm + double-guard 409 | UI DRIVEN | ui-08-after-duyet.png ("Đã duyệt (KT)"), DB checked_by=3, 409 body trong log | role ADMIN (đã test ACCOUNTANT) |
| Auto-offset bỏ qua khi chi vượt tạm ứng | DB/API VERIFIED | unlinked-expenses assert trong e2e-driver.log | n/a (logic skip pure) |
| Phiếu lệch (+50k) bị chặn cân đối | DB/API VERIFIED | 400 body trong e2e-driver.log | UI banner chênh lệch (đã có unit/FE test sẵn) |
| Mobile card ẩn "Hoàn lại" khi âm | CODE-READ ONLY | AdminAdvanceSettlementsPage.tsx (`refundAmount > 0`) | — hạn chế đã ghi, không chặn nghiệp vụ |
