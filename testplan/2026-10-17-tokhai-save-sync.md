# Card 171026180010 (T-10) — Tờ khai: lỗi không lưu + tự đồng bộ sang các cont cùng lô

Ngày: 2026-10-17 · ưu tiên cao (lỗi mất dữ liệu nhập) · branch
`fix-171026180010-to-khai-luu-dong-bo`.

> Ghi chú môi trường: worktree Paseo gốc bị daemon prune 2 lần giữa session
> (mất cả branch lẫn file chưa commit). Công việc dựng lại ở worktree temp
> ổn định từ main 11720424, WIP commit sớm sau mỗi mốc.

Yêu cầu chủ lô (nguyên văn card):
1. Sửa lỗi nhập số tờ khai nhưng hệ thống không lưu.
2. Khi cập nhật số tờ khai ở 1 cont, tự động sync sang các cont còn lại
   trong cùng lô.

## Chẩn đoán (rung 2, server :3002 + DB :5441, trước fix)

- Lô 110917 (FCL, 2 cont 48879/48880): cont 48879 KHÔNG có fulfillment row,
  cont 48880 có. POST container-line update `{declarationNumber}` cho 48879 →
  **409 "Tác vụ thực hiện hiện có không khớp danh sách container."** —
  `ensureShipmentFulfillmentsInTx` → `assertExistingDecompositionMatches`.
- Trạng thái "partial-but-clean" sinh ra từ create contract: lô FCL born-READY
  KHÔNG decompose lúc tạo; `addCusShipmentContainer` chỉ decompose cont MỚI
  → cont gốc không có row (FB-110, card 171026122110, test salvaged
  `shipment-declaration-container.test.ts` ĐỎ ở HEAD — fix WIP b08cf82b chưa
  từng land). 25 lô mismatch trong DB local.
- Card T-10 (171026180010) là phúc trình lại của FB-110/FB-109 với luật mới
  cho phần sync.

## Luật mới theo card này (thay luật cũ card 261013200312 / FB-085)
→ **THU HẸP bởi Amendment 2026-10-18 ở cuối file** (chỉ cont còn trống nhận
auto-copy; cont đã có số không bị ghi đè) — đoạn dưới mô tả luật 171026180010
nguyên bản, không còn hiệu lực toàn phần.

- CŨ: auto-copy CHỈ khi nhập số ĐẦU TIÊN của lô và mọi cont khác còn trống;
  divergence cố ý giữ nguyên; FE tự gọi copy-declaration sau khi lưu.
- MỚI (nguyên văn "tự động sync sang các cont còn lại trong cùng lô"):
  cập nhật tờ khai KHÁC RỖNG trên 1 cont → BE ghi đè CÙNG số lên TẤT CẢ cont
  khác của lô, trong MỘT transaction với lần lưu đó (không còn call copy riêng
  của FE). Xóa số (rỗng) vẫn là hành vi CỤC BỘ của cont được sửa — không quét
  sạch cả lô. Nút copy tường minh (chỉ điền cont trống, không ghi đè) giữ
  nguyên luật cũ.

## Case ID: TC-TOKHAI-SAVE-01 — nhập số tờ khai phải lưu được (bug repro)

Tiền điều kiện: lô FCL born-READY + thêm cont (partial-but-clean, cont gốc
không có fulfillment), chưa khóa kế toán, CUS/ADMIN.

Các bước: editor "Chứng từ" của cont không có row → nhập số → Lưu → reload /
GET workspace detail.

Kỳ vọng: lưu thành công; DB giữ số sau reload; bộ fulfillment được heal đủ
(mỗi cont 1 row active) trong cùng transaction; version lô +1 đúng một bậc.
Pin: FB-110 R1, R3.

## Case ID: TC-TOKHAI-SYNC-02 — cập nhật 1 cont → sync các cont còn lại
→ **THU HẸP bởi Amendment 2026-10-18**: kỳ vọng dưới đây (ghi đè MỌI cont
kể cả số cũ khác + toast "đồng bộ") KHÔNG còn hiệu lực — luật hiện hành chỉ
auto-copy sang cont CÒN TRỐNG, không toast khi không có cont trống nào được
ghi. Dẫn chứng hiện hành: `2026-10-18-card-fb109-to-khai-auto-copy.md`
(FB-109-02), pin SYNC-02 + FB-109 R4.

Tiền điều kiện: lô FCL ≥ 2 cont, các cont ĐÃ có số (trùng hoặc lệch nhau).

Các bước: đổi số tờ khai cont A sang giá trị mới → Lưu.

Kỳ vọng: MỌI cont khác của lô nhận đúng số mới (kể cả số cũ khác), một
transaction, version +1 một bậc; response báo `declarationSync.updatedContainerIds`;
toast "Đã lưu số tờ khai và đồng bộ sang N container khác của lô."
Pin: FB-110 R2, T-10 SYNC-02, FB-109 R3 (chain sụp về 1 call).

## Case ID: TC-TOKHAI-SYNC-03 — xóa số (clear) KHÔNG sync xóa hàng loạt

Đổi số cont A thành rỗng → Lưu. Kỳ vọng: chỉ cont A mất số; cont khác giữ số;
response không có declarationSync. Pin: FB-110 R2 (clear), FE test "a clear stays local".

## Case ID: TC-TOKHAI-SYNC-04 — single-cont lot không sync, không lỗi

Lô 1 cont: đổi số → lưu bình thường, `declarationSync` vắng (không có sibling).
Pin: T-10 SYNC-04, FE test single-container lot.

## Case ID: TC-TOKHAI-SYNC-05 — số thuộc lô khác vẫn bị chặn (409)

Nhập số đã thuộc lô khác (container attribute hoặc shipment_declarations).
Kỳ vọng: 409 SHIPMENT_REFERENCE_DUPLICATE, KHÔNG lưu, KHÔNG sync. Pin: FB-110 R4.

## Case ID: TC-TOKHAI-STRICT-06 — shape lạ vẫn 409 chặt (không heal mù)

Active fulfillment: NULL-container row, hoặc trỏ cont của lô khác → vẫn 409
"Tác vụ thực hiện hiện có không khớp danh sách container.", rollback sạch,
không mint row. Double-row trên 1 cont không seed được
(`shipment_fulfillments_active_container_uniq_idx` chặn ở storage). LCL
malformed vẫn 409 "Lô hàng lẻ phải có đúng một tác vụ thực hiện.".
Pin: FB-110 R3, LCL guard.

## Kết quả chạy

(xem `qa/2026-10-17_tokhai_*`)

## Amendment 2026-10-18 — FB-109 (card 171026122100) thu hẹp luật sync

Phúc trình FB-109 ngày 18-10 xác nhận lại design note gốc của popup:
"số đầu tiên của lô được tự copy sang các cont còn trống, cont đã có số không
bị ghi đè; reload trang vẫn còn số." Luật TC-TOKHAI-SYNC-02 ở trên ("MỌI cont
khác của lô nhận đúng số mới, kể cả số cũ khác") được THU HẸP:

- auto-copy CHỈ ghi các cont CÒN TRỐNG của lô, trong cùng transaction với lần
  lưu;
- cont ĐÃ CÓ số không bao giờ bị ghi đè (divergence là hợp lệ);
- xóa số vẫn cục bộ (TC-TOKHAI-SYNC-03 giữ nguyên);
- toast đổi thành "Đã lưu số tờ khai và tự copy sang N container chưa có số
  của lô."

Case mới + pin: `2026-10-18-card-fb109-to-khai-auto-copy.md` (FB-109-02);
`shipment-declaration-container.test.ts` → SYNC-02 (đổi kỳ vọng), FB-109 R4.
