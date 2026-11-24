# SIL-916 — Danh sách nhân sự đủ 64 người + nút Lập phiếu thu (2026-11-24)

Board: SIL (plan.tingting.vip), ticket SIL-916 (id 1075). Trunk `main`, no branch.
Source: audit KB 24/11 (`/tmp/kb-conformance-sil-2026-11-24.md`) mục **6.9** (§6.4, §6.5) và
mục **6.3** (§6.1, §6.2). Doctrine: `uiux` (POLISH), house design law book
(`docs/design-system/README.md`, `docs/design-guidelines.md`).

## Regression cases

| ID | Ticket | Surface | Expected |
|---|---|---|---|
| TC-916-ROSTER-01 | SIL-916 | `GET /api/auth/users/roster` (kế toán `hoapt`) | Payload có **64** nhân sự (`total` = 64, `items` = 64): 41 Lái xe + 23 nhân sự văn phòng (Chứng từ, Điều vận, Giao nhận, Kế toán, Quản trị). Không có dòng `CUSTOMER` (tài khoản portal khách hàng không phải nhân sự). Trước đây payload chỉ có 41 dòng Lái xe. |
| TC-916-ROSTER-02 | SIL-916 | `/hr/roster` → cột **Bộ phận** | Mỗi dòng nêu đúng một bộ phận: tên đơn vị phụ trách ACTIVE khi dòng có liên kết đơn vị; nếu không có đơn vị thì dùng tên vai trò chuẩn (`ROLE_LABELS`: Lái xe / Vận hành / Kế toán / Chứng từ / Điều vận / Quản trị viên). Cột không bao giờ để trống `—`. |
| TC-916-ROSTER-03 | SIL-916 | `/hr/roster` → bộ lọc **Bộ phận** | Dropdown liệt kê đúng các bộ phận mà bảng đang mang (mỗi đơn vị ACTIVE đang dùng + tên vai trò của dòng không có đơn vị) cộng "Tất cả bộ phận". Chọn một bộ phận chỉ giữ lại các dòng của bộ phận đó. Đơn vị INACTIVE không bao giờ hiện. |
| TC-916-ROSTER-04 | SIL-916 | `/hr/roster` với `hoapt` | Bộ lọc "Bộ lọc" không chặn: `hr_roster` vẫn grant cho ACCOUNTANT/MANAGER/ADMIN. Roster là danh sách nhân sự của công ty, KHÔNG phải bảng chấm công — `/timesheet`, `/salary` và bảng chấm công lái xe vẫn CHỈ LÁI XE (ruling 2026-10-09 giữ nguyên phạm vi). |
| TC-916-PHOI-01 | SIL-916 | `/accounting/phoi-phieu` → phần **Báo cáo thu / trả phơi** | Có đủ **hai** nút **Lập phiếu thu** và **Lập phiếu chi** ở phần báo cáo dưới màn hình (KB §6.1/§6.2: "có đủ hai nút Lập phiếu thu và Lập phiếu chi để Kế toán lập phiếu trực tiếp cho hai chiều thu/trả"). Trước đây màn hình không có nút "Lập phiếu thu" nào. |
| TC-916-PHOI-02 | SIL-916 | `/accounting/phoi-phieu` → bấm **Lập phiếu thu** | Mở ngăn kéo các lô chưa thanh toán theo chiều Phải thu: ô STT có ô vuông tích chọn + chọn all, cột Tiền nâng / Tiền hạ / PS khác / Phải thu / Đã thu / Còn lại, ô STK và nút lập phiếu. Lập phiếu vẫn đi qua `createPhoiPhieuVoucher` (tripIds + direction + STK). |
| TC-916-PHOI-03 | SIL-916 | `/accounting/phoi-phieu` → bấm tên khách hàng / "Lô chưa thanh toán" | Luồng **từng đối tác** cũ vẫn mở đúng ngăn kéo lô chưa thanh toán của đối tác đó (không hồi quy). |

## Ruling ghi nhận

- **Supersede (SIL-916):** projection `listHrRoster()` (backend) và `HrRosterPage`
  (frontend) bị thu hẹp còn role DRIVER theo ruling chủ sản phẩm 09/10 ("chấm công chỉ
  dành cho lái xe / no office staff"). Ruling đó có đối tượng là **chấm công / lương**
  (`/timesheet`, `/salary`, `attendance.service.ts`) — những bề mặt đó GIỮ NGUYÊN
  driver-only. Danh sách nhân sự là **danh bạ nhân sự**: KB §6.4/§6.5 (24/11) yêu cầu
  nêu đủ các bộ phận (Lái xe, Vận hành giao nhận, Chứng từ, Điều vận, Kế toán), và
  yêu cầu mới của chủ sản phẩm (`docs/prd/PhanHeKeToan.md` §6) là "hiển thị tách
  văn phòng / lái xe" — tách, KHÔNG phải ẩn. Vì vậy roster nay liệt kê mọi nhân sự và
  cột Bộ phận / bộ lọc Bộ phận tách văn phòng với lái xe.
- Ruling 2026-10-17 (đơn vị phụ trách INACTIVE không được hiện trên roster) giữ nguyên:
  đơn vị "Ngừng sử dụng" không bao giờ là tên bộ phận hay lựa chọn bộ lọc.
