# SIL-835 (id 964) — /accounting/chot-debit (table.debit-board): ô SỐ BILL/BOOK tràn và chồng cột HÀNG HÓA & CONT

- **Ticket**: SIL-835 · board plan.tingting.vip/tingtingsoft/SIL
- **Regression**: Build `ad4f0597` / `4db2d62f` — commit `ab50b4c9` (Task 2.2b) tách `Số Bill/Book` thành cột thứ 2 (`width: 9%` ≈ `99–103px` ở canvas `1142px`) nhưng đặt `.debit-board td.debit-col--billbook .debit-bill-book { white-space: nowrap; }`.

## Reproduction (trước fix)

1. Đăng nhập vai `ACCOUNTANT` (`hoapt`), mở `/accounting/chot-debit` tại viewport `1440x900` (sidebar mở → `table.debit-board` `1142px`, không scroll ngang).
2. Chuyển tab LCL (`Vận tải Hàng Lẻ`), tìm mã `R4B-A14-EMPTY-8F29` (18 ký tự) hoặc bất kỳ mã Bill/Book ≥ 12 ký tự (local BEFORE: `11/11` ô tràn, `tdClientW: 99`, `tdScrollW: 107..137`, `EURFLK2690325HPH` `spanRight: 563 > nextLeft: 526`; staging `4db2d62f`: `clientWidth 99px vs scrollWidth 152px`).
3. Do `white-space: nowrap` trong cột `table-layout: fixed` `9%`, chữ tràn ra ngoài mép phải ô `SỐ BILL/BOOK` và chồng trực tiếp lên cột `HÀNG HÓA & CONT` kế bên.

## Expected behavior (sau fix)

- `.debit-board td.debit-col--billbook .debit-bill-book` áp dụng wrap law (`display: block; max-width: 100%; white-space: normal; overflow-wrap: anywhere; word-break: normal;`) thay vì `white-space: nowrap`:
  - Mã có dấu `-` như `R4B-A14-EMPTY-8F29` xuống dòng tự nhiên tại `-`; mã liền không dấu như `EURFLK2690325HPH` / `STPKHHHPH26A002` ngắt sạch trong biên ô `99px` (`overflow-wrap: anywhere`), không tràn sang `HÀNG HÓA & CONT`, không `ellipsis`/`overflow: hidden`.
- Giữ nguyên `table.debit-board` (`1142px < 1440px`, `min-width: 1136px`, 10 cột `[14, 9, 9, 9, 12, 10, 12, 10, 10, 9]`), không scroll ngang.

## Pins

- `frontend/src/pages/accounting/AccountingDebitClosePage.sil701-date-column.styles.test.ts`
- `frontend/src/pages/accounting/AccountingDebitClosePage.test.tsx`
