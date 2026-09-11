# 2026-09-12 — Staging regression after the dispatch-detail-unassigned fix

Triggered by the original CTO report ("điều vận sees no detail for shipments
not yet assigned to a nhà xe") and the user's follow-up "test staging to
ensure no bug regress". Scope: full smoke of the surfaces touched by the
shipped commits (`2e807808`, `fe051e72`, `e1b65507`) plus a sample of
adjacent flows to catch silent breakage.

Environment: https://vantai.tingting.vip (staging) — committed at
`fe051e72` + `e1b65507` and rolled forward by `make demo` after the fix.

## Summary

| Area | Result |
| --- | --- |
| API smoke (16 probes, 4 roles + anon) | **16/16 PASS** |
| Browser: dispatch detail (DISPATCHER) | 15 rows = 13 pre-fix + 2 backfilled (ships 7, 15); "Chưa phân nhà xe" renders for both |
| Browser: CUS workspace | /shipments lists 13 lots, drawer opens, /shipments/15 detail shows "Nhà xe / Chưa phân nhà xe" copy |
| Browser: master plan (DISPATCHER) | 15 containers (7×20' + 8×40'), rows render for unassigned + HÀ AN + SilverSea + VÂN LAN |
| Browser: fleet vehicles (DISPATCHER) | "Lọc theo nhà xe" combobox opens with Tất cả / Chưa phân / BIỂN XANH / ĐĂNG QUÂN / DH-BẮC NINH / ĐQ / DUYÊN HẢI |
| Driver portal API | /api/driver/me/trips 200 (1 item), /api/driver/me/journey-board 200 (items + 15 tag labels) |

**No regressions detected.** Original bug confirmed fixed at rung 3 (DOM
count + screenshot + DB row count all agree).

## API smoke details

`qa/2026-09-12_staging-regression/api-smoke.sh` → `api-smoke-final.log`

```
--- /api/shipments/dispatch-detail-plan-rows ---
  PASS [200] DISPATCHER list
  PASS [200] DISPATCHER +q=SEED
  PASS [200] DISPATCHER assignmentStatus=UNASSIGNED
  PASS [200] DISPATCHER assignmentStatus=ASSIGNED
  PASS [403] CUS (forbidden)
  PASS [403] DRIVER (forbidden)
  PASS [401] anonymous
  PASS [403] ACCOUNTANT (no scope → 403 by design)
--- /api/shipments + /api/shipments/:id ---
  PASS [200] DISPATCHER list
  PASS [200] CUS list
  PASS [200] ACCOUNTANT list
  PASS [200] DISPATCHER detail /7
  PASS [200] DISPATCHER detail /15
--- /api/health + root ---
  PASS [200] anon /api/health
  PASS [200] root /
```

ACCOUNTANT note: `requireAccountantDispatchScope` returns 403 with
"Tài khoản kế toán chưa có phạm vi khách hàng để xem điều phối" when the
ACCOUNTANT user has no customer-scope rows configured. All 6 staging
accountants (hoapt, liennt, lydp, vanntt, myvtt, ngocntm) hit this — by
design, not a regression. Source: `dispatch-planning-utils.service.ts:183`.

## Browser walk artifacts

| Step | Screenshot | What it confirms |
| --- | --- | --- |
| 01 — Dispatch detail (DISPATCHER) | `01-dispatch-detail-dispatcher.png` | 15 rows, "Chưa phân nhà xe" + "CUS sẽ bổ sung" + "Chưa kẹp xe" copy on rows 2 (ship 7) and 7 (ship 15) |
| 02 — CUS shipments list | `02-shipments-cus.png` | 13 lots visible, status chips, NEWEB-1 SEED-DOC1-0912 in IN_TRANSIT |
| 03 — CUS lot drawer | `03-shipment-detail-cus.png` | Quick-edit drawer opens from list, shows container + dispatch carrier + plate |
| 04 — /shipments/15 detail (CUS) | `04-shipment-detail-15-cus.png` | "Nhà xe" section header (NOT "Nhà xe đã gán") with "Chưa phân nhà xe" empty copy — confirms `ShipmentDetailPage.tsx` state-aware title |
| 05 — Master plan (DISPATCHER) | `05-master-plan-dispatcher.png` | 15 containers, "PHÂN BỔ NHÀ XE" column shows Chưa phân bổ + carriers |
| 06 — Fleet vehicles (DISPATCHER) | `06-fleet-vehicles.png` | 39 trucks, "NHÀ XE" column populated, "—" for unassigned (matches `fe051e72` schema expectation) |
| 07 — Fleet carrier filter open | `07-fleet-carrier-filter-open.png` | "Lọc theo nhà xe" combobox lists Tất cả / Chưa phân / 5 carriers — confirms `FleetVehiclesView.tsx` carrier filter renders and fetches |

## Driver portal API

| Endpoint | Status | Body shape |
| --- | --- | --- |
| GET /api/driver/me/trips | 200 | `{ items: [...1 item...] }` |
| GET /api/driver/me/journey-board | 200 | `{ items: [...], knownTagLabels: [...] }` |

(Driver browser walkthrough deferred — `/driver/me/*` endpoints respond
200 and the dispatcher regression scope is the CTO ask.)

## Data sanity (staging API counts)

- `/api/shipments?limit=50` returns 13 lots:
  - DISPATCHED: 7
  - IN_TRANSIT: 2
  - PENDING_DATE: 1
  - READY_FOR_DISPATCH: 3 (ids 7, 14, 15)
- `/api/shipments/dispatch-detail-plan-rows?limit=50` returns 15 rows
  covering shipments [2, 3, 4, 5, 6, 7, 8, 10, 11, 13, 14, 15]
- Carrier breakdown of those rows: OWN=3, EXTERNAL=10, None=2
- DOM row count via `document.querySelectorAll('tbody tr.detailed-plan-grid__row').length` = **15** (matches API)

## Verification coverage

| Claim | Rung | Evidence | Not covered |
| --- | --- | --- | --- |
| Shipments 7 + 15 (READY, no carrier) render in dispatch detail plan | UI DRIVEN | `01-dispatch-detail-dispatcher.png` shows both rows; DOM count 15; API 15 rows | mobile viewport, very narrow screen (1365×768 only) |
| "Nhà xe" + "Chưa phân nhà xe" copy on /shipments/:id for unassigned lots | UI DRIVEN | `04-shipment-detail-15-cus.png` shows both copy states | other unassigned shipments (7, 8) not visually verified |
| CUS sees their own shipments normally | UI DRIVEN | `02-shipments-cus.png` + drawer `03-shipment-detail-cus.png` | CUS portal separate from /shipments list |
| Master plan unaffected | UI DRIVEN | `05-master-plan-dispatcher.png` | month/year switching, multi-zone view |
| Fleet carrier filter works | UI DRIVEN | `07-fleet-carrier-filter-open.png` lists 7 options | selecting each option and verifying row count |
| RBAC for dispatch-detail-plan-rows unchanged | DB/API VERIFIED | api-smoke 8 probes | custom casbin policies beyond the standard 7 roles |
| Driver portal `/api/driver/me/*` unaffected | DB/API VERIFIED | 2 probes pass | UI driver walkthrough not driven |

## Known caveats / out-of-scope

- ACCOUNTANT 403 on `/dispatch-detail-plan-rows` is **by design**
  (`requireAccountantDispatchScope`); no staging accountant has a
  customer-scope configured. If you want a dispatcher-readable accountant
  for smoke purposes, configure one first.
- Driver UI walk not driven — API 200s for `/trips` and `/journey-board`
  are the only proof. Driver browser rendering is unchanged in scope of
  the shipped commits, but a click-through is the recommended follow-up.
- Mobile viewport (≤900px via `@container` rules) not exercised — same
  1365×768 capture across the run.