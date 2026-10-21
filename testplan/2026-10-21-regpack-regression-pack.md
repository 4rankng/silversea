# Regression Pack 2026-10-21 — 12 Playwright spec cho bề mặt từng flappy R14–R29

Task brief (owner, 21/10): đóng gói 12 ticket fail lặp lại thành Playwright
specs chạy LOCAL + CI, phát hiện regression trước khi QA thấy. Goal: zero QA
rejection / zero customer complaint.

## Case IDs & mapping

| Case | Spec (frontend/e2e/regression/) | Pin |
|---|---|---|
| REGPACK-FB002 | fb002-enter-save.spec.ts | Matrix 3 case Enter-ô-Giờ (có/không ":", picker mở) — mỗi case lưu lịch + toast + plannedReturnAt mới |
| REGPACK-FB020 | fb020-driver-cang-ha.spec.ts | Driver /my-trips/:id portless: Cảng hạ = tên điểm trả; control có cảng: 2 hàng riêng |
| REGPACK-FB030 | fb030-segment-advance.spec.ts | Ledger /shipments-detail: "1430" → focus dd; "14" → advance mm2 |
| REGPACK-FB045 | fb045-gio-hen-clip.spec.ts | 2 drawer "Chi tiết container": cột GIỜ HẸN không bị che @1024/1440 (elementFromPoint probe) |
| REGPACK-FB061 | fb061-demo-bu-users.spec.ts | /users: fixture QA tạo→hiện (control), soft-delete→biến mất; demo-seed local còn nguyên |
| REGPACK-FB063 | fb063-header-one-line.spec.ts | .csc-container-table thead nowrap + 0 label wrap @1024/1440 |
| REGPACK-FB066 | fb066-quickadd-bks.spec.ts | "+ Thêm nhanh" BKS: dialog Phân bổ nhà xe (LCL) + editor /dispatch-detail (FCL), máy có localStorage cũ |
| REGPACK-FB081 | fb081-kep-reassign.spec.ts | Cặp KEP (plan cả 2 → issue cả 2 → POST /trips/pairs KEP): dialog Phân xe lại mở + đổi rig → cả pair propagate (DB proof) |
| REGPACK-FB093 | fb093-tach-nhom-prefs.spec.ts | chot-debit + stored prefs ["container","cuocThu"]: cột container tự hiện, nút Tách nhóm visible, click tách → rev_group_id NULL cả 2 lô |
| REGPACK-FB096 | fb096-bill-lookup.spec.ts | Thêm cược: gõ 4 số cuối bill → suggestion → autofill → Lưu dòng → GET deposits có row |
| REGPACK-FB111 | fb111-add-container-copy.spec.ts | Drawer Tổng quan "Thêm container": add row seed Tuyến/Nhà xe/Nâng/Hạ; persisted row carry đủ (API readback) |
| REGPACK-FB113 | fb113-document-order.spec.ts | /shipments/:id header: 4 label liền kề đúng thứ tự + Số tờ khai = số lô |

## Phát hiện trong lúc xây pack (ghi nhận, không đổi behavior)

- FB-081: cặp KẸP KHÔNG được chuyển sang nhà xe ngoài — server 409 "Cặp kẹp
  phải chạy bằng xe nội bộ" (owner law). Spec pin đúng R2: đổi RIG (xe + lái
  xe, vẫn OWN) → chân kia tự theo.
- FB-063: header bảng workboard /shipments là `white-space: normal` THEO
  THIẾT KẾ (colgroup %); luật nowrap của FB-063 (181026021137, 201026101500)
  áp cho `.csc-container-table` (/shipments/new) — spec pin đúng bề mặt đó.

## Chạy & evidence

- `make dev` rồi `pnpm reg:local` (root). 17/17 test pass = 12/12 spec.
- Evidence: `qa/2026-10-21-regpack/` (45 files: screenshots per step, DB
  proof txt/json, run log, gates log). qa/ git-ignored theo AGENTS §7.
- KHÔNG wire vào ship.sh gates (chờ owner duyệt runtime) — standalone script.
