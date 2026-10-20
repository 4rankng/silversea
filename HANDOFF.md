# HANDOFF — 2026-10-20 — tokhai A.1 rb2: Thêm container auto-copy Tuyến/Nhà xe/Nâng/Hạ (201026124500)

Controller: agent, worktree `/Users/dev/.paseo/worktrees/1njkloyy/fix-tokhai-a1-rb2`,
branch `fix-tokhai-a1-rb2` (off `main` = `16f0e51a`). Updated 2026-10-20.

**Status**: DONE — fix + tests + rung-3 evidence; commit+push to `fix-tokhai-a1-rb2`
(ship.sh merges later — NOT merged to main here).

- **201026124500 (verify-fail lan-2, card 181026185900 A.1)**: round-2 QA saw
  Tuyến/Nâng/Hạ (có thể Nhà xe) trống trên dòng mới của "Thêm container" (CUS
  drawer). Root cause — NOT a 57d253ff..16f0e51a regression (no commit in the
  range touches the add path; proven by diff) but two standing gaps:
  (1) `addFieldsSeed` là field whitelist {containerTypeId, cargoWeightKg,
  customerAppointmentAt} — Tuyến/Nhà xe/Nâng/Hạ không bao giờ vào draft, add
  row hiển thị trống (checkpoint QA screenshot); (2) **Nhà xe không có copy
  path nào** — carrier plan sống trên `shipment_fulfillments.planned*`,
  `createFulfillmentForAddedContainer` đẻ fulfillment không plan → dòng mới
  luôn "Nhà xe trống" (round-1 verify PASS là false positive ở field này:
  harness `inheritOk` không kiểm tra carrier).
- **Fix (data-flow)**: seed mở rộng đủ bộ A.1 (route/lift/drop/carrier + weight
  + giờ hẹn; lift/drop id guard theo `selectors.ports` — chặn snapshot-id khác
  catalog rơi vào `pickupPortId`); add row render ô seeded Tuyến/Nhà xe/Nâng/
  Hạ; submit gửi explicit mọi field (`containerTypeId` pick-or-null — loại cont
  KHÔNG copy theo law restated, 191026100000 superseded); wire thêm
  `carrierType`/`externalCarrierId` (nullable-optional, paired); BE
  `resolveAddedContainerCarrierPlan` (pure, unit-pinned 6/6) lấy plan từ wire
  hoặc sibling fulfillment đầu tiên, validate qua `loadExternalCarrier`, stamp
  vào fulfillment mới. Biển số/xe KHÔNG copy (ngoài danh sách A.1).

**Gates**: scoped vitest `CusContainerLedger.test.tsx` 38/38 · FE `tsgo -b`
EXIT 0 · BE `tsc --noEmit` EXIT 0 · BE `pnpm test` green (unit 303/303 + integration
326/326) · root lint 0 · `make build` ok · full FE suite 5271: 5269 pass, 2
production-bundle CSS contracts fail chỉ vì worktree chưa build `dist` — 6/6
green standalone sau `make build`. `qa/2026-10-20-201026124500/gates.log`.

**UI rung-3**: BEFORE staging 16f0e51a (lot 174, ref MSBU1245654 đầy đủ):
Tuyến/Nâng/Hạ/Trọng lượng copy nhưng **Nhà xe BLANK** + form-seed cells trống
(`qa/2026-10-20-201026124500/201026124500_ui-*`). AFTER local dev (:7176→:3002,
lot 310177 ref đủ 6 field): seeded form hiện Tuyến/Nhà xe/Nâng/Hạ trước
submit; probe number-only → `a1_verdict` all COPIED (kể cả Giờ hẹn), Loại cont
"Chọn loại cont" (không copy), cleanup sạch — `A1_ALL_COPY_PASS`
(`qa/2026-10-20-201026124500/local-after/`).

**Open**: staging re-verify của QA trên build chứa fix này (QA round-3) —
đặc biệt confirm checkpoint họ nhìn là dòng form thêm (giờ đã seeded) hay dòng
sau lưu. Loại cont KHÔNG copy theo ticket 201026124500 (restated 181026185900
A.1); nếu card docx khi hydrate nói khác (FB-111 copy loại cont) thì chỉ cần
đổi lại seed + payload type — test đã pin hành vi hiện tại.
