# SIL-487 — Hồi quy: Kế toán lập phiếu hoàn ứng (nút/flow theo nghiệp vụ chi hộ)

Ngày: 2026-10-26 · SIL-487 (unblock SIL-176) · branch `fix-549-hoanung`

## Bối cảnh

Kế toán không có đường tạo phiếu hoàn ứng nào trong UI — tab "Phiếu hoàn ứng"
chỉ có summary + filter, empty state bảo "Giao nhận có thể lập phiếu thanh toán
từ ứng dụng". Vì staging không có phiếu nào, QA không thể test contract
`POST /advance-settlements/:id/check` của SIL-176 (replay cùng key vs 409 khác
key). PRD `PhanHeKeToan.md` (mockup ảnh 8/9 — bảng 1.1.4 báo cáo hoàn ứng) đã
chỉ định nút **"Lập phiếu hoàn ứng"** trên phía kế toán: chọn nhân viên, tích
duyệt dòng, lập phiếu từ phí chi hộ (có/không hóa đơn) đối chiếu tạm ứng.

## Thay đổi

- BE: `POST /api/advance-settlements` (ADMIN/ACCOUNTANT, material write qua
  `runIdempotent` — endpoint `advance-settlements.create`) tạo phiếu RECORDED
  cho forwarder được chỉ định (`forwarderId` trong body), `approved_by` = kế
  toán thực hiện (người submit thật sự theo ruling FB-100 Option B — tick xác
  nhận hoàn ứng của chính người submit).
- BE: `GET /api/advance-settlements/eligibility?forwarderId=` trả danh sách
  tạm ứng đủ điều kiện (RECORDED + đã giải ngân đủ + chưa bị tiêu) và khoản
  chi chưa gắn phiếu của nhân viên đó — cùng luật eligibility với flow Ops.
- FE: nút **"Lập phiếu hoàn ứng"** trên tab settlements (FilterBar actions,
  chỉ ADMIN/ACCOUNTANT) mở dialog: chọn nhân viên (từ tồn tạm ứng) → chọn tạm
  ứng + khoản chi → tiền hoàn lại (có dấu) + ghi chú → tick "Xác nhận hoàn ứng"
  (FB-100: tick của người submit chặn nút ghi nhận) → POST.

## Phạm vi hồi quy

| # | Khu vực | Rủi ro | Trường hợp kiểm |
|---|---------|--------|-----------------|
| R1 | Nút lập phiếu | sai role nhìn thấy nút; MANAGER đọc được list nhưng không được tạo | ADMIN/ACCOUNTANT thấy nút; MANAGER/CUS không |
| R2 | Dialog chọn nhân viên | nhân viên không có tạm ứng tồn vẫn được chọn → eligibility rỗng | list chỉ từ admin advance-balances (outstanding > 0); trống → EmptyState |
| R3 | Chọn tạm ứng/chi phí | chọn tạm ứng chưa đủ điều kiện; chọn khoản chi chưa kê xong | advances từ eligibility (đã lọc); khoản chi completionStatus ≠ COMPLETED không tick được |
| R4 | Validate submit | submit khi chưa chọn tạm ứng / chưa tick | nút disabled; submit chương trình cũng bị chặn (guard trong handler) |
| R5 | Tiền hoàn lại | mất số âm — chi vượt tạm ứng phải nhận refundAmount âm (FB-100) | NumberField signed; payload gửi số âm; schema signedNumeric nhận |
| R6 | Tạo phiếu thành công | phiếu không xuất hiện; cache stale | POST → invalidate settlementsAll → list refetch có phiếu mới (status RECORDED, "Ghi nhận bởi" = kế toán) |
| R7 | Idempotency | double-submit tạo 2 phiếu | FE tự gửi Idempotency-Key (mutation-identity); BE runIdempotent replay |
| R8 | Route ordering | `GET /eligibility` bị nuốt bởi `GET /:id` (parseInt NaN) | pin thứ tự đăng ký trong unit test source-scan |
| R9 | 405/403 lân cận | flow Ops cũ bị ảnh hưởng | forwarder route `/api/forwarder/me/advance-settlements` không đổi; test既有 giữ xanh |
| R10 | Duyệt phiếu (SIL-176) | nút DUYỆT trên phiếu mới hoạt động đúng contract | sau khi lập, phiếu RECORDED + checkedBy NULL → duyệt được (path SIL-176 mở lại) |

## Evidence

- `qa/2026-10-26-sil487/` — scoped + full FE vitest, tsgo, BE unit tests,
  eslint, build.
- Tests: `AdminAdvanceSettlementsPage.test.tsx` (R1, R3–R6), BE
  `src/tests/unit/advance-settlement-admin-create.test.ts` (R1 role gate,
  R8 ordering, schema signed refund).
