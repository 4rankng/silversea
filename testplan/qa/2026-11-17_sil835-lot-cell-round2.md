# SIL-835 (id 964) — round-2: mã lô tràn ô LÔ trên lưới Chốt Debit (1440px)

- **Ticket**: SIL-835 · QA FAIL 00:02 SGT 17/11 build 0fcc040b (hoapt, 1440px sidebar mở, tab FCL 110 dòng): 70/110 dòng tràn ô LÔ, 42 dòng khe âm, tệ nhất −22px (STPKHHHPH26A071). Thành quả round-1 (9 cột, không cuộn ngang) giữ nguyên.

## Root cause (đo thật local, mã 16 ký tự — DÀI hơn mã QA 15)

- Lô track 10% = **114.2px** ở canvas 1142 (sidebar mở); sau padding 20px chỉ còn ~94px content.
- Dòng SELECTABLE có: tick slot 1.1em (~13px) + checkbox (~16px) + 2 gaps (8px) + mã **114.9px** (EGLV149607865113, 16 ký tự) → code kết thúc ở +164px so với mép trái cell → **khe −49.9px** (tệ hơn QA vì mã local dài hơn 1 ký tự; QA −22px với mã 15 ký tự + padding nhỏ hơn ở mép đo).
- Baseline đo trước fix: 16/16 dòng tràn (mọi mã ≥14 ký tự), minGap −49.9 (mở) / −29.9 (đóng). Không cuộn ngang (1440/1440) — AC1 giữ nguyên từ round-1.

## Fix (chỉ FE css — AccountingDebitClosePage.css)

1. **Lô track 10% → 14%** (≈160px ở canvas 1142): đo thật chứa checkbox-stack + mã 16 ký tự với khe ≥ +13px. Fund −1% mỗi track: Cước phải thu 14→13, Cước phải trả 14→13, Tổng trả & Chi phí ngoài 11→10, Ghi chú & Đối soát 11→10 — **mọi money track ≥10% (≈114px), giữ floor round-1**; Tổng trả/Ghi chú là ô wrap-text nên 10% an toàn.
2. **Tick slot nhường chỗ khi checkbox render**: `.debit-lot-ref:has(.debit-row-checkbox) .debit-row-tick { display: none; }` — checkbox CHÍNH là pick marker; giữ cả hai đánh thuế kép ~17px chính là ngân sách gây tràn. Vị trí mã ổn định trên mọi dòng selectable (khôngshift theo từng dòng).

Không dùng overflow:hidden/clip/ellipsis; không đổi font; fixed-sum/min-width floor 1136px giữ nguyên (AC1 không đổi).

## Đo sau fix (driver thật, 1440×900, cả 2 sidebar, cả 2 tab — 100% dòng mỗi kịch bản)

| Kịch bản | Dòng | Tràn | minGap | scroll ngang |
|---|---|---|---|---|
| 1440 mở · FCL | 16 | **0** | **+13px** | không (1440/1440) |
| 1440 mở · LCL | 16 | **0** | **+13px** | không |
| 1440 đóng · FCL | 16 | **0** | **+41px** | không |
| 1440 đóng · LCL | 16 | **0** | **+41px** | không |

Worst row: mã 16 ký tự 'JJCTCHPDY260334' (114.9px) — gap +13px (mở). Mã QA 15 ký tự ngắn hơn → khe lớn hơn. Screenshot: `qa/2026-11-17_sil835-round2/sil835-r2-{open,closed}-FCL.png` + https://bot.tingting.vip/tmpqa/sil835-r2-open-FCL.png · `sil835-r2-closed-FCL.png`. Đo JSON: `qa/2026-11-17_sil835-round2/measure.json`. Driver: `testplan/qa/scripts/2026-11-17-sil835-measure.mjs` (đo 100% dòng bằng Range.getBoundingClientRect đúng cách QA đo).

## Pins (giữ luật — update số theo đo mới, thêm assertion mới, không xóa)

- `AccountingDebitClosePage.sil701-date-column.styles.test.ts`: expectedShares [10,10,10,14,10,14,11,10,11] → **[14,10,10,13,10,13,10,10,10]** (cùng assertion nth-child↔key mapping) + test mới pin rule tick-collapse `:has(.debit-row-checkbox)`.

## Gates

- FE scoped vitest: 11 files AccountingDebitClosePage + table-no-truncation + canvas-fit-polish — **95/95 PASS** · FE `tsc -b` sạch.
- Lưu ý: số dòng local (16) < staging (110) — bù lại mã local 16 ký tự > mã QA 15 ký tự (worst-case phủ), và measurement là per-row trên mọi dòng nên tỉ lệ không ảnh hưởng kết luận gap ≥ 0.
