# Case 141026230710 — Ops không khai được chi phí lô hàng (P1) — RECHECK PASS (FIXED-on-recheck)

> **Trạng thái kanban: DEV_COMPLETED** (xác thực lại 16/10/2026, build a68d2e04/edbafb04).
> Card Drive hiện còn ở Kanban/TODO — chủ sở hữu di chuyển sang DEV_COMPLETED
> (môi trường này chỉ đọc được Drive, không ghi được).

- **Verdict:** FIXED-on-recheck. The reported permission failure no longer
  reproduces on staging build `8610a42b` (2026-10-16 12:07Z). Not fixed by
  this session — the fix shipped earlier (20261005 open-scope batch, merged
  through `e717d2cb` / W4b `acf3f950`; regression-pinned in
  `frontend/src/features/ops/OpsExpenseFormModal.containers.test.tsx`
  "plan step 5 — open Ops scope").
- **Card:** `Kanban/TODO/141026230710-ops-khong-khai-duoc-chi-phi-lo-hang.docx`
  → moved to `Kanban/QA_TESTED/`.
- **Driver:** `testplan/qa/scripts/141026230710-ops-cost-recheck-rung.mjs`.

## Reported scenario (2026-10-14, staging)

1. Login `hoangnh` (Ops/Vận hành).
2. `/shipments` → redirect + toast "Bạn không có quyền truy cập trang này."
3. Open a shipment's work plan → "Khai chi phí" → dialog shows "Lô này không
   thuộc xe bạn phụ trách.", Lưu disabled (2 lots tried).
4. Expected: Ops khai được chi phí mọi lô hàng (T3 — mọi Ops đều được điền,
   không chia theo cá nhân/xe).

## Re-drive (2026-10-16, staging, build 8610a42b, account hoangnh/OPS)

| Step | Result |
|---|---|
| `/api/health` | `buildHash: 8610a42b` — asserted before driving |
| Login `hoangnh` | 200, token, role OPS |
| `/api/shipments` probe | **403 — expected, unchanged**: FB-033 owner ruling (OPS has no shipments policy row by design). NOT part of the PASS criteria; the cost-entry path for Ops is `/ops/orders` → "Khai chi phí" (OPS-only portal). |
| `/ops/orders` (UI) | Table rendered, row DNKM13336 (lot 175, 2 conts) |
| "Khai chi phí" click | Modal opened; **no** "không thuộc xe bạn phụ trách", **no** "không có quyền", no alert |
| Form fill | Cont `MSDU1245780`, loại phí "Lưu bãi (lúc hạ)" (YARD_STORAGE), 15.000đ, ghi chú QA |
| Lưu | **Enabled, clicked → toast "Đã ghi nhận khoản chi."**, modal closed |
| Persisted side effect | `GET /api/ops/wallet/expenses?status=RECORDED` → row **id 47**, `YARD_STORAGE`, amount `15000`, container `MSDU1245780`, paidByName `Nguyễn Huy Hoàng` |
| Duplicate-claim head-up data | `GET /api/ops/expenses/cont-claimants?shipmentId=175` now lists `MSDU1245780 → Nguyễn Huy Hoàng` |
| Fixture cleanup | `DELETE /api/ops/expenses/47` (Idempotency-Key, reason "QA cleanup") → 200 `{"success":true}`; re-read shows `approvalStatus: VOIDED` |

## Evidence

- Driver log (exit 0): `qa/2026-10-16_141026230710_ui-driver.log`
- Screenshot after dialog open: `qa/2026-10-16_141026230710_ui-dialog-open.png`
- Screenshot after save: `qa/2026-10-16_141026230710_ui-after-save.png`
- Summary: `qa/2026-10-16_141026230710_recheck-summary.json`

## Verification coverage

| Claim / bug | Rung | Evidence | Not covered |
|---|---|---|---|
| OPS cannot enter lot-container costs at all (card 141026230710) | UI DRIVEN | driver log + 2 screenshots + wallet row id 47 + claimants read-back + VOID cleanup, paths above | only `hoangnh` driven (other OPS accounts not); desktop 1440 only (no 390/768 sweep); staging only (local/prod not driven); rollback path not exercised beyond fixture void |
| `/shipments` still 403 for OPS (card repro step 2) | DB/API VERIFIED | shipments-probe status 403 in driver log | intentional FB-033 status quo, no UI drive needed |

Staging DB note: no direct SQL access to staging (governed-API read-back of
the persisted row is the side-effect proof, matching prior staging QA waves).
