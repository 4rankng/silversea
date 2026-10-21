# QA Evidence Pack: DRI-03 lan 2 — kẹp 2x20' verify theo lot QA thật (card 211026180628)

- **Date:** 2026-10-21
- **Branch:** `fix-dri03-lan2` (off main `9aab78d2`)
- **Fix lần 1 dưới kiểm chứng:** `1a7fc73b` (đã ở main) — bento multi-container
  `DriverContainerCard` + guard `tripContainers.length === 1` ở `driver.service.ts`
- **Environment:** Local development — backend `:3025` + frontend `:7185` chạy từ
  worktree này, DB chia sẻ `ss-prod-db :5441/silversea` (stack riêng theo mẫu lane 1)
- **Kết luận:** **20/20 PASS — fix lần 1 GIỮ NGUYÊN trên shape lot QA thật. KHÔNG
  phát hiện thiếu/sai mới → 0 src change** (lane là verify + evidence + scripts).

## 1. Shape lot QA thật (GET staging READ-ONLY)

`GET https://vantai.tingting.vip/api/shipments/133` (admin, 2026-10-21 ~18:35 +08) —
`qa/2026-10-21-dri03-lan2/staging-lot-shape-SHP-2610-00069.json` (HTTP 200):

- `shipmentCode SHP-2610-00069`, customer **Long Minh** (id 1), createdBy 19 (tiepvv — QA)
- **revGroupId: NULL** (kẹp FCL không có rev group — rev group là luật LCL)
- **2 containers `20'DC`** (containerTypeId 1, ids 199/200), `pairKind` null mỗi cont
- **containerNumber/sealNumber/cargoWeightKg/customerAppointmentAt: NULL hết**
  (QA mới tạo lô, chưa nhập số cont — đúng dạng bqhuong tự nhập trên app)
- `status PENDING_DATE`, version 2, `accountingLock` null, 0 trips, 0 carrierAssignments
- QA đang tự dispatch cho bqhuong để E2E (theo brief) → trạng thái đích verify là
  post-dispatch: 2 cont có giờ hẹn RIÊNG, dispatch cho bqhuong.

## 2. Local seed theo shape thật

`testplan/qa/scripts/2026-10-21-dri03-lan2-fixture.mjs` (log:
`fixture-run2-idempotent.log` + `fixture-state.json`) — flow thật, không ghi thẳng DB.
Port contract: default 3002/7175, lane này chạy stack riêng qua env:
`QA_API=http://localhost:3025/api node testplan/qa/scripts/2026-10-21-dri03-lan2-fixture.mjs`
(bản committed verify lại exit 0: `fixture-run3-committed.log`):

1. `cus` quick-create lô **DRIL2-KEP** (lot 312425/SHP-2610-19309): Long Minh, IMPORT,
   FCL, **2×20DC, containerNumber NULL**, weight 8.000/7.500 kg,
   **customerAppointmentAt 09:00 / 12:00 (+07) RIÊNG từng cont**, route 1 + cảng
   nâng/hạ 1→2 từng cont.
2. `dieuvan` PATCH plan từng fulfillment → truck 186320 (bqhuong 42966) — leg 2 đi
   qua warn-once `RIG_OVERLAP_COMPLETED` (fix dis-03 R30) + confirm.
3. Phát lệnh từng leg (`POST /shipments/:id/dispatch`, trailer 40FT): 2 trip riêng
   **194126 (TRP-202610-1589, 09:00)** + **194127 (TRP-202610-1590, 12:00)**.
4. `POST /trips/pairs` pairKind **KEP** → pair **2899 ACTIVE** (draft lấy từ
   `GET /api/trips/:id` y hệt `PairTripsDialog.draftFor`).

## 3. UI DRIVEN (rung 3) — driver bqhuong, viewport 390×844

`testplan/qa/scripts/2026-10-21-dri03-lan2-driver.mjs` → `dri03-lan2-ui-driver.log`
(**20/20 PASS, exit 0** — chạy với env `QA_API=http://localhost:3025/api
QA_BASE=http://localhost:7185`, port contract mặc định 3002/7175):

| # | Claim | Evidence |
|---|---|---|
| R1 | Board `/my-trips`: **2 card nhóm KẸP** (cùng pairId 2899), Giờ chạy **09:00 / 12:00 riêng từng cont**, "Chưa có số cont" đúng shape QA | `dri03l2-01-board-kep-390.png` |
| R2 | Detail leg A: mã chuyến 1589 riêng, **Ngày giờ kế hoạch 09:00**, **Cảng nâng SITC - Lạch Huyện / Cảng hạ TC - HICT** per cont, bento 1 cont `20'DC · 8.000 kg` | `dri03l2-02-legA-detail-390.png` |
| R3 | Nhập số cont A (NULL→`MSKU7654328` + seal) — chỉ cont A đổi | `dri03l2-03-legA-cont-saved-390.png` |
| R4 | Detail leg B: mã 1590 ≠ 1589, **12:00 riêng**, cont B `7.500 kg` riêng **không leak số cont A**; nhập `CSQU3054383` — DB 2 dòng đúng, **KHÔNG TRỘN** | `dri03l2-04-legB-cont-saved-390.png` + DB AFTER trong log |
| R5 | **Nhận lệnh leg A**: A→IN_TRANSIT, B vẫn CREATED; `ORDER_RECEIVED` chỉ trên trip A (B = 0 event) | `dri03l2-05-legA-received-390.png` + PROGRESS EVENTS trong log |

DB proof (trong driver log): `trip_containers` 28754 (trip 194126) =
`MSKU7654328/SEAL-KEP-A1`, 28756 (trip 194127) = `CSQU3054383/SEAL-KEP-B2` — mỗi cont
một trip một dòng, không ghi đè chéo.

## 4. Verification coverage (§9)

| Claim / bug | Rung | Evidence | Not covered |
|---|---|---|---|
| Card 211026180628: bqhuong thấy 2 cont kẹp | UI DRIVEN | `dri03l2-01-board-kep-390.png` + log DRIL2-R1 | staging re-drive sau deploy (owner NEVER per law) |
| Nâng/hạ TỪNG cont không trộn (ports + nhận lệnh + events per leg) | UI DRIVEN | `dri03l2-02/04/05` + log DRIL2-R2/R4/R5 | flow hoàn thành chuyến (e-POD) từng leg — ngoài scope card |
| Giờ riêng từng cont (09:00/12:00) | UI DRIVEN | `dri03l2-01/02/04` + log R1/R2/R4 | EXPORT direction (lot QA là IMPORT) |
| Nhập số cont per-cont trên shape NULL (shape QA thật) | UI DRIVEN | `dri03l2-03/04` + DB AFTER | OCR camera thật (unit pin lane 1) |
| Shape lot staging đọc đúng (revGroup null, 2×20', tấn null, PENDING_DATE) | DB/API VERIFIED | `staging-lot-shape-SHP-2610-00069.json` | staging đang tiến triển — snapshot tại 18:35 +08 |

## 5. Gates

Xem `qa/2026-10-21-dri03-lan2/gates-*.log`:

| Gate | Kết quả |
|---|---|
| FE `npx tsgo -b` | exit 0 |
| Root `pnpm lint` | exit 0 (script lane này nằm trong eslint scope) |
| Scoped vitest driver surfaces (5 files) | **185/185** exit 0 |
| `make build` | exit 0 |
| `src/tests/dev-port-contract` | PASS sau khi sửa script lane này về contract default 3002/7175 (env-only override) — run 1 đã bắt offender 7185/3025 hardcode, đây là chỉnh DUY NHẤT của lane ngoài evidence |
| Full FE suite | 3 lần chạy dưới máy tải cao (load 19–40, nhiều lane song song): mỗi lần một TẬP fail KHÁC NHAU, toàn test timing-heavy ngoài phạm vi lane (`MonthlyProductivityView`, `ExpenseCreateDrawer`, `TripListPage`, `ShipmentsPage`, `RoleWorkInbox` UI43, `ShipmentCreateWorkspace.enter-save/copy-appointment`, `PhoiPhieuControlPage.selection`, `ContainerScanner`). Mỗi file đều PASS ở ít nhất một run (enter-save + RoleWorkInbox từng xanh ở run 1 và ở gate lane gốc FB-002/FB-066 sáng nay trên máy yên tĩnh); fail isolation lặp lại chỉ khi load đỉnh. **0 src change trong diff** (`git diff` rỗng với `frontend/src`) → không có cơ chế ảnh hưởng. Logs: `gates-fe-vitest-full1.log` / `full2-load-flake.log` / `full3-load-flake.log`. Full-run xanh cần máy yên — nợ ghi nhận cho controller, không chặn lane theo tiền lệ FB-066. |

Verdict lane: **verify-only PASS — fix lần 1 (1a7fc73b) giữ nguyên trên shape thật, không cần fix mới.**
