# Case QA-2026-10-21-dri03-lan2 — kẹp 2x20' verify lần 2 theo ĐÚNG lot QA (card 211026180628)

Lan 2 của case `case-QA-2026-10-21-dri03-kep-driver-view.md` (card 211026132357).
Lan 1 verify trên fixture tự seed (1 trip 2 cont, số cont có sẵn); QA phản hồi cần
verify theo **ĐÚNG lot QA thật** đang dựng trên staging: lô kẹp 133 /
SHP-2610-00069 (2x20'), QA tự dispatch cho bqhuong để E2E. Staging READ-ONLY —
verify trên LOCAL với seed tương tự shape thật.

## Shape lot QA thật (GET staging read-only 2026-10-21)

Long Minh · revGroupId NULL · 2 cont 20'DC · containerNumber/seal/weight/
appointment NULL · status PENDING_DATE · chưa có trip. Kẹp qua dispatch thật =
**2 trip (mỗi cont 1 trip) ghép KEP pair cùng rig**, mỗi trip 1 trip_container
riêng, giờ chạy riêng theo giờ hẹn từng cont.

## Expected

| ID | Bước | Kỳ vọng |
|---|---|---|
| DRIL2-A1 | API journey-board | 2 leg cùng 1 ACTIVE KEP pair, scheduledAt khác nhau, containerNumber null |
| DRIL2-R1 | bqhuong mở /my-trips (390px) | 2 card nhóm KẸP, Giờ chạy riêng 09:00/12:00, "Chưa có số cont" |
| DRIL2-R2 | Detail leg A | Mã chuyến riêng, Ngày giờ kế hoạch 09:00, Cảng nâng/hạ của cont A, bento đúng 1 cont (đúng loại + tải trọng) |
| DRIL2-R3 | Nhập số cont A | Chỉ trip_container của leg A đổi |
| DRIL2-R4 | Detail + nhập leg B | Giờ 12:00 riêng, mã riêng, cont B không leak số A; DB 2 dòng đúng — không trộn |
| DRIL2-R5 | Nhận lệnh leg A | A IN_TRANSIT, B vẫn CREATED; progress event chỉ ở A |

## Verify (2026-10-21, local :3025/:7185, DB 5441)

- Fixture theo shape thật: `testplan/qa/scripts/2026-10-21-dri03-lan2-fixture.mjs`
- Driver rung 3: `testplan/qa/scripts/2026-10-21-dri03-lan2-driver.mjs` — **20/20 PASS exit 0**
- Evidence: `qa/2026-10-21-dri03-lan2/` (5 PNG 390px + driver log + DB proof +
  staging shape snapshot + fixture log)
- Fixture data để lại (dev DB 5441): lô 312425/SHP-2610-19309 BL DRIL2-KEP,
  trips 194126/194127, KEP pair 2899, truck 186320 (bqhuong), trailer 1.

| Claim / bug | Rung | Evidence | Not covered |
|---|---|---|---|
| DRIL2-R1 2 card KẸP giờ riêng | UI DRIVEN | dri03l2-01-board-kep-390.png + log | staging re-drive sau deploy |
| DRIL2-R2/R4 nâng/hạ + giờ per cont | UI DRIVEN | dri03l2-02/04 + log | direction EXPORT |
| DRIL2-R3/R4 nhập số cont không trộn | UI DRIVEN | dri03l2-03/04 + DB AFTER trong log | OCR camera thật |
| DRIL2-R5 nhận lệnh không kéo theo leg B | UI DRIVEN | dri03l2-05 + events trong log | hoàn thành chuyến/e-POD từng leg |
| Shape lot staging | DB/API VERIFIED | staging-lot-shape-SHP-2610-00069.json | snapshot thời điểm |

**Verdict: fix lần 1 (1a7fc73b) đúng trên shape thật — PASS, không cần fix mới.**
