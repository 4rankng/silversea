# Lane K2 (GLM) — SIL-735 · SIL-736 · SIL-737 (spec fix 2 07/11)

Ba case đều đến từ "spec fix 2" của owner (07/11): một tra cứu, một luật xóa
trắng, một cơ chế tự ghi. Mỗi case ghi rõ hành vi trước, luật sau, và bằng
chứng đã chạy.

---

## SIL-735 — "Thêm cược": 4 số cuối phải khớp CHUỖI CON trên CẢ Số Bill VÀ Số Booking

- Ticket: SIL-735 (board SIL, id 855).

### Hành vi trước fix

`findBillSuggestions` (backend/src/services/bill-book-search.service.ts) so
`right(chuỗi số của trường, 4) = 4 số đã gõ` — tức là "chuỗi số KẾT THÚC bằng
4 số này". Nhưng kế toán đọc "4 số cuối" trên GIẤY: với Số Booking
`RARBOOK-1792226038601-9bzut2`, 4 số cuối người ta đọc là **8601** (đuôi của số
1792226038601), trong khi chuỗi số của số Booking là `179222603860192` (hậu tố
"9bzut2" có thêm chữ số) nên ĐUÔI chuỗi số là **0192**. Gõ 8601 ⇒ không lô nào
ra. Luật cũ chỉ đúng khi chuỗi số vừa khớp vừa nằm ở cuối.

### Luật sau

4 số đã gõ khớp một CHUỖI CON của chuỗi số, trên CẢ hai trường (Số Bill VÀ
Số Booking). Chuỗi con bao hàm trường hợp đuôi cũ, nên không mất gì.

- Luật thuần: `backend/src/services/bill-digit-match.ts` (`parseBillDigits`,
  `billDigitsNeedle`) — db-free để unit test chạy được (luật BE unit-only 19/10).
- Query: `regexp_replace(<trường>, '[^0-9]', '', 'g') ilike <needle>` với hai
  nhánh trong `or()` (nhánh booking KHÔNG lách được filter tombstone).

### Case pin

1. 4 số cuối của Số Bill ⇒ ra đúng lô.
2. 4 số cuối của Số Booking (là chuỗi con, KHÔNG phải đuôi chuỗi số) ⇒ ra đúng lô.
3. Đuôi chuỗi số vẫn khớp (chuỗi con bao hàm đuôi).
4. 4 số không có trong dữ liệu ⇒ không ra lô nào.
5. Lô đã xoá mềm không được gợi ý.

### Regression evidence

- Unit: `backend/src/tests/unit/deposit-bill-suggestions.test.ts` — 4/4 pass
  (luật thuần + wiring SQL hai nhánh + luật đuôi cũ đã gỡ).
- API + DB thật: `qa/scripts/2026-11-07-sil735-bill-lookup-probe.mjs` →
  `qa/2026-11-07-lane-k2/sil735_bill-lookup_probe.log` — 5/5 pass (seed lô thật,
  gọi `GET /api/accounting/deposits/bill-suggestions`, dọn fixture).

---

## SIL-736 — CUS xóa trắng ô BKS báo khách ⇒ lưu được, fallback BKS thực

- Ticket: SIL-736 (board SIL, id 856). Luật KB 3.6.6 / spec 23/10 §4.1.

### Hành vi trước fix

Backend đã đúng luật (schema nhận `null`/`''`, service normalize
`trim() || null` thành clear, read-side fallback `effectiveBillingPlate` ⇒
Debit Note in BKS thực). NHƯNG hai màn CUS chặn phía client nên CUS KHÔNG
xóa trắng được:
- `AccountingDebitClosePage` — nút Lưu bị disable khi ô trống, và
  `saveBillingPlate()` bỏ qua luôn ô trống;
- `ShipmentContainerLedger` — `saveBillingPlate()` đóng editor khi draft rỗng.

Dấu hiệu người dùng thấy: "BKS không được để trống" (mặc định cũ của schema
`truckNo` = `trim().min(1)`).

### Luật sau

Xóa trắng là một thao tác lưu HỢP LỆ:
- gửi `billingTruckNo: null` (không bao giờ `''`, không bao giờ `undefined` —
  `undefined` là "không đụng" theo wire);
- BKS THỰC giữ luật nghiêm: ô BKS thực rỗng vẫn không gửi (`truckNo` min 1);
- draft không đổi ⇒ không ghi (không bump version, không rác audit);
- ô BKS ảo đã xoá thì dòng "BKS ảo" biến mất ngay (overlay lạc quan).

### Case pin

1. Ô BKS ảo trống + Lưu ⇒ `updateLclTruck({ shipmentId, billingTruckNo: null })`,
   panel đóng, bảng refetch.
2. Draft không đổi ⇒ 0 lần gọi API.
3. Lỗi server ⇒ panel MỞ lại, hiện đúng message server.
4. Ô BKS thực trống ⇒ nút Lưu disable, không gọi API.
5. Debit Note in BKS thực khi BKS báo khách trống (đã có: BE unit
   `lcl-gop-hang-split-law.test.ts` + `debit-note-live-bks.test.ts`).

### Regression evidence

- `cd frontend && npx vitest run src/pages/accounting/AccountingDebitClosePage.fb093.test.tsx src/features/shipments/detail/ShipmentContainerLedger.test.tsx`
  ⇒ 100/100 pass; sweep anh em (14 file / 196 test) pass.

---

## SIL-737 — Chuyến nội bộ "Đã hoàn thành" tự ghi ký hiệu (Đ/K/Q) vào lưới /timesheet

- Ticket: SIL-737 (board SIL, id 857). Bộ ký hiệu: `docs/timesheet-design-2026-10-14.md` §2.1
  (K kẹp 2 cont = 1 chuyến · Q quay đầu = 2 chuyến · Đ chạy đơn = 1 chuyến).

### Hành vi trước fix

Lưới chấm công chỉ có MỘT nguồn: Điều vận gõ tay từng ô (`PUT
/api/timesheet/months/:id/days`). Không có đường nào tự ghi ký hiệu từ chuyến
đi. Lái xe chạy xong thì lưới vẫn trống cho tới khi Điều vận gõ.

### Luật sau

Chuyến **xe nội bộ** (xe SilverSea, không thuộc nhà xe ngoài) chuyển "Đã
hoàn thành" ⇒ hệ thống tự ghi ký hiệu cho ô lưới của **NGÀY HOÀN THÀNH**
(luật SIL-683: UTC → Asia/Ho_Chi_Minh).

- Ký hiệu suy ra từ CÁC chuyến hoàn thành trong ngày đó (không phải từ một
  chuyến): 1 chuyến ⇒ `K` nếu là kẹp, `Đ` nếu là đơn/lẻ; 2 chuyến trở lên ⇒ `Q`.
  Suy ra theo NGÀY là để số chuyến của ô luôn khớp thực tế (một cặp kết hợp
  kết thúc cùng ngày = 2 chuyến = `Q`; tách hai ngày = mỗi ngày 1 chuyến = `Đ`).
- Cột `driver_timesheet_days.source` ('MANUAL' | 'AUTO') đánh dấu ô của ai:
  ô Điều vận gõ tay KHÔNG bị đè; ô hệ thống ghi thì được làm mới, và bị xoá
  khi ngày đó không còn chuyến nào (chuyến bị huỷ).
- Tháng chấm công chưa mở ⇒ mở luôn theo `drivers.salary_mode` (luật FB-103),
  `daily_base` để trống cho tới khi Kế toán nhập; tháng đã ĐỐI CHIẾU thì
  không ghi (bảng đã niêm phong).
- Ghi ở ĐÚNG MỘT cửa: `transitionTripStatus` (hoàn thành VÀ huỷ), nên mọi
  đường hoàn thành — Điều vận, app lái xe, đóng hộ cho nhà xe ngoài — cùng
  một luật, trong cùng transaction.

### Case pin

1. Chuyến nội bộ hoàn thành ⇒ ô lưới của ngày hoàn thành có ký hiệu, source=AUTO.
2. Ngày ghi = ngày hoàn thành (không phải ngày xuất phát).
3. Ngày có 1 chuyến ⇒ `Đ` (hoặc `K` nếu là kẹp).
4. Ngày có 2 chuyến ⇒ `Q`.
5. Ô gõ tay (MANUAL) không bị đè.
6. Chuyến nhà xe ngoài / không có lái xe ⇒ không ghi.

### Regression evidence

- Shared (luật thuần): `shared/src/calculations/timesheetSalary.test.ts` — 30/30 pass
  (7 case mới cho `timesheetSymbolForDay`).
- BE unit (wiring): `backend/src/tests/unit/timesheet-auto-symbol.test.ts` — 6/6 pass.
- DB thật (service production): `qa/scripts/2026-11-07-sil737-timesheet-auto-symbol-probe.mjs`
  ⇒ `qa/2026-11-07-lane-k2/sil737_timesheet-auto-symbol_probe.log` — 5/5 pass
  (chạy đúng `syncTimesheetSymbolForTrip`, dọn fixture).

### Giới hạn đã biết (không giấu)

- Lưới mô hình "1 ngày = 0..2 chuyến" (design doc §2.2): một ngày 3+ chuyến
  không có ký hiệu tương ứng — hệ thống ghi `Q` (2 chuyến), phần chuyến còn lại
  là chỉnh lệch của Kế toán trên ô.
- Chuyến LCL (lẻ) là 1 chuyến/ngày nên rơi vào `Đ`; bộ ký hiệu lưới không có
  chữ riêng cho "lẻ" (chỉ có trong báo cáo năng suất đội xe).
