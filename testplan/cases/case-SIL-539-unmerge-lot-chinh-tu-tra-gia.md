# SIL-539 (retry) — Hủy ghép: LÔ CHÍNH rời nhóm phải tự tra lại cước thu từ Bảng giá

- Ticket: SIL-539 (board SIL, id 604, reopen bởi QA Glint 27/10 — comment
  "❌ QA fail: 28/10/2026 build b27df702"). Fix trước (078a91e2, fix-601-604)
  chỉ chữa đường THÀNH VIÊN rời nhóm; đường LÔ CHÍNH rời nhóm vẫn lỗi.
- Surface: POST `/api/shipments/lcl/unmerge` (dimension REV) — bảng CUS
  /debit (DebitLotLclFacts "Hủy ghép") và bảng kế toán đọc cùng dữ liệu.

## Repro (fixture QA: R42RV-02 + R42RV-D2, REV, Xe 10T)

1. Ghép 2 lô (R42RV-D2 là Lô chính, class 10T — Lô chính giữ 100% cước thu
   nhóm theo lane của nó: route 10 × 10T = 3.100.000; member 0₫).
2. Hủy ghép — LÔ CHÍNH (R42RV-D2) rời nhóm.

## Expected

- 100% cước nhóm chuyển sang lô kế tiếp (R42RV-02 nhận 3.100.000) — luật cũ,
  giữ nguyên.
- Lô chính rời ra **tự tra lại cước thu từ Bảng giá theo lane của chính nó**
  (giữ Loại xe 10T + Tuyến route 10 + khách + ngày → 3.100.000), ghi qua
  channel chuẩn (trip financial state / snapshot), reason
  "Tách nhóm — tự tra bảng giá thu khách…". KHÔNG đứng ở 0₫/TRỐNG.
- Lane miss → citation "chờ định giá lại" (D02 — không bịa 0₫).
- Tiền OWN non-zero của lô khác không bị đụng (SIL-490 sweep giữ nguyên).

## Actual (fail trước fix retry)

- R42RV-D2 giữ Loại xe 10T nhưng Doanh thu về TRỐNG/API 0 — 100% cước đã
  chuyển sang R42RV-02, còn lô chính không được tra lại.

## Đường Tách nhóm CẢ NHÓM (không đổi, pin chống hồi quy)

- `unmergeLclGroup` (REV): tiền từng lô trở về ĐÚNG trạng thái trước ghép
  (`restoreRevPreMergeMoney`); loại xe NHÓM rời theo nhóm (FB-145 — owner
  law spec 23/10 §4.1, CUS chọn lại từng lô); toast [Hoàn tác] nhận lại class
  đã giải tán. QA end-state: 242 = 3.000.000, 244 = 3.100.000.

## Regression lock

- `backend/src/tests/unit/lcl-unmerge-revert-r39.test.ts` — source-scan pins:
  re-lookup chạy cho CẢ HAI vị trí leaver (member + lô chính), lô chính
  reload live-trip facts SAU promotion (facts cũ đang giữ 100% trước chuyển —
  guard own-money sẽ đọc nhầm), lane miss vẫn rơi citation chờ định giá lại,
  đường Tách nhóm cả nhóm không bị tiêm reprice (giữ restore + FB-145).

## Gates

- BE: `cd backend && npx tsc --noEmit` + `cd backend && pnpm test` (full).
- FE (không đổi code): scoped vitest debit + full vitest + `npx tsgo --noEmit`.
