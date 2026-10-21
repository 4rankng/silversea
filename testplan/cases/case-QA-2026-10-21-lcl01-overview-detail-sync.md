# Case QA-2026-10-21-lcl01-overview-detail-sync — lô LCL hiện Tổng quan nhưng mất ở Chi tiết

Card 211026132257 (lcl-01, PARTIAL từ trước — "detail sync chưa rõ").

## Trạng thái trước fix

Lô hàng LCL (lô lẻ, KHÔNG có container — chỉ kiện/bao bì/kg/CBM) hiển thị đủ
trên `/shipments` ("Tổng quan lô hàng") nhưng KHÔNG có trên `/shipments-detail`
("Chi tiết lô hàng"). Hai màn dùng 2 query khác nhau; filter/loại-hàng/join
nào đó làm rớt lô lẻ ở màn Chi tiết.

## Expected (sau fix)

| ID | Bước | Kỳ vọng |
|---|---|---|
| LCL01-R1 | Tạo lô LCL LOCAL (không cont) | lô hiện ở TỔNG QUAN `/shipments` |
| LCL01-R2 | Mở CHI TIẾT `/shipments-detail` cùng filter | CÙNG lô lẻ hiện ở Chi tiết — không rớt |
| LCL01-R3 | So sánh API response 2 màn cho lô LCL | lô lẻ có mặt ở CẢ 2 payload; không màn nào filter theo cont |
| LCL01-R4 | Lô FCL có cont | 2 màn vẫn đồng bộ như trước (không regression) |
| LCL01-R5 | Test unit query/projection | pin: containerless LCL lot sống sót qua detail query |

## Verify (21/10/2026)

- **Audit (root cause)**: 2 màn dùng 2 query khác nhau — Tổng quan
  (`/shipments` → `GET /cus-workspace`, không filter ngày mặc định) vs Chi
  tiết (`/shipments-detail` → `GET /cus-workspace/containers`, FE mặc định
  bơm `transportDateFrom=To=<hôm nay>` — `ShipmentContainersPage.tsx:83-84`).
  Điều kiện day-triage phía detail (card 181026185900 D.6) chỉ miễn TRỪNG
  hợp cho lô lẻ CHƯA có ngày (`isNull(transportDate)`) — lô lẻ CÓ EDD khác
  hôm nay bị filter rớt khỏi Chi tiết trong khi Tổng quan vẫn liệt kê
  ("lô hàng lẻ hiện ở TỔNG QUAN nhưng KHÔNG có ở CHI TIẾT"). Lớp join
  (card 365 `rowSource`) đã đúng từ trước; còn một ranh giới có chủ đích:
  lô containerless nhưng `cargo_mode IS NULL` (lô legacy/quick-create rỗng —
  0 lô có dữ liệu kiện hàng trong DB) vẫn bị loại — không phải "lô lẻ".
- **Fix**: `containerDayTriageCondition` (`cus-workspace-sql.service.ts`) —
  MỌI dòng lô lẻ containerless (LCL) đi ngoài day-triage, có ngày hay không;
  dòng container thật vẫn triage theo ngày như cũ. Lô lẻ có mặt ở Chi tiết
  ở mọi trạng thái filter ⇔ không bao giờ rớt so với Tổng quan.
- **Repro failing-before / passing-after** trên backend cùng code
  (`qa/2026-10-21-lcl01-dri03/lcl01-repro-BEFORE.log` vs `…-AFTER.log`,
  script `testplan/qa/scripts/2026-10-21-lcl01-repro.mjs` — tự tạo 2 lô LCL
  (UNDATED + DATED 2099-06-15) qua create API thật, so sánh response 2 màn
  đúng query mặc định của từng màn):
  - BEFORE (`6cc38550~1`, :3013): FAIL R2 dated (mất trên Chi tiết mặc định),
    FAIL R5 (search không thấy), FAIL INVARIANT (`LCL01-DATED-249234` rớt).
  - AFTER (`6cc38550` code, :3012): 8/8 PASS; total Chi tiết mặc định
    853 → 1006 (các dòng lô lẻ đi qua ống kính ngày).
- **Unit pin**: `backend/src/tests/unit/cus-container-day-triage.test.ts`
  3/3 pass (SQL render qua PgDialect: nhánh lô lẻ KHÔNG có điều kiện ngày,
  dateArms của dòng container giữ nguyên, cấu trúc OR đúng).

## Not covered

- UI DRIVEN: brief này chạy evidence cấp API + unit (repro so sánh API
  response 2 màn đúng yêu cầu card). Chưa drive click trên FE 390px cho
  lcl-01 (kẹp 390px nằm ở DRI-03).
- Ranh giới `cargo_mode IS NULL` (lô legacy/quick-create không cont) giữ
  nguyên theo card 365 ("stay excluded, exactly as before") — không phải lô
  lẻ (0/929 lô NULL-mode có dữ liệu kiện hàng trong DB local).
- Filter `dispatchStatus`/`informationStatus=MISSING` (detail-only) vẫn loại
  dòng lô lẻ — cố ý (triage dòng container; overview không có filter này).
