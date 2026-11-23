# SIL-855 runbook evidence — RE-POST round 5 (unlock → khóa lại → phát hành lại) trên STAGING

Ngày chạy: 2026-11-23 · Staging build: **1aec2e01** (`/opt/vantai`, DB `vantai`, buildHash khớp origin/main HEAD tại thời điểm chạy code-fix)
Script: `tools/sil855-reissue-round5.mjs` (bắt buộc chạy SAU `tools/sil855-cancel-round5-note.mjs` — note nửa tiền #26 đã CANCELED governed ở commit 293e932d)

**Kết luận RE-POST vs CORRECTION cho khoản lệch 4.268.160 ₫ (round id 5, R3P-677-A/C): RE-POST (hủy + phát hành lại).**
Lý do không chọn CORRECTION (luồng điều chỉnh nguồn `DEBIT_NOTE_ADJUSTMENT`): luồng này tự tính chênh lệch từ snapshot khóa lô — snapshot của SHP-2611-00307 (lô 801) froze `freightAuto/receivableTotal` **null** → diff = 0 → 409 "Không có chênh lệch nguồn"; đồng thời note đã SENT không xóa được (delete chỉ nhận DRAFT). RE-POST khả thi vì cancel governed đã nhả claim lô + fix 5d42086a làm freeze đọc ghi đè cước SIL-805 khi khóa lại.

## Lệnh chạy

```bash
ssh root@vantai.tingting.vip "cd /opt/vantai && docker compose -f deploy/docker-compose.prod.yml exec -T backend node --input-type=module" \
  < tools/sil855-reissue-round5.mjs
# Dry-run: thêm -e SIL855_DRY_RUN=1 vào docker compose exec
```

## DRY-RUN — verbatim (chỉ guard + read, không mutation)

```
[sil855] G1 money law OK: đợt 7904000 + VAT 8% = 8536320 ₫
[sil855] G2 round lots: [{"id":800,"code":"SHP-2611-00306"},{"id":801,"code":"SHP-2611-00307"}]
[sil855] G2 doc rows for round 5: [{"id":26,"status":"CANCELED","net":3952000,"tax":316160,"gross":4268160,"deletedAt":null}]
[sil855] G3 cuoc-thu override rows (containerId null): [{"shipmentId":801,"cuocThu":"3952000"}]
[sil855] G4 actor: {"id":1,"username":"phuongnt","fullName":"Nguyễn Thị Phương"}
[sil855] V0 books baseline: Tổng LIVE DEBIT_NOTE gross = 52040480 ₫ (sau cancel note nửa tiền)
[sil855] A0 active locks pre-run: [{"shipmentId":801,"lockId":64,"freightAuto":null,"receivableTotal":null},{"shipmentId":800,"lockId":65,"freightAuto":3952000,"receivableTotal":3952000}]
[sil855] A1 lô 800: lock active + snapshot đủ cước 3952000 ₫ — skip unlock/relock.
[sil855] A1 lô 801: DRY-RUN — would unlock (lock 64, frozen null) → relock.
[sil855] A2 active locks post-run: [{"shipmentId":801,"lockId":64,"freightAuto":null,"receivableTotal":null},{"shipmentId":800,"lockId":65,"freightAuto":3952000,"receivableTotal":3952000}]
[sil855] A3 preview BLOCKED: {"kind":"BLOCKED","message":"Cước vận tải của lô SHP-2611-00307 chưa xác định trong bản khóa lô (đủ căn cứ định giá nhưng bảng giá không trả về giá, và không có cước nhập đè khi khóa). …"}
[sil855] V3 books after: Tổng LIVE DEBIT_NOTE gross = 52040480 ₫ (delta +0 ₫ so với baseline)
EXIT=4 (đúng thiết kế: pre-state chưa sửa)
```

## RUN THẬT lần 1 — verbatim

```
[sil855] V0 books baseline: Tổng LIVE DEBIT_NOTE gross = 52040480 ₫ (sau cancel note nửa tiền)
[sil855] A0 active locks pre-run: [{"shipmentId":801,"lockId":64,"freightAuto":null,"receivableTotal":null},{"shipmentId":800,"lockId":65,"freightAuto":3952000,"receivableTotal":3952000}]
[sil855] A1 lô 800: lock active + snapshot đủ cước 3952000 ₫ — skip unlock/relock.
[sil855] A1 lô 801: unlocked lock #64 tại 2026-11-23T07:11:54.140Z
[sil855] A1 lô 801: relocked #66 bởi Nguyễn Thị Phương
[sil855] A2 active locks post-run: [{"shipmentId":800,"lockId":65,"freightAuto":3952000,"receivableTotal":3952000},{"shipmentId":801,"lockId":66,"freightAuto":3952000,"receivableTotal":3952000}]
[sil855] A3 preview OK: {"kind":"OK","items":[{"shipmentId":800,"net":3952000},{"shipmentId":801,"net":3952000}],"totals":{"net":7904000,"tax":632320,"gross":8536320}}
ApiError 409: Khóa giao dịch này thuộc về người thực hiện khác — vui lòng dùng mã giao dịch mới. (idempotency_key=consolidated:1:3dec34c48963527dab5a61c25318b83a3a15b22a)
```

Ghi chú lần 1: unlock+relock+preview thành công; A4 bị chặn bởi guard actor-collision của idempotency (key derived `consolidated:<customerId>:<hash(selection)>` thuộc actor gốc đã [Lưu] — QA round 5). Đường governed đúng: script dùng **creator của note nửa tiền** làm actor → replay record cũ → nhánh stale-replay SIL-727 phát hành lại trong transaction mới. Script đã sửa G4 (chọn createdBy của note đã CANCELED, fallback ADMIN) — sửa này nằm trong script, không đụng data.

## RUN THẬT lần 2 (sau fix G4) — verbatim

```
[sil855] G2 doc rows for round 5: [{"id":26,"status":"CANCELED","net":3952000,"tax":316160,"gross":4268160,"deletedAt":null}]
[sil855] G3 cuoc-thu override rows (containerId null): [{"shipmentId":801,"cuocThu":"3952000"}]
[sil855] V0 books baseline: Tổng LIVE DEBIT_NOTE gross = 52040480 ₫ (sau cancel note nửa tiền)
[sil855] A2 active locks post-run: [{"shipmentId":800,"lockId":65,"freightAuto":3952000,"receivableTotal":3952000},{"shipmentId":801,"lockId":66,"freightAuto":3952000,"receivableTotal":3952000}]
[sil855] A3 preview OK: {"kind":"OK","items":[{"shipmentId":800,"net":3952000},{"shipmentId":801,"net":3952000}],"totals":{"net":7904000,"tax":632320,"gross":8536320}}
[sil855] A4 issued: {"id":27,"totalNet":7904000,"totalTax":632320,"totalGross":8536320}
[sil855] A4 invalidateReportCaches() done (route parity).
[sil855] V1 doc rows for round 5: [{"id":26,"status":"CANCELED","net":3952000,"tax":316160,"gross":4268160},{"id":27,"status":"SENT","net":7904000,"tax":632320,"gross":8536320}]
[sil855] V2 all lot claims: [{"id":28,"documentId":26,"shipmentId":800,"releasedAt":"2026-11-23T06:28:00.368Z","releaseReason":"DOCUMENT_CANCELED"},{"id":29,"documentId":26,"shipmentId":801,"releasedAt":"2026-11-23T06:28:00.368Z","releaseReason":"DOCUMENT_CANCELED"},{"id":30,"documentId":27,"shipmentId":800,"releasedAt":null,"releaseReason":null},{"id":31,"documentId":27,"shipmentId":801,"releasedAt":null,"releaseReason":null}]
[sil855] V3 books after: Tổng LIVE DEBIT_NOTE gross = 60576800 ₫ (delta +8536320 ₫ so với baseline)
[sil855] VERDICT {
  "roundId": 5,
  "expectedRoundGross": 8536320,
  "canceledHalfNote": [26],
  "fullLiveNoteId": 27,
  "fullLiveNoteGross": 8536320,
  "liveClaimsOnRoundLots": [{"shipmentId":800,"documentId":27},{"shipmentId":801,"documentId":27}],
  "activeLocksFrozenFull": true,
  "previewOutcome": "OK",
  "booksBefore": 52040480,
  "booksAfter": 60576800,
  "booksDelta": 8536320
}
[sil855] ✅ RUNBOOK OK — round 5 RE-POST hoàn tất: note ≡ đợt 8.536.320 ₫.
EXIT=0
```

## RE-RUN (idempotency proof) — verbatim

```
[sil855] A2 active locks post-run: [{"shipmentId":800,"lockId":65,"freightAuto":3952000,"receivableTotal":3952000},{"shipmentId":801,"lockId":66,"freightAuto":3952000,"receivableTotal":3952000}]
[sil855] A3 preview OK: {"kind":"OK","items":[{"shipmentId":800,"net":3952000},{"shipmentId":801,"net":3952000}],"totals":{"net":7904000,"tax":632320,"gross":8536320}}
[sil855] A4 IDEMPOTENT-NOOP: note LIVE đủ tiền đã tồn tại — skip issue.
[sil855] V1 doc rows for round 5: [{"id":26,"status":"CANCELED","net":3952000,"tax":316160,"gross":4268160},{"id":27,"status":"SENT","net":7904000,"tax":632320,"gross":8536320}]
[sil855] V3 books after: Tổng LIVE DEBIT_NOTE gross = 60576800 ₫ (delta +0 ₫ so với baseline)
[sil855] ✅ RUNBOOK OK — round 5 RE-POST hoàn tất: note ≡ đợt 8.536.320 ₫.
EXIT=0
```

## Đối chiếu trước/sau (số liệu verbatim)

| Chỉ tiêu | Trước runbook (sau cancel #26) | Sau RE-POST | Đối chiếu |
|---|---|---|---|
| billing_documents round 5 | #26 CANCELED 4.268.160 (còn 0 note LIVE) | #26 CANCELED + **#27 SENT 7.904.000 + VAT 632.320 = 8.536.320** | note mới ≡ đợt (amount 7.904.000, vatRate 8) — assertRoundIssuanceTotals PASS trong issueInTx |
| Claims lô 800/801 | 0 (đã nhả) | #30/#31 → note #27 LIVE | một note duy nhất giữ claim |
| Freeze snapshot lô 801 | lock #64: freightAuto **null**, receivableTotal **null** | lock #66: freightAuto **3.952.000**, receivableTotal **3.952.000** | freeze 5d42086a đọc ghi đè SIL-805 khi khóa lại |
| Freeze snapshot lô 800 | lock #65: 3.952.000 / 3.952.000 | lock #65: 3.952.000 / 3.952.000 | không đụng |
| Preview [Xuất Debit Note] round 5 | 409 LOCK-miss (thiếu cước lô 801) | OK: 2 lô × 3.952.000; footer 7.904.000 / 632.320 / 8.536.320 | đúng 4 dòng tổng QA kỳ vọng |
| Tổng LIVE DEBIT_NOTE gross (books measure của script) | 52.040.480 ₫ | **60.576.800 ₫** | delta đúng +8.536.320 ₫ — đủ so với round 5, không double-count (#26 CANCELED loại khỏi aggregate) |

## Trạng thái bàn giao cho QA

Round 5 staging giờ SẠCH SỔ: note lệch #26 CANCELED governed, note đủ tiền #27 SENT ≡ đợt, cả 2 lô 'Đã khóa' với snapshot đủ cước. Ba điểm còn lại của Muse QA re-test được trực tiếp trên UI: (1) preview/[Lưu] round 5 hiển thị đủ 2×3.952.000, footer 8.536.320 (note đã tồn tại — re-preview chỉ đọc); (2) money-law 409 khi tổng lệch (cần đợt/lô probe mới để tái hiện shape lệch); (3) cancel-then-reissue đã được chính runbook này thực thi governed end-to-end (#26 → #27).

An toàn: script chỉ unlock/khóa lại/phát hành cho đúng 2 lô của round 5 qua service governed (unlock/relock có audit reason/note, phát hành qua createConsolidatedDebitNote có money-law assert + idempotency); chạy trong container staging, DB `vantai`, không mở port, không token rời droplet, không đụng stack prod (`silversea`).
