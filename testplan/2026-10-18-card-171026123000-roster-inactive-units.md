# Case: 171026123000 — /hr/roster vẫn hiện unit INACTIVE sau khi deactivate ("QA Audit Unit 0914")

- Case ID: 2026-10-18-card-171026123000-roster-inactive-units-hidden
- Reported: ticket 171026123000-unaccented-seed-verifyfail — QA purge ĐÃ chạy
  trên staging (business_units deactivated 5/5) NHƯNG /hr/roster vẫn hiện
  "QA Audit Unit 0914" (không dấu): dropdown "Lọc theo bộ phận" vẫn liệt kê
  unit INACTIVE; cột BỘ PHẬN của driver còn link vẫn render tên unit INACTIVE.
- Owner decision (orchestrator, 2026-10-17): hướng (b) — ẩn unit INACTIVE
  khỏi roster (đúng nghĩa "deactivate"), rủi ro thấp nhất, không đụng data.
  Hướng (a) purge gỡ links/rename bị loại — KHÔNG sửa purge tool.
- Status: FIXED (18/10/2026)

## Reproduction

1. Có business_unit status INACTIVE (vd "QA Audit Unit 0914") và user DRIVER
   còn row trong user_business_unit_links trỏ tới unit đó (link không bị xóa).
2. Mở /hr/roster (Danh sách nhân sự) bằng role office staff
   (ADMIN/MANAGER/ACCOUNTANT).

Observed (pre-fix):
- Dropdown "Lọc theo bộ phận" liệt kê unit INACTIVE.
- Cột BỘ PHẬN của driver còn link render tên unit INACTIVE.
- Root cause: `listHrRoster()` (backend/src/services/user.service.ts) đọc
  user_business_unit_links verbatim (không join business_units.status) và trả
  `listBusinessUnits()` không lọc status; HrRosterPage map id→tên trên toàn bộ
  unit đó và derive dropdown options từ tập link của các dòng roster.

Expected (post-fix):
1. /hr/roster chỉ join/render business_units ACTIVE — dropdown "Lọc theo bộ
   phận" chỉ list unit ACTIVE (mục "Tất cả bộ phận" giữ nguyên).
2. Cột BỘ PHẬN chỉ render tên unit ACTIVE; driver chỉ link tới unit INACTIVE
   hiện '—' (hoặc trống), KHÔNG crash, driver vẫn hiện trong danh sách.
3. Nơi khác dùng unit INACTIVE hợp lệ giữ nguyên: BusinessUnitsManager ở
   /users vẫn liệt kê cả INACTIVE ("Lịch sử và các liên kết hiện có vẫn được
   giữ nguyên"); GET /auth/business-units không đổi.
4. Không sửa purge tool; không đổi data.

## Root cause + fix

- BE: `listHrRoster()` nạp link qua `loadUsersBusinessUnitIdsMap` (join
  business_units, chỉ status ACTIVE — đúng pattern read-projection sẵn có của
  file) và trả `businessUnits` ACTIVE-only. `/auth/users/roster` route không
  đổi.
- FE: `HrRosterPage` guard tại render — name map và dropdown options chỉ nhận
  unit ACTIVE (payload có rò rỉ cũng không hiển thị); id không resolve → '—'.
- Tests ghim hành vi:
  - BE `backend/src/tests/hr-roster-read.test.ts`: unit INACTIVE không nằm
    trong `roster.businessUnits`; link INACTIVE không nằm trong
    `businessUnitIds`; driver chỉ link INACTIVE vẫn có dòng + mảng rỗng.
  - FE `frontend/src/pages/HrRosterPage.test.tsx`: dropdown không liệt kê tên
    unit INACTIVE; cột BỘ PHẬN của driver chỉ-link-INACTIVE hiện '—'; driver
    link hỗn hợp chỉ hiện tên unit ACTIVE; không crash.
