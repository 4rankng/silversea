# qa/2026-10-21-fb002-lan3 — FB-002 lần 3 (card 211026034109)

Card TODO 211026034109 "FB-002 enter ở ô giờ không lưu, mất trắng input
order". Card .docx EDEADLK-unreadable cả 3 lần đọc (02:50Z, 19:52Z, 20:33Z) —
scope theo title + brief.

## Verdict (reproduce trên build lỗi 9d60f507 — staging, CUS tiepvv)

KHÔNG có surface CUS nào trên build hiện tại wipe giá trị ô giờ khi Enter —
toàn bộ "các lần trước" surfaces đều PASS (bằng chứng dưới đây). LỖI THẬT duy
nhất tìm được: **/shipments/new — Enter ở ô giờ sau khi datetime hoàn chỉnh =
PHÍM CHẾT IM LẶNG** (không lưu, không phản hồi) vì cả hai nút submit nằm ngoài
`<form>` và mọi button trong form là `type="button"` → implicit submission
không bao giờ chạy. QA ở form tạo lô: Enter không phản ứng → rời trang → TOÀN
BỘ input đã nhập mất trắng (form không persist) — khớp triệu chứng card
"không lưu + mất trắng input".

Lesson 63a3dfc4 lặp lại đúng: các surface được report trước đó (dialog) đều
xanh trên build hiện tại.

## BEFORE (staging, build 9d60f507, CUS tiepvv)

| File | Probe | Kết quả |
|---|---|---|
| `staging-repro-driver.log` / `.json` + `R1..R4*.png` | Dialog "Chỉnh sửa Lịch trình" (/shipments): R1 autoFocus+Cmd+A, R2 click+"1430" (advance), R3 click+"14:30", R4 no-date guard | 4/4 PASS — Enter lưu đúng, guard hiện lỗi + giữ giá trị |
| `staging-detail-driver.log` + `S1_*.png` | /shipments/:id → Sửa lô → Lịch trình: click giờ + "1430" + Enter | PASS — PUT fired, saved 14:30+07:00, dialog đóng |
| `staging-drawer-driver.log` + `D1..D3*.png` | Drawer: D3 popover giờ hẹn type-over + Enter; D1 add-row giờ+Enter (submit); D2 add-row full datetime + Enter | D3 PASS (POST line-update 16:30+07:00, restore 200); D1/D2 đúng luật add-row (POST containers mang giờ đúng wire; fail chỉ do checksum ISO test container — server-side) |
| `staging-new-driver.log` + `N0/N1/N2*.png` | /shipments/new: N1 giờ-only Enter (guard visible, giữ giá trị); N2 **full datetime + Enter** | **N2 = BUG: `apiHits=0`, không summary, không focus move — dead key im lặng** |
| `staging-mobile-driver.log` + `M1..M2*.png` | Mobile 390: M1 no-date guard ×2 Enter, M1b giờ+ngày Enter, M2 with-date Enter | 3/3 PASS (PUT fired, restore 200) |

## AFTER (local dev — worktree fix, frontend :7176 → backend :3002 của stack
đang chạy, CUS `cus`; container khác vì `make dev` conflict ss-prod-db của
checkout chính — không đụng container người khác)

| File | Probe | Kết quả |
|---|---|---|
| `A1_after-datetime.png` → `A1_after-enter.png` + `local-after-driver.log` | A1: form thiếu 5 trường + datetime hoàn chỉnh 16:30 22/11/2026 + **Enter** | **FIXED**: summary "Cần bổ sung 5 thông tin" hiện, focus vào field thiếu, MỌI input giữ nguyên (customer/booking/cont/16\|30\|22\|11\|2026) — trước fix là dead key |
| `A2_after-enter.png` + `local-after-driver.log` | A2: form đủ + Enter ở ô giờ (focus yyyy) | **FIXED**: `POST /api/shipments/quick` fired → lot **311952** (SHP-2610-18944), navigate `/shipments/311952` |
| `A2_db-side-effect.txt` | DB proof | container TEMU1234565 `customerAppointmentAt = 2026-11-22T09:30:00.000Z` = **16:30 +07:00** — đúng giờ đã gõ |

## Gates

- `gates_tsgo-fe.txt` — `cd frontend && npx tsgo -b && pnpm exec tsc --noEmit` → exit 0.
- `gates_vitest-fe-full.log` — trước build: 5348/5352 (3 fail numeric-identity
  thiếu dist/assets + 1 flake dialog) + dev-port-contract. Sau `make build`:
  `gates_vitest-fe-full-rerun.log` **5351/5352** — fail duy nhất
  `dev-port-contract` blame script **FB-033** (`2026-10-21-fb033-*`, merge
  19a9cc5b trên main) — pre-existing, không phải của branch này, cần card
  riêng cho owner FB-033.
- Scoped mới `ShipmentCreateWorkspace.enter-save.test.tsx` **3/3** (red-green:
  stash fix → 2 fail đúng dead key; fix → 3 pass).
- `gates_make-build.log` — `make build` exit 0.
- `gates_lint.log` — `pnpm lint` exit 0.
- BE không đụng — không gate BE.

## Driver logs

`testplan/qa/scripts/2026-10-21-fb002-lan3-staging-{repro,detail,drawer,new,mobile}.mjs`,
`2026-10-21-fb002-lan3-local-after.mjs` (port contract: staging URLs env-mặc-định,
local 7175/3002 mặc-định — không hardcode port lạ).
