# SIL-1102 — Phiếu thu ghi ngày cũ không vào báo cáo thu theo ngày (khoản lái xe khai)

Ngày: 2026-11-27 · K2.124 / KB §2.4.8 · r43a GLM

## Tái hiện firsthand (staging, build 23a8fa17 — ĐÃ chứa fix as-of wave5 cd9680e8+89884f71)

- Fixture thật: chuyến 204 (departure **20/12/2026**), khoản lái xe khai
  DRIVER_SHIPMENT 300.000₫ (nguồn `expense_accounting_sources` id 227,
  source_kind **DRIVER**), phiếu thu `CP-1-IN-PHOI-PHIEU-OPS:1-204`
  (300.000₫, movement value_date **10/11/2026**, RECORDED).
- `GET /phoi-phieu/report?kind=THU` với khoảng chứa 10/11 → **0₫ ở mọi ngày**.

## Root cause (hai coupling)

1. `reportSources` chỉ đọc `sourceKind = 'OPS'` — nguồn DRIVER (khoản lái xe
   khai thu khách, đúng nguồn phiếu thu SIL-1099 lập được) không bao giờ vào
   báo cáo: phải thu lẫn đã thu đều 0.
2. Tiền ĐÃ THU bị chặn theo cửa sổ `departureDate` của chuyến — phiếu ngày giá
   trị 10/11 trên chuyến 20/12 không thuộc cửa sổ nào chứa 10/11. Luật mong
   đợi (K2.124): báo cáo thu tính đến ngày X gồm MỌI phiếu có valueDate ≤ X;
   đảo phiếu ghi đúng ngày đảo, không xóa dấu vết phiếu gốc.

## Sửa (BE, phoi-phieu-control.service.ts)

- `reportSources(kind, …)`: THU đọc thêm nguồn DRIVER RECORDED + đã duyệt,
  group DRIVER_SHIPMENT (predicate board/phiếu lockstep); phải thu = số thu
  khách (`customer_charge_amount`), bucket PS khác; TRA giữ OPS-only.
- Tiền ĐÃ THU/TRẢ thành cash THEO ĐỐI TƯỢNG as-of ngày chốt
  (`reportCashRowsAsOf`): allocation đếm khi movement valueDate ≤ chốt và
  voucher RECORDED, hoặc REVERSED với đảo SAU chốt (luật đảo của expense
  reads). Scope kế toán vẫn chặn (SELF/UNASSIGNED không leak), cửa sổ departure
  KHÔNG chặn tiền. Cash-only party tự tạo dòng (phải 0 + đã thu X — trả trước,
  con lại âm = over-pay annotation sẵn có của FE).
- XLSX export/report expense-accounting asOfDate: đã cùng luật từ wave5
  (`loadExpenseAccountingEntries` as-of + phoi-phieu party-lots AsOfBatch) —
  không đụng.

| # | Trường hợp kiểm | Kết quả mong đợi |
|---|---|---|
| R1 | Phiếu valueDate 10/11 (chuyến departure 20/12, nguồn DRIVER) tại chốt 10/11 | Dòng khách hiện, ĐÃ THU 300.000, phải trong cửa sổ 0, con lại −300.000 (trả trước) |
| R2 | Cửa sổ departure 20/12 | Khoán lái xe khai vào PHẢI THU (PS khác) 300.000; ĐÃ THU 300.000 (phiếu 10/11 ≤ chốt); còn lại 0; số lượng 1 |
| R3 | Đảo phiếu ngày 26/11 | Chốt 15/11 vẫn 300.000 (đảo sau chốt không viết lại); chốt 30/11 về 0; cửa sổ 20/12 còn phải thu đủ 300.000 |

## Bằng chứng

- Integration `sil1102-thu-report-driver-asof.test.ts` 3/3 — RED trước sửa:
  báo cáo trả 0 dòng ở mọi chốt (đúng triệu chứng owner).
- Regression phoi-phieu integration family (card170, party-lots, own-fleet,
  tiền-đường separation, unattached-trips window, sil1099, sil1102-as-of,
  historical-reporting-as-of): tất cả xanh (qa log).
- FE cluster report-section/reports/PartyMonthlyProductionSummary/Dialogs/
  WorkInbox: 62/62.
