# Case QA-2026-10-04-333 — Lỗi fetch danh sách không hiện lỗi, trang thành "0 mục" (card 20261004_333)

- Card: 20261004_333-silent-failure-renders-empty (UI bug P3)
- Environment: local dev (:7175) for DEV evidence; staging https://vantai.tingting.vip for QA rung
- Account: dungnv / Abc123 (Điều vận) — hoặc tài khoản admin Khai báo
- mutates: none (read-only navigation + retry click)

## Repro (pre-fix)
1. Đăng nhập, mở DevTools → Network, chặn `GET /api/shipments/operational-sites/admin` (Block request URL).
2. Vào Khai báo → Nhà máy / Kho (`/config/factories`).
3. Quan sát: khung "Đang tải…" kéo dài (~7s, React Query retry 3 lần), sau đó trang rơi về **"0 mục"** + thông báo rỗng "Chưa có nhà máy / kho nào…" — không phân biệt được với catalog thật sự trống. Không có thông báo lỗi, không có nút thử lại.

## Expected (post-fix)
- Query lỗi → **Alert "Không thể tải danh sách nhà máy / kho"** + nút **"Thử lại"** gọi lại refetch; KHÔNG render "0 mục"/"Chưa có nhà máy / kho nào…" khi query lỗi.
- Đang tải → giữ "Đang tải…".
- Query thành công 0 items → giữ nguyên empty-state hiện có ("Chưa có nhà máy / kho nào. Dùng nút "Tạo mới"…", "0 mục").
- Cùng lớp (AC4): mọi trang trong `frontend/src/pages/config/**` render lỗi như rỗng đã fix — penalty-reasons (list + KPI "0 lượt"), debit-note-templates (list + "0 mẫu"), debit-note-templates/:id (editor trắng), trucks/:id/owners ("0 đối tác"), company-info ("Chưa cấu hình" first-save form), trip-expense (defaults-as-config + save), quotations (empty-state song song Alert + lịch sử phiên bản im), fuel-price-periods (banner chờ duyệt im), customer form (select mẫu rỗng im). Instance ngoài pages/config/** → REPORT cho lead.

## Rungs
- TEST VERIFIED (red-first, watched failing at HEAD): `FactoriesConfigPage.test.tsx` error-branch red (render-on-error = "0 mục" + empty copy) → green; empty-branch + loading-branch tests green. Class sweep: 1 error-branch regression test per fixed instance (10 test files).
- UI DRIVEN (visual rung, lead): Network-block repro trên theo Expected ở trên; matrix `/config/factories` × with-data/empty/error; lặp lại error case ở `/config/penalty-reasons`, `/config/debit-note-templates`, `/config/company-info`.

## Status
- [x] TEST VERIFIED rung (unit/regression suite green, tsc clean for touched files)
- [ ] UI DRIVEN visual rung (lead) — 04/10 pending
