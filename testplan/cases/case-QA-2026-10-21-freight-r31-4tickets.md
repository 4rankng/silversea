# Case QA-2026-10-21-freight-r31 — 4 ticket FREIGHT R31 (cards 211026221618/1718/1818/1918)

Audit-first kết luận: backend engine/lifecycle/fuel CRUD **đã có sẵn**;
4 ticket QA đều là wiring/discoverability/defect import, không phải thiếu BE.

| Card | QA báo | Audit root cause |
|---|---|---|
| r31-freight-01 (211026221618) | THIẾU ĐỊNH MỨC DẦU | `fuel_consumption_norms` (D lít/km theo loại xe — đầu vào Step 3 của engine, PRD CuocPhiPhuPhiDau §4) **không có UI nào**; hub Cấu hình "Định mức nhiên liệu" trỏ sang bảng chi phí `/config/fuel` (fuel_config singleton) và `/config/fuel-norms` (fuel_norms tuyến×xe lit/100km — phía chi phí) |
| r31-freight-02 (211026221718) | KHÔNG UI BÁO GIÁ | `QuotationConfigPage` tồn tại, route `/config/quotations` (officeStaffOnly) nhưng **không nằm trong CONFIG_ITEMS hub** cũng như search registry → không thể phát hiện |
| r31-freight-03 (211026221818) | KHÔNG ENGINE TÍNH CƯỚC TỰ ĐỘNG | Engine + FreightPreviewCard (CUS create) + snapshot (ShipmentDetailPage) đều có và chạy; QA không thấy vì thiếu dữ liệu định mức (f01) + trang cấu hình ẩn (f02) + import báo giá 400 "không có định mức dầu" khi norms trống (quotation-import.service.ts:402) |
| r31-freight-04 (211026221918) | NEWEB LAG=0, PRD YÊU CẦU 1 NGÀY | Seed converges lag=1/confirmed đúng; nhưng **import Excel báo giá ghi đè terms mới** (`effectiveDate: today` > seed 2026-09-09) với `fuelLagDays: enriched.fuelLagDays ?? 0` + `fuelLagConfirmed: true` **bịa đặt** khi file không có ô "Lag Day n" → engine (chọn terms theo effectiveDate mới nhất ≤ ngày vận chuyển) dùng lag=0 áp ngay |

Ghi chú phạm vi (PRD ruling, không đổi hành vi): PhuongAnTinhCuocTuDong.md §5
cấm hàng đợi duyệt/nhãn "tự động duyệt" — nhãn hiện có AUTO/MANUAL là đúng
PRD ("tự tính khi đủ căn cứ; báo thiếu căn cứ khi thiếu"), KHÔNG thêm queue duyệt.

## Expected (sau fix)

| ID | Bước | Kỳ vọng |
|---|---|---|
| F01-R1 | Vào hub `/config` | Thấy card "Định mức dầu tính cước" (D lít/km theo loại xe) với số dòng hiện tại |
| F01-R2 | Mở `/config/fuel-consumption-norms` (ADMIN) | CRUD bảng định mức: chọn loại xe, nhập lít/km (>0), ngày hiệu lực, ghi chú; validate lỗi tiếng Việt theo trường |
| F01-R3 | Thiếu norm của hạng X (DB trống hạng đó) | freight-preview trả MANUAL "Không tìm thấy định mức dầu cho loại xe: X" (không báo 0 là đã tính) |
| F02-R1 | Vào hub `/config` | Thấy card "Báo giá" → `/config/quotations`, hiển thị số khung |
| F02-R2 | Tìm "báo giá" trong search | Trang xuất hiện trong kết quả cấu hình |
| F03-R1 | CUS tạo lô đủ customer+tuyến+loại xe+ngày (đủ dữ liệu giá) | FreightPreviewCard hiện công thức J/H/K tự tính (source AUTO) |
| F03-R2 | Sau khi lưu/chốt lô | ShipmentDetailPage hiện snapshot cước đã khóa + formula + override (nếu quyền) |
| F04-R1 | Import file báo giá KHÔNG có ô Lag Day, tuyến đã có terms lag=1 confirmed | Terms mới giữ lag=1 + confirmed (carry-forward), KHÔNG ghi 0/confirmed |
| F04-R2 | Import file CÓ ô Lag Day = n | Terms dùng n, confirmed=true (file khách là nguồn xác nhận) |
| F04-R3 | Tuyến chưa từng có terms, file không có lag | Terms mới lag=0 nhưng `fuelLagConfirmed=false` → engine đi nhánh surcharge-pending "độ trễ giá dầu chưa được xác nhận" (PRD §3.1: không tự dùng 0) |
| F04-R4 | Edge lag-before-first-period: NEWEB transport = ngày hiệu lực kỳ dầu đầu tiên (lag 1 → target trước kỳ đầu) | MANUAL fallback "Không tìm thấy kỳ giá dầu hiệu lực (kiểm tra số ngày trễ giá)" — không chặn intake |

## Fix

- BE `quotation-import.service.ts`: lag import resolve qua helper thuần
  `resolveImportedFuelLag` (file-lag nguyên ≥0 thắng + confirmed; thiếu hoặc
  không nguyên → carry-forward terms hiện hành; chưa từng có → 0 + NOT
  confirmed).
- FE: trang mới `FuelConsumptionNormsConfigPage` (`/config/fuel-consumption-norms`,
  adminOnly guard như sibling — ADMIN+MANAGER) + card hub "Định mức dầu tính
  cước" + card hub "Báo giá" + status count + search registry + pageCatalog/
  routes title.

## Lưu ý dữ liệu đã bị bẩn (F04-R1 trên môi trường đã dính bug)

Carry-forward trung thành với terms hiện hành: trên môi trường mà bản import
CŨ đã ghi đè `{lag 0, confirmed}` (như QA đã quan sát), bản import mới giữ
tiếp giá trị bẩn đó. Trước khi chạy lại F04-R1 ở môi trường đó, khôi phục
dòng terms NEWEB về `lag 1 / đã chốt` qua UI `/config/freight-rate-terms`
(hoặc nhập lại terms có ngày hiệu lực mới) — code không tự sửa dữ liệu hợp đồng
vì không biết lag thật của các tuyến ngoài NEWEB.
