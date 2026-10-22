# Case QA-2026-10-22-quote-engine — R32 "không engine" + lag khung giá (BaoGia.md/CuocPhiPhuPhiDau.md)

QA R32 báo "không engine tính cước tự động" khi tạo lô có khung giá. Audit
(worktree feat-quote-engine-wiring, base cae84f8d): wiring snapshot đã có
từ R31; thiếu (1) lag là thuộc tính khung giá (BaoGia §2 "độ trễ áp giá dầu
(lag)"), (2) endpoint QA verify engine không cần tạo lô, (3) test pin công
thức + căn cứ lock theo số liệu NEWEB.

## Expected (sau fix)

| ID | Bước | Kỳ vọng |
|---|---|---|
| QE-R1 | POST /api/quotations/preview-rate đủ căn cứ: Long Minh, NEWEB, CONT40, ngày ≥ 2026-07-19 (lag 1 → target ≥ 07-18) | source AUTO; E=91 lít; J=4.182.000; H=889.744 (G=27.620 > F=17.842,5926); K=5.071.744 — khớp bảng CuocPhiPhuPhiDau §6.1; payload kèm nguồn frame (id khung, tên, effectiveDate, lag) |
| QE-R2 | preview-rate thiếu căn cứ: tuyến chưa có điều khoản (routeId lệch) | source MANUAL, J/H/K = 0, formula nêu "Không tìm thấy điều khoản cước… — cần nhập tay giá cước"; KHÔNG bịa số |
| QE-R3 | preview-rate NEWEB nhưng target date trước kỳ dầu đầu (ngày 2026-07-11, lag khung 1) | MANUAL "Không tìm thấy kỳ giá dầu hiệu lực…"; engine không áp kỳ sai |
| QE-R4 | Khung giá có fuelPriceLagDays=71, NEWEB, ngày 2026-09-20 (target 07-11 → G=21.740, H=354.664) so với lag=1 (target 09-19 → G=27.620, H=889.744) | H đổi đúng theo lag khung: lag áp vào ngày tra giá (ngày giao − lag) |
| QE-R5 | Tạo/sửa khung giá qua UI: dialog tạo + strip "Thông tin khung" | fuelPriceLagDays hiển thị, sửa được, integer ≥ 0, default 1; lưu giữ giá trị |
| QE-R6 | Tạo lô FCL đủ căn cứ (khách+tuyến+cont+ngày hẹn) | snapshot AUTO đính lô (wiring có sẵn — pin bằng test + không hồi quy) |
| QE-R7 | Lô thiếu căn cứ (không rate key: LCL mới tạo chưa phát lệnh) | KHÔNG có snapshot bịa; lock chờ đến dispatch (rate key điều vận) hoặc MANUAL fallback khi engine thiếu dữ liệu giá — không chặn intake |
| QE-R8 | Công thức unit (NEWEB CONT40, 91 lít) | G=16.000 (≤F) → H=0, K=J=4.182.000; G=27.620 → H=889.744; G=21.740 → H=354.664 — đúng §2.5/§6.1/§6.2 |

## Repro / evidence

- curl 2 case (QE-R1 + QE-R2) kèm NEWEB số liệu → `qa/2026-10-22-quote-engine/`.
- BE unit: `backend/src/tests/unit/quote-engine-formula.test.ts`,
  `quote-engine-wiring.test.ts`, `freight-lot-basis.test.ts`.
- FE: QuotationConfigPage lag field tests.

## Ghi chú phạm vi

- LCL lock tại dispatch là contract đã duyệt (R31 audit + snapshot-lifecycle
  header); card này PIN hành vi đó, không đổi.
- Lag per-route terms vẫn là fallback khi khách chưa có khung giá hiệu lực
  (seed/imports cũ); khung giá (nếu có, effectiveDate ≤ ngày giao) THẮNG.
