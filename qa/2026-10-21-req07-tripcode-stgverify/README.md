# REQ-07 staging verify — driver trip-code display (QA-only, 0 src change)

- **Target:** https://vantai.tingting.vip — `buildHash` **454fab6b** (anchor). Checked at run start and before every screenshot (7 checks in `ui-driver.log`, all `454fab6b`; also at the end: `454fab6b`).
- **Run:** 2026-10-21 15:47:51–15:48:03 +08:00 (07:47:51Z), exit 0, `DONE failures=0`, 21 PASS.
- **Viewport:** 390×844 @2x, mobile, touch. Puppeteer, token injected before navigation.
- **Script:** `testplan/qa/scripts/2026-10-21-req07-tripcode-stgverify.mjs`, derived from the local `…-ui-drive.mjs`. Only GETs and `POST /auth/login`. No password changed and no shipment, trip or penalty mutated. Staging data is immutable.
- **Testplan:** `testplan/2026-10-21-req07-tripcode.md`.

## Verdicts

| Case | Verdict | Evidence |
|---|---|---|
| REQ07T-01 list card format | **PASS** (UI DRIVEN, 2 drivers) | `ui-01-list-390-vvtrung.png`, `ui-01-list-390-tvtham.png`. The card shows `MÃ CHUYẾN TRP 2026-09 · 0015` / `… · 0017`. The bill (`NOSTC26HF67858` / `…67879`) is still the lead identity. The raw `TRP-202609-0015` and `SHP-2609-00042` strings are absent from the DOM. |
| REQ07T-02 detail: Mã chuyến row first, schedule row next | **PASS** (UI DRIVEN, 2 drivers) | `ui-02-detail-390-vvtrung.png`, `ui-02-detail-390-tvtham.png`. Row order is `Mã chuyến → Ngày giờ kế hoạch → Tên nhà máy → …`. The value is `TRP 2026-09 · 0015` (trip 17) and `TRP 2026-09 · 0017` (trip 19). The raw string is absent. See `dom-facts.json`. |
| REQ07T-03 penalty formatted meta row | **NOT COVERED — attempted, 0 data** | Staging has no penalty to drive. See below. |

### REQ07T-03 attempt
- `GET /api/penalties?limit=100&page=1` as admin returned `total=0` and `statusCounts={"all":0}`, with no date or status filter.
- `GET /api/penalties/insights` returned month 0, YTD 0, `safeDriverCount=41` of `driverTotal=41`.
- `GET /api/driver/me/penalties` for vvtrung and bqhuong returned `[]`.
- Raw output is in `api-penalties-count.json` and `ui-driver.log`.
- No penalty was created. A penalty is a financial record that deducts from salary, and the brief says staging is read-only.
- Only the empty-state surface was driven: `ui-03-penalties-390-vvtrung.png`. This does NOT prove the formatted meta row on staging.
- That row remains unit-only (`DriverPenaltyPage.test.tsx`, as recorded in HANDOFF).
- To close it, a real penalty with a trip is needed, for example after prod data is next mirrored into staging, or an owner-approved `QAREQ07*` fixture. The script already asserts the formatted row for any penalty that appears under the driver.

## Deviation from the brief
`bqhuong` (Bùi Quang Hường, plate 15H-061.14) has **0** journey-board items and 0 penalties on staging. The empty-state is captured in `ui-01-list-390-bqhuong-empty.png`. T01 and T02 were driven with the two staging drivers that have real tripCode data. Credentials are from `testplan/testaccounts.txt` (staging: `Abc123`).

| Driver | Trip | tripCode | Bill |
|---|---|---|---|
| `vvtrung` (Vũ Văn Trung) | 17 | TRP-202609-0015 | NOSTC26HF67858 |
| `tvtham` | 19 | TRP-202609-0017 | NOSTC26HF67879 |

## Coverage

| Claim / bug | Rung | Evidence | Not covered |
|---|---|---|---|
| REQ07T-01 list card format | UI DRIVEN (staging, 390px) | `ui-01-*.png`, `ui-driver.log`, `dom-facts.json` | 768/1440 widths. Driver sees only the `TRP-2026NN-NNNN` shape (two rows on staging). Legacy passthrough (`TRP-C12-…`, `BULK-TR-…`, `CN-…`) has no staging driver data and is unit-only. |
| REQ07T-02 detail row | UI DRIVEN (staging, 390px) | `ui-02-*.png`, `dom-facts.json`, `ui-driver.log` | Same as above. "—" for a legacy lot without a code is not reproducible on staging. Both trips are `CREATED` (tab Lệnh mới) only. |
| REQ07T-03 penalty formatted row | NOT COVERED (empty-state UI driven; the row itself is unit-only) | `api-penalties-count.json`, `ui-03-*.png` | Needs a real trip-linked penalty. 0 exist on staging. |
| Read-only / 0 mutation | API-verified | `ui-driver.log` (GET and login only) | No direct staging-DB query. The unchanged state is inferred from the API reads, not a SQL row dump. |

## Files
`ui-driver.log`, `driver-exit.txt` (exit status 0), `dom-facts.json`, `api-penalties-count.json`, 6 PNGs (all 390px, genuine app screens, not login).
