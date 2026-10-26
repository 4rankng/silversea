# Case SIL-506 — Filter ngày Chi tiết lọt container transportDate NULL (null-date lane)

- Ticket: SIL-506 (id 568, board SIL, QA-verified trên staging build e5239fb1,
  role CUS tiepvv, màn Chi tiết lô hàng /shipments-detail).
- Report: `GET /api/shipments/cus-workspace/containers?transportDateFrom=
  2026-10-23&transportDateTo=2026-10-23` trả 45 containers trong đó 30 có
  `transportDate = null` (chưa có ngày vận chuyển) — bộ lọc ngày không loại
  trừ container null date. 15/45 đúng ngày 23/10; 0 container lệch ngày khác
  (dưới scope tiepvv, nghiện nguyên nhân thứ 2 ở client filter-apply KHÔNG
  tái hiện — xem phần FE check).
- Root cause (code-read, unit-pinned): `containerDayTriageCondition`
  (`backend/src/services/cus-workspace-sql.service.ts`) mở null lane
  `isNull(containerTransportDateSql()) OR (dateArms)` theo luật card
  231026000252 ("undated = luôn hiện"). NULL không thỏa `>=`/`<=` nhưng null
  lane cho mọi row không ngày đi qua MỌI filter ⇒ 30/45 lọt.

## Required law (owner ruling SIL-506, 2026-10-26)

Khi CÓ date range (`transportDateFrom`/`transportDateTo`), filter BE phải
LOẠI container null date: row hiện ⟺ triage day
`D = coalesce(appointment VN date, EDD)` KHÔNG null VÀ `from ≤ D ≤ to`.
Khi KHÔNG có range: full set như cũ (nulls-first sort giữ nguyên).
Test pin chủ: container null date + filter 23/10→23/10 → KHÔNG trả; container
đúng ngày → trả.

Supersession: card 231026000252 pin null lane cho Chi tiết ("undated = luôn
hiện") — SIL-506 thu hồi riêng lane đó trên workboard container. Tổng quan
GIỮ nguyên luật (shipmentTransportDateCondition giữ undated passthrough) —
parity LCL-01 giờ chỉ đúng cho dated rows (accepted consequence, có ghi trong
doc + ticket). `filterContainersByDateRange` (scoped counts Tổng quan /
master-plan) GIỮ nguyên — counts theo luật riêng card 231026000252 của surface
nó.

## Reproduction (before fix)

1. Workboard Chi tiết, role CUS: filter 23/10–23/10 → 45 rows, 30 rows có
   `transportDate: null` (appointment null + lot không EDD ⇒ coalesce NULL).
2. Unit pin trước fix: `containerDayTriageCondition` render ra
   `… is null or (…) is null or (…)` — null lane đứng NGOÀI date arms.

## Cases

- **S506-R1 (null-date + filter — THE BUG)**: container coalesce NULL +
  filter 23/10..23/10 → ABSENT (không trả).
- **S506-R2 (đúng ngày + filter)**: container transportDate = 23/10 + filter
  23/10..23/10 → PRESENT (trả).
- **S506-R3 (lệch ngày + filter)**: dated out-range vẫn ABSENT (giữ luật card
  231026000252 req 2 — dated = phải qua filter).
- **S506-R4 (không filter)**: bỏ range → nulls-first sort + full set giữ
  nguyên (undated hiện lại khi clear filter).
- **S506-R5 (Tổng quan không đổi)**: lot-level law giữ undated passthrough —
  `shipment-transport-date-condition.test.ts` PASS không sửa.

## Unit tests (per case — BE unit-only law, không DB)

- `backend/src/tests/unit/cus-container-day-triage.test.ts` — flip pin cũ:
  KHÔNG còn `is null` escape arm; triage = pure AND của date arms; pin 23/10
  đúng ngày thỏa conjunction (R1/R2/R3).
- `backend/src/tests/unit/shipment-transport-date-condition.test.ts` — R5,
  giữ nguyên PASS (Tổng quan không đổi).
- `backend/src/services/container-date-filter.test.ts` — scoped counts giữ
  undated (không đổi, R5 sibling).

## Fix locations (source-of-truth, per defect-class sweep)

1. `cus-workspace-sql.service.ts` `containerDayTriageCondition` — bỏ null
   lane, body = `and(...dateArms)` (SIL-506 supersession ghi trong doc).
2. `cus-shipment-workspace-reads.service.ts` `buildShipmentPageConditions` —
   comment call-site cập nhật (guard `dateArms.length > 0` giữ nguyên ⇒
   no-filter path không đổi).
3. `container-date-filter.ts` — doc-only: bỏ claim "row filters keep undated
   under every lens" (giờ sai), thay bằng note surfaces cố tình khác nhau.

## FE filter-apply trigger check (nghiện nguyên nhân thứ 2 — KHÔNG tìm thấy)

Code-read `frontend/src/pages/ShipmentContainersPage.tsx` + test pins: URL
params propagate đúng vào API call (`transportDateFrom/To` set cả hai đầu,
invert-range bị chặn, đổi filter re-fetch — test dòng 1160-1166 pin đúng hành
vi). Triệu chứng khách (dòng 17/10, 14/10 hiện dưới lọc 23/10) KHÔNG tái hiện
dưới scope tiepvv (0/45 lệch ngày); nguyên nhân duy nhất đã verify là
null-date lane BE. Nếu khách báo lại lệch ngày: mở ticket mới kèm scope/role.

## Kết quả (sau fix)

- **Unit scoped** (`npx tsx --test src/services/container-date-filter.test.ts
  src/tests/unit/cus-container-day-triage.test.ts
  src/tests/unit/shipment-transport-date-condition.test.ts`): **26/26 pass,
  EXIT=0** — R1 pin (no `is null` escape arm dưới 23/10..23/10), R2 pin (dated
  23/10 thỏa conjunction), R3 giữ (no containerless-LCL escape), R5 giữ
  (shipmentTransportDateCondition không đổi — Tổng quan giữ undated),
  `filterContainersByDateRange` không đổi (scoped counts giữ undated).
- **BE unit full** (`npx tsx --test 'src/tests/unit/*.test.ts'`): **532/532
  pass, EXIT=0** (regression bar).
- **Typecheck** (`npx tsc --noEmit`, backend): **0 error, EXIT=0**.
  (Ghi chú: gate typecheck chạy bằng `tsc` — `tsgo` không có trong môi trường
  worktree này.)
- **eslint** 4 file đụng: 0 error, EXIT=0.
- Evidence: `qa/2026-10-26_sil506_be-scoped-unit.log`,
  `qa/2026-10-26_sil506_be-unit-full.log`,
  `qa/2026-10-26_sil506_be-typecheck.log`, `qa/2026-10-26_sil506_eslint.log`.
- Rung: SQL-contract unit-pinned (PgDialect render, logic NULL-vs-range đã
  pin) — KHÔNG có UI/staging click-through trong lane này (KHÔNG deploy theo
  lệnh); QA drive lại trên staging sau khi branch được merge/deploy.
