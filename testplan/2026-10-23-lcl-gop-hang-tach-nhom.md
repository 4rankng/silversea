# Gộp hàng lẻ tách cost_group (ĐV) vs rev_group (CUS) — spec khách 23/10 (card 261023110000)

Nguồn: `kanban/TODO/261023110000-dieu-chinh-luong-gop-hang-le.docx` (đã đọc đủ
body + bảng). Ngày: 2026-10-23. Scope: CHỈ BE (shared schemas/services/routes/
tests) — FE grid/lane redesign là wave sau.

## Luật mới (spec 23/10)

1. **Tách biệt 2 nhóm**: `cost_group_id` (ĐV — trả nhà xe) và `rev_group_id`
   (CUS — thu khách) độc lập hoàn toàn; gộp ĐV không kéo CUS và ngược lại.
2. **Popup "Gán xe nhóm" ĐV = đúng 4 trường**: Loại xe tính cước trả ĐV
   (tấn/cont; xe tải ⇒ chỉ nhà xe ngoài, cont ⇒ nội bộ/ngoài) · Nhà xe ·
   BKS thực · Cước trả ĐVVC (blank = auto tra bảng giá trả nhà xe; nhập tay =
   override, phải sống tới khi phát lệnh tạo chuyến). XÓA BKS-báo-khách-ảo
   khỏi flow ĐV (giữ ở CUS). API gán nhóm ĐV THÊM/SỬA theo 4 trường này.
3. **ĐV money**: Lô 1 = 100% cước trả ĐVVC, Lô 2..N = 0₫ (luật hiện có — giữ).
4. **CUS per-lot outputs** (mặc định mỗi lô 1 chuyến — ruling 21/10 vẫn là
   DEFAULT): Loại xe thu khách · Giá cước thu khách (auto tra bảng giá theo
   loại + ngày; nhập tay override) · BKS báo khách (text/danh mục; BLANK =
   lấy BKS thực ĐV đã gán — in lên Debit Note).
5. **Gộp CUS (rev_group)**: chỉ cùng 1 khách hàng (khác KH ⇒ 400 lỗi rõ);
   nhóm nhận Loại xe thu nhóm + BKS báo khách chung + Cước thu Lô 1 (blank =
   auto, nhập tay = override); Lô 1 = 100% thu, Lô 2..N = 0₫ + tag
   "Ghép thu cước cùng Lô 1" (field/tag trên API); API tách nhóm (1 lô về
   riêng) có sẵn — money law của nhóm gộp chủ động = luật FB-093 (100/0):
   tách cả nhóm ⇒ tiền về pre-merge; tách Lô 1 ⇒ chuyển 100% cho Lô kế;
   tách thành viên ⇒ giữ 0₫ + lý do chờ định giá lại.

Ruling kèm theo (brief, đã ghi PRD lane docs): **21/10 (thu per-lot đơn
giá×SL) vẫn là DEFAULT** (mỗi lô = 1 chuyến, chưa gộp); **100/0 CHỈ trong
nhóm CUS gộp chủ động**.

## Case regression

|Case ID|Bước tái hiện|Kỳ vọng|
|---|---|---|
|LCL2310-01 (2 nhóm độc lập)|Gán xe nhóm ĐV cho N lô; soi cột rev_* của các lô; Ghép cước thu khách cho N lô; soi cột cost_* + BKS thực|ĐV gán chỉ đụng cost_group_id/order, costVehicleClassId, actualTruckNo, cước trả (Lô 1 + zero members) — rev_* và BKS-báo-khách GIỮ NGUYÊN. CUS gộp chỉ đụng rev_group_id/order, revVehicleClassId, cước thu, BKS báo khách (khi nhập) — cost_* + actualTruckNo GIỮ NGUYÊN.|
|LCL2310-02 (validation cùng KH)|Ghép cước thu khách với 2 lô khác customerId|400, message rõ "Chỉ cho phép ghép các lô của cùng một khách hàng…" kèm lô + KH xung đột.|
|LCL2310-03 (BKS fallback)|Lô LCL có BKS thực (ĐV gán), CUS để trống BKS báo khách → in Debit Note / bản nháp|Bản in lấy BKS thực; có BKS báo khách ⇒ in BKS báo khách. FCL giữ luật cũ (không in BKS thực).|
|LCL2310-04 (auto-tra vs override)|Gán xe nhóm ĐV để trống Cước trả ĐVVC → auto bảng giá nhà xe; nhập tay → giá nhập tay thắng, sống tới phát lệnh. CUS per-lot / Ghép nhóm: để trống Cước thu → auto bảng giá KH; nhập tay → override|Manual thắng auto ở cả hai chiều; blank ⇒ tra bảng giá (trả nhà xe: tuyến × loại xe × nhà xe; thu KH: KH × tuyến × loại xe × ngày). Thiếu bảng giá ⇒ không bịa 0₫.|
|LCL2310-05 (100/0 từng nhóm)|Gán xe nhóm N lô (ĐV); Ghép cước thu khách N lô (CUS)|ĐV: Lô 1 giữ 100% cước trả, Lô 2..N = 0₫. CUS: Lô 1 = 100% cước thu nhóm, Lô 2..N = 0₫ + tag "Ghép thu cước cùng Lô 1" (field trên API + stamp).|
|LCL2310-06 (tách nhóm)|Tách 1 lô khỏi rev group (unmerge 1 lô); tách Lô 1; tách cả nhóm|unmerge 1 lô về riêng (rev_group_id null, nhóm còn lại renumber/dissolve đúng); Lô 1 rời ⇒ 100% chuyển cho Lô kế (nhóm không về 0₫); tách cả nhóm ⇒ tiền về pre-merge. Chiều ĐV giữ luật promote cũ.|

Bổ sung (contract của API ĐV mới): `POST /api/shipments/lcl/cost-group/update`
(SỬA 4 trường của nhóm ĐV đã có) — money re-apply đúng luật Lô 1/0₫.

## Test map

- `backend/src/tests/unit/lcl-gop-hang-split-law.test.ts` — LCL2310-01 (patch
  builders), -02 (assertSameRevCustomer), -03 (effectiveBillingPlate), schema
  contract (ĐV 4 trường, không còn BKS-báo-khách; rev tag constant).
- `backend/src/tests/unit/lcl-gop-hang-money-wiring.test.ts` — LCL2310-04/-05
  (wiring pins money law 2 chiều) + LCL2310-06 (restore/promote/restate).
