# SIL-817 (id 946) — PROD data-repair runbook: stranded IN_TRANSIT trips + handler-less dispatch handoffs

**Incident (13/11/2026, Phạm Trung Kiên báo):** driver **Nguyễn Huy Vương**
(`users.id=27`, `drivers.id=5`) sees "đang chạy chuyến" with no Hoàn tất
command anywhere on `/my-trips`.

**Evidence (PROD `silversea.tingting.vip`, re-verified on the local snapshot
`localhost:5441/silversea`):**

| Row | State |
|---|---|
| trip **13** `TRP-202609-0011` | IN_TRANSIT v3 since 21/09, driver 5, truck 13, fulfillment 62 → shipment **36** `SHP-2609-00036`; ORDER_RECEIVED milestone recorded 13/10 |
| dispatch_handoffs **#38** | UNSEEN, `handler_id NULL`, dispatched 21/09, unresolved (shipment 36) |
| handoff **#37** | UNSEEN, `handler_id NULL`, dispatched 21/09 (shipment **35** `SHP-2609-00035`) |
| trip **15** `TRP-202609-0013` | CREATED v2, driver 5, fulfillment 61 → shipment 35 (never started; busy-blocked by trip 13) |

Root cause chain: the handoff never found a handler → ops pushed the trip
IN_TRANSIT via "Điều phối" → the then-current driver build gated the Hoàn tất
CTA on driver acceptance + mandatory e-POD/milestones, so completion 409'd and
the trip stranded. Truck 13 stays busy-blocked, driver payroll is missing the
trip, and the dispatch queue shows a dead handoff.

## Code fixes in this branch (fix/u9-817-stuck)

1. **`backend/src/services/driver-fulfillment.service.ts`** — completing an
   ALREADY RUNNING trip (IN_TRANSIT) now infers the missing ORDER_RECEIVED
   milestone (`inferredFromCompletion`, same note law as the other inferred
   milestones). A CREATED trip still requires the explicit driver accept.
   → completion can never be stranded by a handler-less handoff again.
2. **`frontend/src/pages/DriverTripDetailPage.tsx`** — the Hoàn tất sticky bar
   renders by TRIP STATUS (`IN_TRANSIT` ⇒ complete CTA), no longer requiring
   the accept milestone, except the TC8 KẾT HỢP L2 lock which keeps its DOC
   message. Accept bar remains for CREATED trips only.
3. **`backend/src/services/dispatch-handoff.service.ts`** — `createHandoff`
   validates a provided `handlerId` (must be an ACTIVE user with role
   DISPATCHER/ADMIN/MANAGER) → 400 otherwise. Broadcast (handler NULL) stays
   legal for clerk intake.
4. **Stuck-trips report** — `GET /api/trips/stuck?days=7`
   (ADMIN/MANAGER/DISPATCHER) + watchlist banner on `/dispatch-detail`
   (`StuckTripsBanner`): every IN_TRANSIT trip past the window with its active
   handoff and a "chưa có người phụ trách" marker.

## Repair tool

`backend/scripts/repair-sil817-stuck-trips.ts` — reuses the LIVE services
(`completeOwnedFulfillmentTrip` / `transitionTripWriteCommand` /
`resolveHandoff`), so payroll-relevant side effects are identical to an
in-app completion: milestone inference, shipment completion recompute,
attendance/work-day sync, report-cache bust, plus an `audit_logs` row per
trip and per handoff resolution. Dry-run is the default.

```
cd backend
# 1. Inspect (writes nothing)
tsx scripts/repair-sil817-stuck-trips.ts --trip 13 --shipment 35
# 2. Trip 13: business confirmed the driver ran the leg → COMPLETE
tsx scripts/repair-sil817-stuck-trips.ts --trip 13 --action complete \
    --actor-user-id <staffUserId> --reason "SIL-817 PROD repair 13/11 — driver ran TRP-202609-0011" --apply
# 3. Handoff #37 (shipment 35): owner decides accept (keep dispatching) or reject (bounce to clerk)
tsx scripts/repair-sil817-stuck-trips.ts --handoff 37 --handoff-resolution accept \
    --actor-user-id <staffUserId> --reason "SIL-817 PROD repair 13/11" --apply
#    …or, if shipment 35's leg will not run:
tsx scripts/repair-sil817-stuck-trips.ts --trip 15 --action cancel \
    --actor-user-id <staffUserId> --reason "<business reason>" --apply
```

Flags: `--trip/--shipment/--handoff` (ids, comma lists ok, repeatable),
`--action complete|cancel` (default complete; cancel requires `--reason`),
`--handoff-resolution accept|reject` (default: ACCEPTED with complete,
REJECTED with cancel), `--actor-user-id` (required with `--apply`; must be a
staff user — signs the audit trail and the handoff resolution), `--apply`.

Idempotency: the completion path carries a stable idempotency key
(`repair-sil817-trip-<id>`), so a rerun after a partial failure replays the
stored result instead of double-writing. Handoff resolution skips rows
already ACCEPTED/REJECTED.

## Gates before PROD (orchestrator)

1. Staging rehearsal completed (see "Staging run" below) with
   COMPLETE path on a stuck trip: milestones inferred, shipment
   `recomputeShipmentCompletion`, `driver_work_days` rows written, audit
   rows present.
2. `--trip 13` decision: **COMPLETE** (driver ran the shipment; payroll and
   payment depend on it). CANCEL only if ops contradict the driver report.
3. Post-run verification queries:

```sql
SELECT id, status, completed_at, version FROM trips WHERE id IN (13, 15);
SELECT id, status, handler_id, accepted_by, resolved_at, reject_reason FROM dispatch_handoffs WHERE id IN (37, 38);
SELECT event_type, occurred_at FROM driver_progress_events WHERE trip_id = 13 ORDER BY id;
SELECT id, event, entity_id, entity_key, metadata->>'repair' AS repair FROM audit_logs WHERE metadata->>'repair' = 'SIL-817';
SELECT * FROM driver_work_days WHERE trip_id = 13;
SELECT id, status, version FROM shipments WHERE id IN (35, 36);
```

Expected after step 2+3: trip 13 COMPLETED (with completed_at + all four
milestones), handoff #38 ACCEPTED (or per flag), handoff #37 resolved per the
owner's call, shipment 36 recompute no longer blocked by a running trip,
driver 5's truck 13 unblocked.

## Staging run (rehearsed on the local PROD snapshot 13/11)

Snapshot `localhost:5441/silversea` carries the exact PROD incident rows.
Rehearsal (actor: dispatcher Nguyễn Văn Dũng `users.id=15`):

- Dry-run printed the evidence table above (trip 13 IN_TRANSIT v3, trip 15
  CREATED v2, handoffs #37/#38 UNSEEN handler NULL).
- `--trip 13 --action complete --handoff 37 --handoff-resolution accept --apply`:
  - trip 13 → **COMPLETED** v4, `completed_at` set; PICKED_UP /
    LOADING_OR_RETURNING / DELIVERED recorded as inferred milestones (the
    13/10 ORDER_RECEIVED stayed untouched);
  - `driver_work_days`: 54 TRIP_DAY rows for driver 5 (payroll/attendance
    synced);
  - shipment 36 recompute ran → **DISPATCHED** v6 (stays DISPATCHED until POD
    acceptance — same as an in-app driver completion; the CUS POD-accept step
    closes it);
  - handoffs #38/#37 → **ACCEPTED** (accepted_by = repair actor);
  - one `audit_logs` row: "Điều vận Nguyễn Văn Dũng đã xác nhận hoàn thành
    lệnh vận chuyển TRP-202609-0011 …" with `metadata.repair = 'SIL-817'`.
- Idempotent rerun: trip already COMPLETED → refused with the clear message;
  handoffs already ACCEPTED → skipped. No double writes.
- `listStuckRunningTrips(7)` after the repair: trip 13 gone from the
  watchlist; the other real strands surface (TRP-202609-0004 67d, TRP-202610-0001
  43d, TRP-202610-0016 29d, TRP-202611-0002 …, each with its UNSEEN
  handler-NULL handoff).
- First rehearsal pass wrote handoff status `accept` (lowercase) because the
  CLI flag value flowed into the service unmapped (the enum column is plain
  text) — fixed in the script (CLI `accept|reject` maps to domain
  `ACCEPTED|REJECTED`) and normalized on the snapshot. PROD runs will get the
  fixed script.

## Follow-ups (out of scope here)

- 8 old CREATED trips (15, 26–36, 50) are clutter but not blocking
  (CREATED never busy-blocks a truck); clean them with the same script
  (`--action cancel`) once the owner confirms each.
- Hard-requiring a handler on every handoff creation is deliberately NOT
  done: clerk intake broadcasts to the queue by design and 6 QA rung scripts
  create handler-less handoffs. The eligibility guard + the 7-day watchlist
  cover the failure mode; revisit if the owner wants a hard gate.
