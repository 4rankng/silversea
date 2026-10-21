# Regression Pack — 12 Playwright spec cho bề mặt từng flappy R14–R29

Mỗi spec pin một ticket đã fail lặp lại qua các round QA, phát hiện regression
**trước khi QA thấy**. Mục tiêu: zero QA rejection / zero customer complaint.

## Chạy local (bắt buộc)

```bash
make dev          # frontend :7175 · api :3002 · db :5441 (contract Makefile)
pnpm reg:local    # từ repo root — typecheck e2e + chạy cả pack
```

- Stack **LOCAL ONLY** — không trỏ vào staging (staging data immutable, user
  rule 21/10). Config đọc `REG_BASE_URL`/`REG_API_URL` (mặc định 7175/3002).
- Tài khoản local dev-seed (`testplan/testaccounts.txt`, mật khẩu `Abc123`):
  `admin`, `cus`, `dieuvan`, `ketoan`, `laixe`…
- Fixture tự tạo qua API local trong mỗi run (lô `REGPK-*`, serial theo thời
  gian, cửa sổ kế hoạch năm 2027) — không phụ thuộc data staging; các spec
  dùng xe nội bộ riêng (`claimTrucks`) để không đụng guard trùng lịch nhau.
- Evidence screenshot/DB proof ghi vào `qa/<date>-regpack/` ở repo root.
- Báo cáo lần chạy gần nhất: `pnpm --dir frontend reg:local:report`.

## Phạm vi (12 ticket)

| Spec | Ticket | Bề mặt pin |
|---|---|---|
| `fb002-enter-save.spec.ts` | FB-002 | Enter ô Giờ (đủ ngày+giờ) lưu lịch — matrix 3 case (có/không hai chấm, picker mở) |
| `fb020-driver-cang-ha.spec.ts` | FB-020 | Driver `/my-trips/:id`: Cảng hạ/Địa chỉ giao hàng map đúng (portless + control) |
| `fb030-segment-advance.spec.ts` | FB-030/075 | `/shipments-detail` ledger: "1430" xong focus sang Ngày, "14" advance tháng |
| `fb045-gio-hen-clip.spec.ts` | FB-045 | Dialog Chi tiết container: cột GIỜ HẸN đọc trọn @1024/1440 (2 drawer) |
| `fb061-demo-bu-users.spec.ts` | FB-061 | `/users`: tombstone không lộ, demo-seed local còn nguyên (purge không over-block) |
| `fb063-header-one-line.spec.ts` | FB-063 | Header bảng container `/shipments/new` 1 dòng (nowrap) @1024/1440 |
| `fb066-quickadd-bks.spec.ts` | FB-066 | Nút "+ Thêm nhanh" BKS trong dialog Phân bổ nhà xe (LCL + FCL), máy có localStorage cũ |
| `fb081-kep-reassign.spec.ts` | FB-081 | Phân xe lại KEP: dialog mở được, đổi rig → cả pair tự theo (propagate) |
| `fb093-tach-nhom-prefs.spec.ts` | FB-093 | `/accounting/chot-debit`: saved prefs ẩn cột không chôn nút Tách nhóm; tách nhóm giải tán đúng luật |
| `fb096-bill-lookup.spec.ts` | FB-096 | Thêm cược: tra cứu Bill theo 4 số cuối → autofill → Lưu dòng persist |
| `fb111-add-container-copy.spec.ts` | A.1/FB-111 | "Thêm container" @Tổng quan copy Tuyến/Nhà xe/Nâng/Hạ từ dòng cont |
| `fb113-document-order.spec.ts` | FB-113 | `/shipments/:id` header: Bill/Booking → Số tờ khai → Nhập/Xuất → Hãng tàu |

Chưa wire vào `ship.sh` gates (chờ duyệt runtime) — đây là script standalone.

## CI

Pack chạy được trong CI: cần backend+db+frontend local (docker compose
`docker-compose.dev.yml`) rồi `pnpm reg:local`. Playwright browser:
`npx playwright install chromium`.
