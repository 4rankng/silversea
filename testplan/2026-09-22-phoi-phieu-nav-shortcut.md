# Thiếu liên kết "Kiểm soát phơi phiếu" + shortcut trỏ view cũ (2026-09-22)

## Nguyên nhân và phạm vi

QA audit tài liệu "các chi phí.pdf" mục 3.b (card Kanban-PROD `20260922_5-dieu-huong-thieu-phoi-phieu`,
ảnh đính kèm trong card):

1. Menu điều hướng vai trò Kế toán / Quản trị hoàn toàn thiếu mục vào trang
   `/accounting/phoi-phieu` ("Kiểm soát phôi phiếu - Tiền đường", card 20260921_12) — trang đã xây dựng
   nhưng không có đường vào từ sidebar.
2. Nút tắt "Phơi phiếu / tiền đường" trên thanh shortcut của `/accounting` (Tổng quan kế toán) vẫn trỏ
   về view cũ `/accounting/expenses?view=work`.

Nguyên nhân gốc (HEAD `c9eb7756`): `getNavItems` trong `frontend/src/components/Layout.tsx` không có mục
`phoi-phieu` cho ADMIN/ACCOUNTANT; `AccountingWorkspaceRoot.tsx` hard-code href cũ trong thanh shortcut.
Route `/accounting/phoi-phieu` + guard `financeReaderOnly` đã tồn tại (`App.tsx`) — lỗi là khả năng
triển khai (discoverability), không phải lỗi phân quyền.

Phạm vi sửa: 2 nav item (ADMIN + ACCOUNTANT), 1 href. Không đổi route, không đổi RBAC, không đổi
màn hình đích. Ghi chú ngoài phạm vi: tab "Phơi phiếu / tiền đường" cũ trong
`/accounting/expenses?view=work` **giữ nguyên** (card không yêu cầu xóa) — có thể là follow-up dedupe.

## Bộ case

### TC-NAVPHOI-01 — Sidebar Kế toán / Quản trị có mục "Kiểm soát phơi phiếu"

- **Vai trò:** `ketoan` (Kế toán) và `admin` (Quản trị) — local dev, password `Abc123`
- **Mức độ:** P0
- **Các bước:** đăng nhập → nhìn sidebar trái (mục "Công nợ & Dòng tiền") → click mục
  "Kiểm soát phơi phiếu".
- **Kết quả mong đợi (Pass):** mục hiển thị rõ nhãn "Kiểm soát phơi phiếu"; click điều hướng đến
  `/accounting/phoi-phieu`, trang mở với tiêu đề "Kiểm soát phơi phiếu - Tiền đường".
- **Kỳ vọng sai (Fail nếu):** mục không có trong sidebar, hoặc click không đổi URL / ra trang khác.

### TC-NAVPHOI-02 — Nút tắt "Phơi phiếu / tiền đường" trỏ đúng trang chuyên dụng

- **Vai trò:** `ketoan` (Kế toán)
- **Mức độ:** P0
- **Các bước:** mở `/accounting` → click nút tắt "Phơi phiếu / tiền đường" trên thanh
  "Nghiệp vụ kế toán".
- **Kết quả mong đợi (Pass):** điều hướng thẳng vào `/accounting/phoi-phieu`.
- **Kỳ vọng sai (Fail nếu):** vẫn ra `/accounting/expenses?view=work` (view cũ) hay trang khác.

### TC-NAVPHOI-03 — Các vai trò khác không đổi menu

- **Vai trò:** `dieuvan` (Điều vận) — đối chứng tiêu cực; kỳ vọng chung cho mọi vai trò khác
  MANAGER/CUS/OPS/DRIVER/CUSTOMER được pin bằng test `Layout.test.ts` (ma trận label+path theo vai trò).
- **Mức độ:** P1
- **Các bước:** đăng nhập `dieuvan` → xem sidebar.
- **Kết quả mong đợi (Pass):** không có mục "Kiểm soát phơi phiếu"; các mục khác như cũ.
- **Kỳ vọng sai (Fail nếu):** mục xuất hiện cho vai trò ngoài ADMIN/ACCOUNTANT, hoặc menu vai trò khác
  thay đổi.
