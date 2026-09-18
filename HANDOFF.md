# Current Development Handoff

## Active delivery — bulk appointment copy on "Chi tiết lô hàng", 18 September 2026

Controller: agent session, 2026-09-18 ~12:59 (+08). Branch `prod`, HEAD `586ce46b`
(app commit `1fcfbf2d`). Working tree clean; pushed to `origin/prod`. Staging
(`https://vantai.tingting.vip`) deployed by `make demo` and reporting
`buildHash=1fcfbf2d` — the follow-up `586ce46b` touches only `testplan/` and the
tracked QA driver, so no app bits are missing there.

**Goal:** customer request relayed by Kiên 2026-09-18 — lots entered without a
schedule must be able to take the delivery datetime once for every container,
on the lot detail surface (the customer pointed at the "Chi tiết" drawer; user
ruled option A: add the missing copy affordance to the `/shipments-detail`
workboard, which was the only container-schedule surface without it).

**Shipped:**
- `frontend/src/features/shipments/detail/AppointmentCopyButton.tsx` — affordance
  in the identity cell's reserved gutter (26×26 / radius 8, hover + focus-within,
  always visible ≤640px/coarse pointer), source-gated (row has an appointment and
  its appointment field is writable).
- `frontend/src/features/shipments/detail/appointment-copy.ts` — label helper.
- `frontend/src/features/shipments/cus/use-appointment-copy.ts` — batch write:
  targets resolved from the LOT (`GET /cus-workspace/:id`), sequential
  `POST /cus-workspace/:id/containers/:containerId` with `Idempotency-Key` and
  the version each response returns; conflict → stop, reload, report partial
  count; no empty targets → notice, no writes.
- Ledger + page wiring, CSS, `ShipmentContainersPage.styles.test.ts` CSS lock,
  two unit sheets, `testplan/2026-09-18-detail-copy-appointment.md`,
  `testplan/qa/scripts/ui-detail-copy-20260918.mjs` (also usable against staging
  with `PRESENCE_ONLY=1`).

**Deliberate divergence from the reference surfaces** (`/shipments/new`, CUS
ledger): the target count is not gated on what the page shows — this workboard's
container/date filters and pagination can hide a lot's other containers, so the
gate would hide the feature exactly when the customer needs it. Documented in the
testplan.

**NOT verified:** any write on staging (local only, deliberately); dispatcher /
accountant roles; 390px viewport (unit + CSS rules only); locked lots.

**QA:** lint 0 error · frontend `tsc -b` 0 · frontend 2502 tests / 385 files ·
`make build` ok · UI DRIVEN locally with DB proof
(`qa/2026-09-18-detail-copy/`, one click filled 2 containers never listed on the
page) · staging presence-only UI run
(`qa/2026-09-18-detail-copy-staging/`).

**Not in scope / not done:** prod deploy (not authorized), E2E suite (frontend-only
change: no API, schema, RBAC or `shared/src/calculations` touch).

---

## Preserved prior state — requirements implementation and UI polish, 15 September 2026

Prior task, claims not re-verified here. Uncommitted code + portable zipped patch
requested then; base was `d4d7366039877658f173e45c7767274fd1cfde80`. Cumulative
package: `~/Downloads/silversea-production-polish-20260915-d4d73660.zip` (earlier
Kanban package: `~/Downloads/silversea-kanban-20260915-d4d73660.zip`) — do not
apply both to one base. Product constraints from that pass (online-only, approval
workflows removed, compact 12px/11px/14px/16px/18px/20px type scale) remain the
working style rules. Remaining release-only checks it listed: 24h catalog watch,
deployed DB migration history/integrity, GitHub alert closure, physical
devices/push.
