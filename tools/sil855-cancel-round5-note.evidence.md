# SIL-855 runbook evidence — cancel+reissue đợt chốt round 5 trên STAGING

Ngày chạy: 2026-11-23 · Staging build: **1aec2e01** (`BUILD_HASH` container backend `/opt/vantai`, image `ghcr.io/4rankng/transting-backend:latest`)
Script: `tools/sil855-cancel-round5-note.mjs` · Chạy bởi: lane SIL-855 runbook (data-only, không deploy, không sửa code app)

Mục tiêu: note Debit lệch sổ của đợt chốt id=5 (QA round 5 tạo trên build 6bcc081e — [Lưu] đẩy nửa tiền 4.268.160/8.536.320 ₫) phải được **hủy governed** qua lifecycle (commit 5d42086a "Repair lever") để cùng selection phát hành lại đủ tiền.

## Lệnh chạy (không mở port, không lộ token)

```bash
ssh root@vantai.tingting.vip "cd /opt/vantai && docker compose -f deploy/docker-compose.prod.yml exec -T backend node --input-type=module" \
  < tools/sil855-cancel-round5-note.mjs
# Dry-run (chỉ guard + read): thêm -e SIL855_DRY_RUN=1 vào docker compose exec
```

Script chạy **bên trong container BE staging** (`/opt/vantai`, project compose `deploy`), gọi thẳng service governed `transitionDebitNoteStatus` (cùng code đường route `POST /api/finance/billing-documents/:id/cancel`): không UPDATE/DELETE row trực tiếp, không đụng stack prod (`silversea` @ silversea.tingting.vip — DB `silversea`; staging DB = `vantai`).

## BEFORE — verbatim (recon SQL read-only qua container postgres staging)

```
════ 1. debit_settlement_rounds (id=5 + any round_no=5) ════
5|1|THU|1|2027-05|7904000|8|OWN|2027-04-20|2027-04-21|2026-11-23 01:44:17.675836+00
════ 2. round 5 lots ════
800|SHP-2611-00306|
801|SHP-2611-00307|
════ 3. billing docs touching round 5 (column OR lots-join) ════
26|DEBIT_NOTE|SENT|5|3952000|316160|4268160|1||2026-11-23 01:49:36.340444|f
════ 4. LIVE note claims on round-5 lots ════
28|26|800||
29|26|801||
════ 5. trip claims + recoverable claims on those docs ════
(0 dòng — không có claim trip/recoverable)
════ 6. active cost locks on round-5 lots (snapshot money fields) ════
800|SHP-2611-00306|65|t|3952000|3952000|2026-11-23 01:41:58.931688+00
801|SHP-2611-00307|64|t|||2026-11-23 01:41:58.352432+00
```

Đọc: đợt id=5 ghi sổ 7.904.000 + VAT 8% = **8.536.320 ₫**; note lệch = **billing_documents #26** (SENT, settlement_round_id=5, net 3.952.000 + tax 316.160 = **4.268.160 ₫**, còn LIVE, chưa soft-delete); claims #28/#29 chưa nhả; lô 801 (SHP-2611-00307) freeze **null freight** — nguyên nhân gốc nửa tiền (R3P-677-C shape).

## DRY-RUN — verbatim (SIL855_DRY_RUN=1, không mutation)

```
[sil855] DRY-RUN mode: guards + reads only, no cancel.
[sil855] G1 round row: {"id":5,"customerId":1,"direction":"THU","roundNo":1,"periodKey":"2027-05","amount":"7904000","vatRate":8}
[sil855] G1 money law OK: đợt 7904000 + VAT 8% = 8536320 ₫ (assertRoundIssuanceTotals passed)
[sil855] G3 round lots: [{"id":800,"code":"SHP-2611-00306"},{"id":801,"code":"SHP-2611-00307"}]
[sil855] G2 live mis-note row: {"id":26,"status":"SENT","settlementRoundId":5,"net":3952000,"tax":316160,"gross":4268160,"entityName":null,"createdAt":"2026-11-23T01:49:36.340Z","version":1}
[sil855] G3 live claims: [{"id":28,"documentId":26,"shipmentId":800},{"id":29,"documentId":26,"shipmentId":801}]
[sil855] G3 live trip claims: 0, live recoverable claims: 0 (cancel sẽ nhả nếu có)
[sil855] G4 actor: {"id":1,"username":"phuongnt","fullName":"Nguyễn Thị Phương"}
[sil855] DRY-RUN: would transitionDebitNoteStatus → CANCELED for doc #26 (skipped).
[sil855] V1 doc rows for round 5: [{"id":26,"status":"SENT","net":3952000,"tax":316160,"gross":4268160,"version":1,"deletedAt":null}]
[sil855] V2 all lot claims after: [{"id":28,"documentId":26,"shipmentId":800,"releasedAt":null,"releaseReason":null},{"id":29,"documentId":26,"shipmentId":801,"releasedAt":null,"releaseReason":null}]
[sil855] ❌ RUNBOOK INCOMPLETE — xem VERDICT.
EXIT=4   ← đúng thiết kế: pre-state chưa hủy
```

## RUN THẬT — verbatim

```
[sil855] G1 round row: {"id":5,"customerId":1,"direction":"THU","roundNo":1,"periodKey":"2027-05","amount":"7904000","vatRate":8}
[sil855] G1 money law OK: đợt 7904000 + VAT 8% = 8536320 ₫ (assertRoundIssuanceTotals passed)
[sil855] G3 round lots: [{"id":800,"code":"SHP-2611-00306"},{"id":801,"code":"SHP-2611-00307"}]
[sil855] G2 live mis-note row: {"id":26,"status":"SENT","settlementRoundId":5,"net":3952000,"tax":316160,"gross":4268160,"entityName":null,"createdAt":"2026-11-23T01:49:36.340Z","version":1}
[sil855] G3 live claims: [{"id":28,"documentId":26,"shipmentId":800},{"id":29,"documentId":26,"shipmentId":801}]
[sil855] G3 live trip claims: 0, live recoverable claims: 0 (cancel sẽ nhả nếu có)
[sil855] G4 actor: {"id":1,"username":"phuongnt","fullName":"Nguyễn Thị Phương"}
[sil855] A1 transitionDebitNoteStatus → CANCELED ...
[sil855] A1 transitioned: {"id":26,"status":"CANCELED","version":2,"updatedAt":"2026-11-23T06:28:00.368Z"}
[sil855] A2 invalidateReportCaches() done (route parity).
[sil855] V1 doc rows for round 5: [{"id":26,"status":"CANCELED","net":3952000,"tax":316160,"gross":4268160,"version":2,"deletedAt":null}]
[sil855] V2 all lot claims after: [{"id":28,"documentId":26,"shipmentId":800,"releasedAt":"2026-11-23T06:28:00.368Z","releaseReason":"DOCUMENT_CANCELED"},{"id":29,"documentId":26,"shipmentId":801,"releasedAt":"2026-11-23T06:28:00.368Z","releaseReason":"DOCUMENT_CANCELED"}]
[sil855] V4b active locks: [{"shipmentId":801,"lockId":64,"freightAuto":null,"receivableTotal":null},{"shipmentId":800,"lockId":65,"freightAuto":"3952000","receivableTotal":"3952000"}]
[sil855] VERDICT {
  "roundId": 5,
  "expectedRoundGross": 8536320,
  "moneyLawAssert": "assertRoundIssuanceTotals(7904000 + 8% = 8536320) passed at G1",
  "noteCanceledGoverned": true,
  "liveClaimsOnRoundLots": 0,
  "liveTripClaims": 0,
  "liveRecoverableClaims": 0,
  "billingDocumentIsLive_false": true,
  "reissueSelectionClear": true,
  "activeLocksOnRoundLots": 2,
  "previewOutcome": {
    "kind": "EXPECTED_PREVIEW_BLOCK",
    "statusCode": 409,
    "message": "Cước vận tải của lô SHP-2611-00307 chưa xác định trong bản khóa lô (đủ căn cứ định giá nhưng bảng giá không trả về giá, và không có cước nhập đè khi khóa). Không thể xuất Debit Note thiếu cước — hãy nhập cước thu khách (sửa trực tiếp ô Cước thu trên bảng Kiểm soát lô hàng) hoặc bổ sung bảng giá, mở khóa và khóa lại lô rồi xuất."
  }
}
[sil855] ✅ RUNBOOK OK — post-runbook state reached.
EXIT=0
```

## RE-RUN (idempotency proof) — verbatim

```
[sil855] IDEMPOTENT-NOOP: mis-note đã CANCELED trước đó (#26) — chạy lại post-verify.
[sil855] V1 doc rows for round 5: [{"id":26,"status":"CANCELED","net":3952000,"tax":316160,"gross":4268160,"version":2,"deletedAt":null}]
...
[sil855] ✅ RUNBOOK OK — post-runbook state reached.
EXIT=0
```

## Đối chiếu 4 điểm verify của brief

| Điểm | Kỳ vọng | Kết quả |
|---|---|---|
| (a) note lệch → CANCELED governed | lifecycle transition, không còn tính aggregate, nhả claim | #26 SENT→**CANCELED** (version 1→2, một tx của lifecycle); claims #28/#29 `releasedAt=06:28:00.368Z`, `releaseReason=DOCUMENT_CANCELED`; `billingDocumentIsLive` coi CANCELED = dead (verdict `billingDocumentIsLive_false: true`) |
| (b) selection phát hành lại | các lô issuable | `liveClaimsOnRoundLots: 0`, `reissueSelectionClear: true` — guard `assertLotsNotInIssuedDebitNote` cho selection {800,801} sẽ pass, không còn note LIVE nào giữ lô |
| (c) tổng đợt/assert khớp | 8.536.320 theo R6 QA | `assertRoundIssuanceTotals(7.904.000 + VAT 8% = 8.536.320)` PASS trên round id=5 ngay tại guard G1 (chạy lại post-run) |
| (d) state PASS không bị phá | lô vẫn 'Đã khóa', preview-block không đổi | `activeLocksOnRoundLots: 2` (lock #64, #65 vẫn active, không unlock); `getDebitNoteRoundPreview(5)` vẫn **409 preview-block** LOCK-miss lô SHP-2611-00307 — behavior R6 giữ nguyên |

## Trạng thái bàn giao cho QA (3 điểm còn lại của Muse QA)

Round 5 staging giờ ở post-runbook: note lệch **#26 CANCELED governed** (không còn trong aggregate Công nợ), claims đã nhả nên **unlock + khóa lại lô SHP-2611-00307 (nhập cước 3.952.000) giờ khả thi** (trước runbook `assertShipmentCostUnlocked` 409 vì lô đang nằm trong note LIVE), selection phát hành lại mở. QA re-test được: (1) money-law 409 mismatch, (2) tạo note mới đủ tiền 8.536.320 sau khi khóa lại đủ cước, (3) cancel-then-reissue (runbook này chính là cancel; re-issue qua [Lưu] preview như thường).

An toàn: script chỉ đụng note của round 5; mọi bảng khác (locks, rounds, lots) chỉ READ. Chạy trong container staging, DB `vantai`, không mở port mới, không token nào rời droplet.
