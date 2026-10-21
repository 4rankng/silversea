# REQ-19 / TICKET-07 — Cước hàng lẻ gom nhiều lô theo tải trọng: depth audit + cargo-fit advisory — 2026-10-21

Doc khách (RẤT CAO): "Xây dựng thuật toán tính giá cước hàng lẻ dựa trên trọng
tải tấn của xe và loại container (20/40 feet) trong trường hợp 1 xe đi gom nhận
nhiều lô hàng lẻ cùng lúc."

## Verdict của audit

- **Luật tiền ĐÃ ĐÚNG theo DEV SPEC 2026-10-15 đã nghiệm thu** (không phải gap,
  không đổi): gom nhóm = Lô 1 chịu 100% giá chuyến của loại xe đã chọn (trả:
  manual > bảng giá nhà xe cascade riêng>chung; thu: bảng giá KH × tuyến × loại
  xe), Lô 2..N = 0₫ ("nhảy tiền" / "Ghép cước cùng Bill X"). KHÔNG phân bổ theo
  tỷ lệ kg/CBM — trọng tải tấn là khóa bảng giá, không phải hệ số phân bổ.
- **"Quy đổi cont 20/40"** = loại xe tính cước CONT20/CONT40 trong DM
  `vehicle_size_classes`; lô lẻ không có cột cont-type, không có (và spec không
  đòi) quy đổi CBM→20' equivalent.
- **GAP thật đã implement**: không surface nào cho biết hàng gom có vừa tải
  trọng loại xe đã chọn không → `assessLclCargoFit` (shared, pure) + BE stamp
  `cargoFit` trên response/audit của `POST /shipments/lcl/cost-group` + FE fit
  line trong dialog "Gán xe nhóm" (FITS/OVER/CONTAINER_CLASS/NO_WEIGHT/UNKNOWN).

## Regression cases

| ID | Case | Expected | Evidence |
|---|---|---|---|
| REQ19-C1 | 1 xe 5T gom 3 lô (1.500+1.500+2.000 kg): gán nhóm COST lớp 5T | 201; `cargoFit = {FITS, totalWeightKg 5000, tonnageKg 5000}`; Lô 1 cước trả = giá nhà xe (riêng thắng chung), Lô 2..N = 0₫ | probe REQ19-A1..A3 · shared unit `lcl-cargo-fit.test.ts` |
| REQ19-C2 | Ghép cước thu khách cùng 3 lô, lớp 5T | Lô 1 revenue = bảng giá KH 5T (AUTO), Lô 2..N = 0₫ + stamp "Ghép cước cùng Bill X"; Σ nhóm = đúng 1× giá KH | probe REQ19-A4..A7 |
| REQ19-C3 | Audit `SHIPMENT_LCL_COST_GROUP_ASSIGNED` | `payload.cargoFit` ghi đúng trạng thái fit | probe REQ19-A8 |
| REQ19-C4 | Σ 4.000 kg gán lớp 3.5T | Vẫn 201 (advisory không chặn); `cargoFit.status = OVER`; luật tiền không đổi (board-miss ⇒ Lô 1 giữ nguyên, không bịa 0₫) | probe REQ19-B1..B2 |
| REQ19-C5 | Dialog Gán xe nhóm hiện fit line | FITS "vừa tải"; OVER đỏ "VƯỢT TẢI TRỌNG" nhưng submit vẫn chạy; cont → nhắc đối chiếu CBM; thiếu kg → nhắc nhập | `AssignTruckGroupDialog.test.tsx` (REQ-19 describe, 4 test) |
| REQ19-C6 | Parse mã tải trọng | '1.25T'→1250 … '15T'→15000; CONT20/E5T…/rác → null (UNKNOWN_CLASS, không đoán) | shared unit |
| REQ19-C7 | BE wiring pin | service gọi assessor + trả/audit cargoFit (source scan, unit-only tree) | `backend/src/tests/unit/lcl-cargo-fit-wiring.test.ts` |

Chạy lại: `QA_API=http://localhost:<port>/api node qa/scripts/2026-10-21-req19-cuoc-lcl-group-freight-probe.mjs` (backend worktree, env-only port; DB ss-prod-db :5441; tự dọn fixture QA-REQ19-*).

## Phạm vi không đổi (non-goals)

- Không thay luật 100%/0₫ bằng phân bổ tỷ lệ (quyết định chủ sở hữu theo spec
  đã nghiệm thu — không mở lại không có chỉ thị mới).
- Không bịa dung tích cont 20/40 (không có số liệu chủ sở hữu) — CONTAINER_CLASS
  chỉ nhắc đối chiếu Σ CBM.
- Không thêm API chặn (advisory-only; không đổi contract ngoài field thêm vào).
