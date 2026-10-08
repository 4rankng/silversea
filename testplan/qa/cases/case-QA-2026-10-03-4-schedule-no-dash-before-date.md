# Case QA-2026-10-03-4 — No dash placeholder before a present schedule date (card 20261003_304)

- **Case ID:** QA-2026-10-03-4
- **Reported:** 2026-10-03, PM: "why would we have the dash character here in front of date" (screenshot on card).
- **Surface:** /dispatch-detail Kế hoạch Chi tiết — schedule cell (`.ops-schedule__datetime`); sweep surfaces
  MasterPlanGrid schedule blocks, CusShipmentRow, ShipmentsPage drawer, shared `formatAppointmentGroupLine`.
- **Mutation surface:** none — read-only text assertions.
- **Status:** case PREPARED — fix landed (see card for sha); UI DRIVEN local rung captured on the card;
  staging rung owed at wave cut.

## Steps

1. Login `dungnv`/Abc123 → /dispatch-detail at 1440.
2. Rows whose schedule has only a delivery date (no runAt, no runHour): the schedule cell renders the
   DATE ALONE ("29/09/2026") — never "— 29/09/2026".
3. Rows with an hour: "HH:MM dd/mm/yyyy" (or "20H dd/mm/yyyy" hour-int) as before.
4. Fully unknown rows (no date, no hour) keep the standalone "—" placeholder.
5. Sweep: master-plan schedule blocks, CUS shipment rows and the drawer render via
   `formatAppointmentGroupLine` (valid dates → "HH:MM date") — no dash-prefix shape exists there.

## Expected

- Zero schedule lines matching /^— \d/ anywhere; date-alone lines render exactly `dd/mm/yyyy`.

## Local rung (2026-10-03)

- 39 schedule cells: 0 dash-prefixed, 30 date-alone, 6 with time, 3 fully-unknown bare dash.
- Master-plan blocks: 0 dash-prefixed. Screenshots on the card.
