# Case QA-2026-10-21-dri03-kep-driver-view — logic chuyến kẹp trên app lái xe

Card 211026132357 (dri-03). QA không verify được trên staging vì bqhuong
0 trips (data mất từ đợt sync) → repro bằng data LOCAL tự tạo.

## Trạng thái trước fix

Chuyến kẹp (1 chuyến 2 cont, vd 2×20DC) trên app lái xe (role DRIVER, user
bqhuong) hiển thị/điều khiển sai logic: cần audit driver trip view + API
projection cho kẹp — hiển thị 2 cont, nâng/hạ từng cont, không trộn.

## Expected (sau fix)

| ID | Bước | Kỳ vọng |
|---|---|---|
| DRI03-R1 | Driver (bqhuong) mở trip kẹp 2 cont trên app | hiển thị ĐỦ 2 cont, mỗi cont 1 dòng riêng, đúng số cont |
| DRI03-R2 | Nâng cont A (leg nâng) | chỉ cont A gắn cờ nâng; cont B không bị đổi |
| DRI03-R3 | Hạ cont B (leg hạ) | chỉ cont B gắn cờ hạ; cont A giữ nguyên — KHÔNG trộn số cont giữa các leg |
| DRI03-R4 | API projection trip kẹp | payload chứa 2 cont với identity ổn định (không index-first, không sort lệch giữa 2 lần gọi) |
| DRI03-R5 | Test unit projection/render | pin: per-container lift/drop keying cho trip kẹp |
| DRI03-R6 | UI 390px mobile | bằng chứng mobile width cho R1-R3 |

## Verify

- Script UI drive: `testplan/qa/scripts/2026-10-21-dri03-ui-drive.mjs`
- Environment: Local development (frontend 7185, backend 3025, postgres 5441)
- Role/Driver: DRIVER (`bqhuong`, user 139156, driver 42966)
- Trip fixture: 194048 (TRP-202705-0018, 2×20DC FCL-KEP, cont 1: MSKU7654328, cont 2: CSQU3054383)

| Claim / bug | Rung | Evidence | Not covered |
|---|---|---|---|
| DRI03-R1 kẹp 2-cont render | 3 (UI DRIVEN) | `qa/2026-10-21-lcl01-dri03/dri03-01-kep-view-390.png`, `qa/2026-10-21-lcl01-dri03/dri03-ui-driver.log` | Staging (local dev only) |
| DRI03-R2 cont 1 edit & patch | 3 (UI DRIVEN) + Unit | `frontend/src/components/trip/DriverContainerCard.test.tsx` (DRI03-R2 case) | Real physical camera capture |
| DRI03-R3 cont 2 edit & patch (no overwrite cont 1) | 3 (UI DRIVEN) | `qa/2026-10-21-lcl01-dri03/dri03-02-kep-edited-390.png`, `qa/2026-10-21-lcl01-dri03/dri03-ui-driver.log` | Other mobile viewports (tested 390×844) |
| DRI03-R4 API projection stable identity & DB persistence | 2 (DB/API VERIFIED) | `qa/2026-10-21-lcl01-dri03/dri03-ui-driver.log` (DB before/after queries & API payload assert) | N/A |
| DRI03-R5 Vitest unit tests | Unit | `frontend/src/components/trip/DriverContainerCard.test.tsx` (28/28 tests passed) | N/A |
| DRI03-R6 Mobile 390px UI capture | 3 (UI DRIVEN) | `qa/2026-10-21-lcl01-dri03/dri03-01-kep-view-390.png`, `qa/2026-10-21-lcl01-dri03/dri03-02-kep-edited-390.png` | Desktop browser (mobile portal is 390px) |

## Not covered

- Staging execution (card note: data mất từ đợt sync, verified local dev per brief).
- Tablet/desktop widths (app lái xe designed for mobile width 390px).
- Camera hardware OCR (scanner mocked in unit test, file-based OCR flow in driver Client).

