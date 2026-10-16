# W4 ops/chiphí/bảng giá — wave handoff (2026-10-16)

Controller: this session (Paseo agent), branch `feat/w4-ops-chiphi-banggia`
(cut from the W3a verify head `ae419e3d`). Seven cards dispatched; six card
.docx files arrived 0-byte at 14:02 (content never synced), one readable.

## Per-card outcome

| Card | Status | Evidence |
|---|---|---|
| 161026121500 bảng giá xóa rồi thêm lại báo trùng ảo | FIXED, rung 3 | commit (this wave); `testplan/2026-10-16-bang-gia-xoa-roi-them-lai.md`; `qa/2026-10-16_bang-gia-tombstone_*` |
| 161026095800 bảng giá không thêm được theo loại xe | ALREADY ON MAIN (F-1) | fix `b9b22bf9` merged via `0ca5b428`; regression pin `backend/src/tests/pricing-table-selector-axis.test.ts` header names this ticket; FE page test 4/4 this wave |
| 161026113900 F-2 LCL merge money channel owner ruling | DOCUMENTED, no implementation | question below; `testplan/2026-10-16-lcl-cost-closed-loop.md` §F-2 |
| 141026230700 driver chi phí lô hàng tiền đường redesign | BLOCKED — card 0 bytes | needs the card's UI spec; do not redesign from a title |
| 141026230710 ops không khai được chi phí lô hàng | BLOCKED — card 0 bytes | TC-B2 (`testplan/2026-10-16-lcl-cost-closed-loop.md`): OPS GET /api/shipments 403 is the FB-033 owner ruling (2026-10-12, `016b0d0b`): Khai-chi-phí dialog stays OPS-only per-vehicle scope. Reopening an owner ruling requires the card text. |
| 141026230720 ops khai chi phí tất cả + cảnh báo trùng | BLOCKED — card 0 bytes | title reads as an FB-033 scope change (declare for ALL lots) — owner decision, card unreadable |
| 161026100400 lô lẻ chưa gắn xe không hiện kế hoạch chi tiết xe | BLOCKED — card 0 bytes | FB-092 spec (`testplan/2026-10-15-fb092-*.md`) defines unassigned display as bare `Lẻ`; exact repro/expected unknown without card |

## F-2 owner ruling still open (money logic — affects FCL too)

FB-093 merge writes the 100%/0đ jump to `trip_financial_state.revenue`, but
both money boards read other channels: CUS "Chi phí - Quyết toán" reads
`freightAuto` ← `freight_rate_snapshots`; Kế toán "Kế hoạch điều động tổng
hợp" reads `thu.cuocThu` ← trip legs `freight_amount`. After a merge the
boards keep each lot's own AUTO freight; spec §3.2/§4 display law (Lô 1 =
100%, members 0₫ + "Ghép cước cùng Bill") is not reflected on money
columns. Decision needed between:
(a) merge writes snapshot overrides,
(b) boards read the override channel (`trip_financial_state.revenue`),
(c) snapshot recapture on merge.
Related minor F-4 (no card): trip GET omits `revenueOverrideReason` —
one-line select addition when an operator surface for the zero reason is
wanted. Routed for owner/Hermes; nothing implemented this wave.

## The fix that landed (161026121500)

Defect class: pricing-catalog CRUD soft-deletes rows and every app guard
excludes tombstones, but five DB unique indexes still counted them —
delete → re-add passed the guard and failed the INSERT (phantom duplicate).
Sweep (5 indexes): `pricing_tables` ×3, `road_allowances`, `lift_pricing`
gained `deleted_at is null` predicates (schema + migration
`20261016143000_pricing_tombstone_unique_idx`, journal idx 150, house
hand-SQL pattern). `carrier_route_pricing` ×2 and `port_zone_surcharges`
already had the law and are pinned unchanged. No money calculation
changed — uniqueness only; live-row duplicate protection intact (BGX02
DB + UI both prove the 409 path).

Gates: BE tsc 0 · BE unit 5/5 (new pin) · BE full suite (see qa log) ·
FE tsc 0 · FE scoped vitest 4/4 · root lint 0 errors · make build 0.
UI rung 3: create → delete → re-create same selector on
/config/pricing-tables as admin — SUCCESS; real duplicate still blocked;
screenshots + DOM + DB rows + driver log in qa/2026-10-16_bang-gia-tombstone_*.

## Environment notes for the next session

- Shared dev containers `ss-prod-db`/`ss-prod-redis` were already up;
  `make dev` fails on container-create — start backend/frontend directly
  (PORT=3002 / vite 7175) and reuse :5441/:6391.
- Fresh worktree needs `pnpm install --prefer-offline` +
  `pnpm --dir shared build` before any gate.
- Puppeteer lesson (cost ~20 min): `page.evaluate` serializes a RegExp
  argument to `{}`; `new RegExp({})` becomes a `[object Object]` character
  class that matches almost anything — pass regex SOURCE as a string.
  Also use `{ polling: 120 }` on waitForFunction in headless tabs (rAF
  polling stalls on occluded pages).
- Backend full `pnpm test` needs >15 min (integration tier, concurrency 1).
