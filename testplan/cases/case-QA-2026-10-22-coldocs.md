# Case QA-2026-10-22-coldocs — Chi tiết lô: thứ tự nhóm cột chứng từ BILL/BOOKING → SỐ TỜ KHAI → NHẬP/XUẤT → HÃNG TÀU

Card QA 221026095429 (22/10 09:54). Yêu cầu: nhóm cột chứng từ ở bảng Chi tiết
lô (`/shipments-detail`) phải theo thứ tự BILL/BOOKING → SỐ TỜ KHAI →
NHẬP/XUẤT → HÃNG TÀU (booking trước tờ khai).

## Trạng thái audit (22/10, cùng lane card 261022093846)

Thứ tự yêu cầu **đã là thực thi hiện tại** trên mọi surface "Chi tiết lô" —
landed từ FB-113/FB-113 v2 (card 171026122140, 17/10):

- Ledger `ShipmentContainerLedger.tsx`: `<thead>` Bill/Booking → Số tờ khai →
  Nhập/Xuất → Hãng tàu; `<colgroup>` và thứ tự `<td>` khớp; mobile card không
  có CSS `order:` đảo lại.
- Inline documents editor: Số Bill/Số Booking → Số tờ khai → Nhập/Xuất → Hãng tàu.
- Header `ShipmentDetailPage.tsx` (cùng nav title): cùng thứ tự.
- CUS quick-edit (`CusQuickEdit.tsx`): cùng thứ tự.

Không có surface nào đang sai thứ tự → không có change tính năng. Card được
ghi nhận bằng **regression pin** (test) + evidence DOM thật để thứ tự không
bị đảo lại trong các refactor cột sau này.

## Expected

| ID | Bước | Kỳ vọng |
|---|---|---|
| COLDOCS-R1 | Render ledger | Bốn `<th>` nhóm chứng từ đúng thứ tự Bill/Booking → Số tờ khai → Nhập/Xuất → Hãng tàu; bốn `<td data-label>` cùng thứ tự |
| COLDOCS-R2 | UI drive `/shipments-detail` | Chuỗi `<th>` DOM thật đúng thứ tự (log kèm) |

## Verify

- Unit pin: `ShipmentContainerLedger.test.tsx` (describe card 221026095429)
- UI probe: `qa/2026-10-22-nangha-lcl/coldocs-221026095429-order.log` — DOM thật
  trên stack worktree (admin, 1440): thead = ["Khách hàng & lộ trình",
  "Bill/Booking", "Số tờ khai", "Nhập/Xuất", "Hãng tàu", ...] PASS

| Claim / bug | Rung | Evidence | Not covered |
|---|---|---|---|
| COLDOCS-R1 thứ tự 4 cột chứng từ đúng như card | 3 (UI DRIVEN) | `coldocs-221026095429-order.log` (thead + td thật) + unit pin 74/74 scoped | staging (nơi QA có thể thấy build cũ); mobile 390 |

## Not covered

- Staging (nơi QA có thể đã thấy build cũ — cần QA xác nhận lại trên build mới).
- Bảng quyết toán/thu chi khác không thuộc "Chi tiết lô".
