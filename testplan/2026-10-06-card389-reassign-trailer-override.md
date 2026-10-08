# Card 20261006_389 — Ghi đè rơ-moóc ở luồng GÁN LẠI (reassign) (regression case)

Case ID: TC-20261006_389-01
Feature: "Phân xe lại" — `PATCH /trips/:id/reassign` (dispatch branch → `reassignIssuedDispatchWriteCommand`) + TripReassignDialog.

## Quyết định sản phẩm (owner ack theo ủy quyền 06/10: "you make all decisions")
Luồng gán lại cần được đổi moóc như luồng phát lệnh: route map `data.trailerId` vào command hiện có (một dòng), giữ nguyên 3 cổng 409 của moóc; dialog hiển thị moóc đang ghép của XE ĐANG CHỌN + select ghi đè, chỉ gửi `trailerId` khi ghi đè. Không schema, không route mới.

## Repro (trước khi sửa)
1. Phát lệnh chuyến xe nhà (đầu kéo ghép moóc A).
2. "Phân xe lại" → đổi đầu kéo (ghép moóc B) hoặc muốn moóc C: không có trường moóc; route không truyền `data.trailerId` vào command → moóc chuyến luôn = moóc ghép của đầu kéo mới.

## Expected (sau khi sửa)
- Route: `trailerId: data.trailerId ?? null` trong lệnh `reassignIssuedDispatchWriteCommand` — cùng command, cùng 3 cổng 409 ("chưa có rơ-moóc khả dụng" / "không còn hiệu lực" / "không phù hợp với loại container").
- Ghi đè (trailerId chỉ định, cùng đầu kéo): `trips.trailer_id` = moóc chỉ định.
- Không ghi đè (đổi đầu kéo, không trailerId): `trips.trailer_id` = moóc ghép của đầu kéo MỚI (hành vi giữ nguyên).
- Moóc không ACTIVE (MAINTENANCE) → 409 "Rơ-moóc không còn hiệu lực".
- FE (TripReassignDialog, xe nhà): dòng "Moóc đang ghép: {biển} · {loại}" theo theo xe đang chọn; select "Moóc cho chuyến (ghi đè)" (chỉ moóc ACTIVE; moóc ghép rớt khỏi ACTIVE vẫn chọn được); note "Ghi đè moóc: X thay cho moóc đang ghép Y." khi khác; không chọn → body không có `trailerId`.

## Automated pins
- `backend/src/tests/dispatch-fulfillment.test.ts` — "reassign maps trailerId: explicit trailer records on the trip, omission keeps coupling, invalid trailer 409s" (route-level, DB-persisted):
  (1) phát lệnh moóc A → reassign cùng đầu kéo với `trailerId` = B → `trips.trailer_id` = B (RED tại HEAD: giữ A — route bỏ trường);
  (2) reassign sang đầu kéo B không `trailerId` → `trips.trailer_id` = moóc ghép của B;
  (3) `trailerId` = moóc MAINTENANCE → 409 "Rơ-moóc không còn hiệu lực" (RED tại HEAD: 200 do trường bị bỏ).
- `frontend/src/features/dispatch/detailed-plan/TripReassignDialog.test.tsx` —
  (1) coupling của xe đang chọn hiển thị; không ghi đè → body không `trailerId`;
  (2) chọn moóc khác → body `trailerId` + note hai biển số;
  (3) đổi đầu kéo → coupling line theo xe mới; option select không chứa moóc INACTIVE.

## Not covered
- Rung 3: gán lại thật trên staging với ghi đè moóc (lane chính).
- `tripService.reassignTrip` (nhánh fallback khi trip không gắn fulfillment): không đụng — các chuyến điều phối thật đều đi nhánh command.
