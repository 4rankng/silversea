# QA wave 2026-10-17 — DEV_COMPLETED drain (kanban QA lane)

Staging: vantai.tingting.vip, buildHash **11720424** = main HEAD at wave start (verify `GET /api/health`). Roles per `testplan/testaccounts.txt` (Abc123). All drivers + screenshots under `qa/2026-10-17_*` and `testplan/qa/scripts/2026-10-17-*`.

## Result

62 cards awaited QA (47 docx + 15 md). Final dispositions: **59 PASS → QA_TESTED, 4 FAIL/reject → TODO (2 cards in the unaccented chain + 2 singles), 0 left behind — DEV_COMPLETED is empty at wave end (22:20).

### PASS (56)
- **FB-006 chain (3)**: factory-cell transient collapse + popover-open probe — 6/6 + 2/2 rung on staging.
- **QA1-007 chain (2)**: chip 0/9 → 3/9 + panel 6 before submit; 3/10 LCL; 3/7 ad-hoc.
- **FB-105 (8 rungs), FB-106 (4), FB-107 (4), FB-108 (4)**: create-form LCL points, redirect-after-create + Tạo lô mới, Nâng/Hạ 3 branches, footer actions.
- **FB-038/072 chain (3)**: same-plate 2 rows → 409 RIG_OVERLAP_COMPLETED + "Vẫn lưu?" dialog DRIVEN on staging; confirm saves; rows restored to 60C-12345.
- **LCL grouping cluster (6: FB-091, FB-092, 232309, 232319, 232329, 171026142500)**: selection bar, dialog 5 fields, carrier source per class, internal-plate FE guard, merge via dialog → issue → Lô 1 = 4.500.000 vendor-wins / member 0 + merge note; master-plan LCL columns both branches.
- **Rev-merge cluster (3: FB-093, FB-095, 105447)**: merge A=1.800.000 AUTO / B=0+note; cross-customer blocked verbatim; Hủy ghép confirm → money physically promoted to survivor.
- **Detail cluster (FB-113 PASS; 000407 PASS; FB-086 + FB-111 PASS on the drawer surface; supersedes 113520 + FB-112 archived)**: documents field order; FCL 2-line phân xe; drawer add → schedule "2 cont" + inheritance; detail pages have no add buttons (owner merge 171026182554).
- **Export chain (5: 232429, 232439, 004331, 004332, 022737)**: 100/100 cell-read suites at HEAD (AR/AP perspective, 9-col default template, HTML/PDF renderData).
- **Data/infra (5: 023438, 013117, 232329, 140000 non-defect, 154000→TODO separate)**: self-exit test; snapshot suites 53/53; governance + redis handled below.
- **Misc (7: qa2-006 caps-lock, FB-057 ×2 per 2026-10-14 ruling, mobile safe-area, qa1-002 superseded-scenario, qa1-004 network, fb033 verifyfail ruling)**.
- **md cards (14: FB-090..094, FB-096..104)**: config classes/pages, debit grid LCL columns + real money, Thêm cược modal, expense drawer slim, Khai chi phí button + roles, advances surface, timesheet roles + Mở bảng per role, salary-mode surface, monthly report page.

### FAIL / rejected → TODO (4)
- **171026010018 (governance registry)**: `/lcl/unmerge-group` has no registry entry — 8/9 at HEAD (route arrived via a later parallel merge).
- **111026164510 (FB-033 OPS search entry)**: OPS palette is EMPTY for every query — `getSearchItems` has no `case 'OPS'` (default []); the fix added the action to FORWARDER_ITEMS which OPS never receives.
- **111026105610 + 171026123000 (unaccented seed)**: ran the sanctioned purge (`qapurge-dry` → `qapurge`; business_units deactivated 5/5, FB080 scrubbed) — **/hr/roster STILL shows 'QA Audit Unit 0914'** in the filter dropdown and the Bộ phận column; `deactivate` is insufficient for this join (needs link removal, rename-style scrub, or an inactive-aware join).

### Closed on the second pass (was PARTIAL): FB-110, FB-109, 000406 — PASS (22:20)
- Root cause of the earlier no-ops: the driver's label-wrapper walk filled the **Số Bill** input instead of Số tờ khai (one such save corrupted fixture lot 876's bl_number — restored to 'KBQA-DET-3'), so Save legitimately no-opped.
- Corrected driver (doc-order input after the label): Lưu → `POST cus-workspace/876/containers/474 200` with the declaration on the wire (FB-110 persist); clearing saves both empty and fires NO copy (law); re-entering the first declaration with an empty sibling fires `POST …/containers/474/copy-declaration 200` and BOTH containers carry the number (FB-109); the row badge dropped 'Thiếu 5' → 'Thiếu 4' (000406 bit clears).
- Drivers: `testplan/qa/scripts/2026-10-17-qa-fb110-save-drive.mjs`, `-qa-fb109-autocopy-drive.mjs`.

## Fixture hygiene
- Sweep deleted 15 tagged lots (FB105/FB106/FB107/FB038/KBQA-REV/KBQA-DET/KBQA-FB038 + draft 847).
- Residue: lots **861/862 (KBQA-GRP-A/B, unmerged, tagged)** with trips TRP-202610-0106/0107 — deletion blocked by design ("mọi container chưa phát lệnh"); external-carrier CREATED trips, no driver money. Also: 1 VOIDED ops expense id 71 (on deleted 854), staging price rows id 3/4 (pre-existing from the cuoc-tra-dv investigation), FE guard residue none.

## Not covered (explicit)
- No real-device env() inset checks (owner-device, as declared).
- Locked-lot UI export click (no reachable issued debit-note document on staging; cell-read suites + router-mounted HTML tests are the basis).
- FB-110/109/000406 save click (see PARTIAL).
- 232329 internal-fleet money on the salary screen with a real internal group (suite + dev DB evidence only).
- New TODO arrivals (fb020, them-cược, fb030/075, fb103 verifyfail) filed by other lanes during this wave — not part of this batch.
