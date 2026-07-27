# M12 Follow-up Work Queue — Session Tracker

> **Purpose.** Durable queue of regression findings from the 2026-07-27 M12 audit
> that remain **Open**. Each row is one unit of work for an autonomous session.
> The daily cron (see `.zcode` workspace automations, title "M12 follow-up: implement + QA next item")
> picks the next `Open` row, runs the closed-loop SDLC on it, then flips it to
> `Done` with evidence. When no `Open` rows remain, the cron self-drains.
>
> **Status legend:** `Open` (pending) · `In Progress` (a session owns it) ·
> `Done` (implemented + QA-green + artifacts saved) · `Blocked` (needs a human
> decision, see notes).
>
> **Do NOT mark `Done` unless the closed-loop SDLC has exited green** — code
> written, QA gates the change can affect are green, and artifacts are saved
> under `qa/<YYYY-MM-DD>_<slug>_*.{log,md,png}`. See `AGENTS.md`.

## Source

Derived from `qa/2026-07-27_m12 consolidated-regression-summary.md` (M12 audit)
plus the per-session reports S1–S4. Defects D1, D2, HT10-001 were already fixed
or closed in the audit follow-up and are NOT listed here.

---

## Queue (priority order — work top-down)

### P0 · M12.3 pump-capture UI (HT08-001)  — biggest user-facing gap

- [ ] **M12.3-UI-1 · Status: Open · Owner: none · Started: — · Done: —**
  - **What:** Build "Chụp ảnh cột bơm" button + OCR-result display + "Xác nhận
    nhiên liệu" confirmation flow on `/trips/:id` for the assigned driver.
  - **Why:** TC-M12-03-01..05 all `Blocked` at the UI layer. Spec PRD M12-03
    requires the flow; backend `POST /api/ocr/pump` already works (proven Pass
    in S3 backend tests).
  - **Touchpoints:** `frontend/src/features/trip-detail/components/FuelCard.tsx`
    + new component for capture/confirm; wire `geotagClient.ts` (currently
    marked "not wired"); backend may need a `POST /api/trips/:id/fuel-confirm`
    endpoint if no confirmation surface exists.
  - **Acceptance:** TC-M12-03-01 (happy path), 03-04 (offline recovery), 03-05
    (RBAC) all Pass at the UI layer. Save screenshots under
    `qa/<date>_m12-03-<tc>_*.png` and update the M12 acceptance table.
  - **QA scope:** frontend typecheck + tests, e2e, build.

### P0 · M12.2 reconciliation endpoint + UI (HT10-002)

- [ ] **M12.2-RECON-1 · Status: Open · Owner: none · Started: — · Done: —**
  - **What:** Expose `getFuelApReconciliation()` at `GET /api/reports/fuel-recon
    ?from=&to=&supplierId=` and add a "Đối chiếu nhiên liệu" button on
    `/payables/:id` that opens the report.
  - **Why:** TC-M12-02-01/02/03 all `Blocked`. Engine is production-quality but
    only invoked internally by the approval guard.
  - **Touchpoints:** new route in `backend/src/routes/financial/reports.routes.ts`;
    frontend `PayableDetailPage.tsx` (or new `FuelReconPage`).
  - **Acceptance:** TC-M12-02-01 Pass (period totals match); 02-02/02-03 still
    `Blocked` on Q06 allocation (separate item below) but the recon report
    itself renders with the right columns.
  - **QA scope:** backend typecheck + tests (add a `fuel-ap-recon-route.test.ts`),
    frontend typecheck + tests, e2e, build.

### P1 · Q06 multi-vehicle AP allocation (TC-M12-02-02, 02-03)

- [ ] **M12.2-ALLOC-1 · Status: Open · Owner: none · Started: — · Done: —**
  - **What:** Implement AP-side allocation of a single fuel-supplier invoice
    across multiple trips by actual litres consumed (Q06: not split-evenly,
    must use actual litres, no approval when basis is missing).
  - **Why:** TC-M12-02-02 (reject incomplete allocation) and 02-03 (happy path)
    both `Blocked`. `payment-allocation.service.ts` is AR-only today.
  - **Touchpoints:** new service `ap-fuel-allocation.service.ts`; new endpoint
    `POST /api/payables/:id/allocate`; schema may need an
    `ap_fuel_allocations` table (Drizzle migration).
  - **Acceptance:** TC-M12-02-02 Pass (incomplete allocation → 400 "Chưa phân
    bổ đủ"); TC-M12-02-03 Pass (per-trip lines sum to invoice total).
  - **QA scope:** full set including e2e — schema/financial change.
  - **Depends on:** M12.2-RECON-1 (the allocation UI lives on the same screen).

### P1 · OCR backend medium defects (G5, G6, G7)

- [ ] **M12.3-G5 · Status: Open · Owner: none · Started: — · Done: —**
  - **What:** Add `confidence` field (0..1) to `POST /api/ocr/pump` response.
    Spec requires "mức độ tin cậy".
  - **Touchpoints:** `backend/src/routes/ocr.ts:197`; underlying VLM service
    `backend/src/services/ocr.service.ts`.

- [ ] **M12.3-G6 · Status: Open · Owner: none · Started: — · Done: —**
  - **What:** Add an "unreadable / not-a-pump" branch. Currently a non-pump
    image returns `ok:true, 0/0/0` instead of "Không đọc được".
  - **Touchpoints:** same as G5; the VLM already returns a confidence signal
    that can drive this branch.

- [ ] **M12.3-G7 · Status: Open · Owner: none · Started: — · Done: —**
  - **What:** Detect multi-screen images (the VLM silently picks one display
    today). At minimum: warn "phát hiện nhiều màn hình — chọn đúng số".

### P1 · OCR RBAC gaps (G3, G4)

- [ ] **M12.3-G3 · Status: Open · Owner: none · Started: — · Done: —**
  - **What:** `POST /api/ocr/pump` must take a `trip_id` and verify the caller
    is the assigned driver of that trip. Today any driver can POST.
  - **Touchpoints:** `backend/src/routes/ocr.ts`; cross-check trip assignment
    via `trips.driverId`.

- [ ] **M12.3-G4 · Status: Open · Owner: none · Started: — · Done: —**
  - **What:** Drop `MANAGER ocr:write` from Casbin policy — spec says `giamdoc`
    is read-only. (Or keep the policy but enforce a finer-grained check in the
    route handler.)
  - **Touchpoints:** `backend/src/casbin/policy.csv:57`.

### P2 · 12.1 trip-detail display defects (D1, D3, D4)

- [ ] **M12.1-D1 · Status: Open · Owner: none · Started: — · Done: —**
  - **What:** Show the fuel formula string (e.g. `120 km × 30 l/100 km = 36 l`)
    and applied-norm id in the trip-detail fuel card. Backend already
    snapshots `fuelNormId`; UI doesn't render it.
  - **Touchpoints:** `frontend/src/features/trip-detail/components/FuelCard.tsx`.

- [ ] **M12.1-D3 · Status: Open · Owner: none · Started: — · Done: —**
  - **What:** After editing actual litres with a reason, show the reason and
    the original suggested value on the trip-detail fuel card.

- [ ] **M12.1-D4 · Status: Open · Owner: none · Started: — · Done: —**
  - **What:** Add a "áp dụng mức khoán đồi núi" note when flat-rate applies.
    Also: reconcile the two flat-rate sources — currently
    `route.fixedFuelAllowance` is consumed by `computeTripTotals` while
    `fuelNorms.flatRateLiters` is only snapshotted. Pick one source of truth
    and document it.

### P2 · Audit-log diff rendering (D5 / HT03-001)

- [ ] **M12-D5 · Status: Open · Owner: none · Started: — · Done: —**
  - **What:** Audit-log detail dialog doesn't render the payload / before→after
    diff. Config edits log only NEW values; `entityId` is null. Render the diff
    and persist the old values at log time.
  - **Touchpoints:** `frontend/src/pages/AuditLogPage.tsx`;
    `backend/src/services/audit-registry.ts` (and wherever config edits write
    audit rows).

### P2 · Payables RBAC button-gating (D2 from S2)

- [ ] **M12.2-D2 · Status: Open · Owner: none · Started: — · Done: —**
  - **What:** `/payables/:id` renders `Ghi thanh toán` / `Tạo bảng kê` /
    `Ghi hoa hồng` for MANAGER without role-gate. Spec says MANAGER is
    read-only. Gate these buttons to ACCOUNTANT + ADMIN.
  - **Touchpoints:** `frontend/src/pages/PayableDetailPage.tsx:298-304` and
    `PayableListPage.tsx`.

### P3 · Seed data for HT-10 cross-module recon

- [ ] **SEED-HT10 · Status: Open · Owner: none · Started: — · Done: —**
  - **What:** Add at least one COMPLETED trip with `fuelSupplierId +
    totalFuelCost > 0` (and a matching supplier invoice) to the seed script so
    HT-10 cross-module reconciliation has live data to test against.
  - **Why:** HT10-001 was closed as a data condition (wiring is correct). This
    unblocks the test without code change.
  - **Touchpoints:** seed script under `backend/scripts/seed*` or
    `deploy/seed*`.

---

## Cron behaviour

The recurring automation "M12 follow-up: implement + QA next item" fires daily
at 09:00 local (+08). Each firing:

1. Reads this file.
2. Finds the topmost `Open` row.
3. Marks it `In Progress` (this session owns it).
4. Runs the closed-loop SDLC: implement → QA gates → save artifacts → fill the
   row's Status/Owner/Started/Done fields + link evidence.
5. If a gate is red after a genuine fix attempt, mark `Blocked` with the
   blocker reason and stop (do NOT weaken tests).
6. If no `Open` rows remain, the cron's prompt instructs the agent to
   self-delete the automation (CronDelete) and report queue drained.

A human can reorder priority by moving rows up/down. A human can pause the cron
by deleting it via the workspace automations UI.

---

## Audit trail (append-only)

| Date | Agent | Action |
|---|---|---|
| 2026-07-27 | ZCode (this session) | Queue created from M12 consolidated summary. 13 Open rows. |
