# SIL-964 — round-3: mã lô 18 ký tự vẫn tràn ô Lô ở 1440px (sau r2)

- **Ticket**: SIL-964 · QA FAIL 18/11 build 6bae7153 (= staging hiện hành, hoapt, 1440×900 thật, sidebar mở, tab LCL 40 lô): mã lô 18 ký tự `R4B-A14-EMPTY-8F29` tràn qua mép ô Lô −14px, đè 4px lên chữ "Lẻ · Trả:" (1/40 dòng). Root cause: r2 đo worst-case 16 ký tự (EGLV… = 114.9px); ở canvas 1142px track 14% chỉ còn dư đúng mức đó — mã 18 ký tự (~134px @12px) vẫn vượt.

## Fix (FE css + 1 span class — `AccountingDebitClosePage.css` + `.columns.tsx`)

1. **Lô track 14% → 16%** (≈183px ở canvas 1142) lấy −1% mỗi track từ hai track tiền 13% (Cước phải thu / Cước phải trả → 12% ≈137px). Mọi track tiền vẫn ≥10% (floor r1), tổng 100%; **không đụng** min-width 1136px, 9 cột, tick-collapse rule r2.
2. **Mã ≥17 ký tự render một cỡ chữ xuống (11px)**: `.debit-lot-code--long` (class set theo `code.length` trong `LotCodeSpan`, columns.tsx). 18 ký tự đo lại **126.4px** (so 137.9px @12px) — không ellipsis/clip, không đổi font family.

## Đo sau fix (driver thật, 1440×900, cả 2 sidebar × 2 tab, 100% dòng — 2026-11-19-sil964-measure.mjs)

| Kịch bản | Dòng | Tràn | minGap | scroll ngang | projectedGap(18 ký tự, hàng selectable) |
|---|---|---|---|---|---|
| 1440 mở · FCL | 16 | **0** | **+34.8px** | không (1440/1440) | **+23.3px** |
| 1440 mở · LCL | 16 | **0** | **+34.8px** | không | **+23.3px** |
| 1440 đóng · FCL | 16 | **0** | **+65.4px** | không | **+53.9px** |
| 1440 đóng · LCL | 16 | **0** | **+65.4px** | không | **+53.9px** |

- projectedGap18 = budget hàng selectable chặt nhất (gap+codeW=149.7px @mở) − 126.4px (mã 18 @11px, đo bằng canvas text-metrics với đúng font live — không đụng DOM trang). So QA −14px @14%: +22.8px (share) + ~11.5px (shrink) ≈ +20 … +23px — khớp.
- Local fixture chỉ có mã 15–16 ký tự (không có ≥17) nên `longFace=0` — đúng; việc áp class theo độ dài được pin ở test dưới.
- Screenshots + measure.json: `qa/2026-11-19_sil964/`. Driver: `testplan/qa/scripts/2026-11-19-sil964-measure.mjs`.

## Pins (giữ luật — update số, thêm assertion mới, không xóa)

- `AccountingDebitClosePage.sil701-date-column.styles.test.ts`: expectedShares [14,10,10,13,10,13,10,10,10] → **[16,10,10,12,10,12,10,10,10]** (cùng assertion nth-child↔key); test mới pin `.debit-lot-code--long { font-size: 11px }` + `LotCodeSpan` áp theo `length >= 17`. Tick-collapse pin r2 giữ nguyên.

## Gates

- FE scoped vitest (toàn bộ `src/pages/accounting/` + table-no-truncation + canvas-fit-polish + App.chot-debit-access): **32 files / 273 tests PASS** · FE `tsc -b` sạch (exit 0).
- Không regression: ô giá sửa được + tự lưu blur (sil805), lợi nhuận âm nền đỏ chữ trắng (sil771), công thức lợi nhuận — tất cả nằm trong 273 tests trên.
