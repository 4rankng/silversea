# SIL-1096 — Trả lời "còn thiếu gì" đủ 4 điều kiện lập bảng kê trên Chốt debit

Case ID: SIL-1096-R1..R4 (QA complaint 26/11, `/accounting/chot-debit`,
AccountingDebitClosePage).

**Ticket:** SIL-1096 (id 1272) — board `plan.tingting.vip/tingtingsoft/SIL`
**Owner (implement):** frontend (+ backend wire sẵn có từ SIL-1095)
**Owner (verify):** qa
**Status (this doc):** READY — regression recorded prior to implementation per AGENTS.md §6
**KB:** §3.1.3 (K3.5; trùng K2.69) — bốn điều kiện lập bảng kê: hàng hóa · giá ·
chứng từ · điều kiện kỳ; thiếu thì nêu đủ từng lý do + cách bổ sung.

---

## Goal

Một chỗ **nhất quán** trên dòng lô tại `/accounting/chot-debit` (popover trên dòng lô)
trả lời khách *"còn thiếu gì"*: liệt kê đủ **4 điều kiện lập bảng kê**, điều nào thiếu thì
nêu **LÝ DO + CÁCH BỔ SUNG** cụ thể, điều nào đủ thì tick xanh (không im lặng):

1. **Hàng hóa** — thiếu container/hàng khai báo → cách bổ sung (thêm container trên lô).
2. **Giá** — thiếu tuyến/bảng giá/khoản phí bắt buộc → nêu **đúng** thiếu gì (tuyến,
   điều khoản cước, phụ phí chưa chốt…).
3. **Chứng từ** — đọc từ document-set facts + e-POD + nhận phơi (dữ liệu SIL-1073
   `f82c48ae`) → nêu **TÊN** tài liệu thiếu.
4. **Điều kiện kỳ** — kỳ giá dầu/điều khoản chưa chốt (`fuelLagDays`/ngưỡng — tín hiệu
   công thức đã ghi rõ) → nêu thiếu gì + **ai chốt**.

## Out of scope

- Không trùng SIL-1073: không đổi trạng thái chứng từ Lớp 2, không rebuild
  DocumentSetCard/document-debt — chỉ ĐỌC để trả lời tổng hợp.
- Không phát minh DB state; không endpoint tạo dữ liệu mới.
- Không đổi tiền/trên-lưới cước hiện có; không đổi luật `Thiếu chi phí` về mặt dữ liệu
  (chỉ nâng cấp cách báo: từ chấm mờ sang câu trả lời có lý do + cách bổ sung).
- Không đụng các file lane khác: `expense-accounting-voucher.service.ts`,
  `treasury.service.ts`, `frontend/src/features/expense-accounting/**`,
  `shared/src/expense-accounting*`.
- Panel tái dùng trên chi tiết lô là optional; ticket này chốt **một** chỗ: popover trên
  dòng lô tại chot-debit.

---

## Case SIL-1096-R1 — Popover liệt kê đủ 4 điều kiện; thiếu nêu lý do + cách bổ sung

- **Given** kế toán mở `/accounting/chot-debit`, dòng lô thiếu ví dụ: chưa có tuyến,
  còn thiếu chứng từ, chưa chốt kỳ giá dầu.
- **When** mở popover điều kiện trên dòng lô.
- **Then** popover liệt kê đủ 4 dòng *Hàng hóa · Giá · Chứng từ · Điều kiện kỳ*; mỗi
  dòng thiếu kèm **lý do** (nêu đúng phần thiếu) + **cách bổ sung**; dòng đủ hiện tick
  xanh + nhãn *Đủ* (không im lặng).
- **Assert** popover mở bằng chuột lẫn bàn phím (trigger là button, aria-label nêu hành
  động + tên lô, `aria-expanded`), Escape đóng, focus trả về trigger; nội dung wrap
  không truncate; overlay nền trắng `--surface`.

## Case SIL-1096-R2 — Điều kiện "Giá" nêu đúng thiếu gì

- **Given** dòng lô: (a) thiếu tuyến (`routeName` null); (b) thiếu điều khoản cước/bảng
  giá (trace `rateTermsId`/`pricingTableId` = 0, hint công thức *Thiếu điều khoản cước
  tự động…* / *Thiếu giá gốc…*); (c) có khoản phụ phí chưa chốt (pending fee);
  (d) đủ giá.
- **When** xem dòng *Giá* trong popover.
- **Then** (a) lý do *thiếu tuyến* + cách bổ sung *chọn tuyến trên lô*; (b) nêu đúng hint
  thiếu (điều khoản cước / bảng giá / định mức dầu) + cách bổ sung (nhập tay tại cước
  hoặc cấu hình danh mục); (c) nêu *phụ phí chưa chốt — chờ Kế toán duyệt* kèm số
  khoản; (d) tick *Đủ*.
- **Assert** không trả lời chung chung "thiếu dữ liệu"; dấu chấm *Thiếu chi phí* cũ
  không còn là tín hiệu duy nhất (không lặp cùng khái niệm 2 chỗ trên 1 dòng).

## Case SIL-1096-R3 — Điều kiện "Chứng từ" nêu TÊN tài liệu thiếu (đọc SIL-1073)

- **Given** lô có document-set facts `Còn thiếu` với `missingDocuments` = danh sách tên
  tài liệu; e-POD chưa xác nhận; chưa nhận phơi.
- **When** xem dòng *Chứng từ* trong popover.
- **Then** lý do liệt kê **tên** tài liệu thiếu (đọc từ dữ liệu Lớp 2) + tín hiệu e-POD
  (Lớp 1) + nhận phơi (Lớp 3); cách bổ sung nêu nơi bổ sung (hồ sơ gốc / e-POD / phơi).
- **Assert** fact thiếu mà không có tên → *Chưa ghi nhận danh mục* (không bịa tên);
  đủ 3 lớp → tick *Đủ*; không có màn hình/chức năng Lớp 2 mới nào được xây lại.

## Case SIL-1096-R4 — Điều kiện "Điều kiện kỳ" nêu thiếu gì + ai chốt

- **Given** lô: (a) thiếu kỳ giá dầu hiệu lực (trace `fuelPricePeriodId` = 0 / hint
  *Không tìm thấy kỳ giá dầu hiệu lực (kiểm tra số ngày trễ giá)*); (b) độ trễ giá dầu
  (`fuelLagDays`) hoặc ngưỡng biến động giá dầu chưa được chốt; (c) kỳ/điều khoản đã
  chốt đủ.
- **When** xem dòng *Điều kiện kỳ* trong popover.
- **Then** (a) nêu thiếu kỳ giá dầu + cách bổ sung (kiểm tra số ngày trễ giá, phê duyệt
  kỳ giá dầu — Kế toán/Admin); (b) nêu đúng điều khoản chưa chốt (độ trễ / ngưỡng) +
  **ai chốt** (khách chốt điều khoản, cập nhật danh mục điều khoản cước); (c) tick *Đủ*.
- **Assert** lý do đọc từ tín hiệu công thức sẵn có (hint/trace), không suy đoán bịa.

---

## Fix law

Điều kiện derive từ dữ liệu có sẵn: board row (`containers`, `customsNumber`, money
nulls, `routeName`) + detail wire (`documentSet`, `podReviews`, e-POD, phoi,
`freightRate.latest` trace ids/hints, `pricingProjection.missingInput`, `statusSummary`
từ SIL-1095, pending fee). Trigger thay chấm *Thiếu chi phí* bằng affordance mở
popover (một khái niệm một chỗ). Trình bày theo design-guidelines §1 (text + dot),
§4 (không truncate), overlay `--surface`, popover theo house triple
(`usePopoverPosition` + `useClickOutside` + `createPortal`).

## Verification

- FE: scoped vitest — pure derivation (`debit-close-readiness`) + render popover
  (lý do/cách bổ sung/tick) + `tsc` xanh; BE tsc nếu đụng backend.
- Bằng chứng chạy thật / độ phủ rung UI ghi rõ trong báo cáo lane.

## What is NOT covered

- Tổ hợp dữ liệu lỗi thời (wire cũ thiếu field mới) ngoài luống optional-field.
- Popover trên các bảng khác (Ghép bộ Debit, chi tiết lô) — ngoài một chỗ đã chốt.

## Linked artifacts

- Spec: board SIL-1096 (id 1272).
- Dữ liệu chứng từ: SIL-1073, commit `f82c48ae`.
- Tín hiệu phụ phí chưa chốt: SIL-1072 (`pendingFeeCount`); hint công thức:
  `freight-rate-snapshot-lifecycle.service.ts` buildFormulaHint.
