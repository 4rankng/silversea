# QA-AUDIT-UI-16 — identify every accounting destination

As local ADMIN and ACCOUNTANT open Chốt debit, Hoàn cược, Hoàn ứng, Hóa đơn and
Phơi phiếu. Click a real filter/field at390/768/1440, then inspect the topbar and
document title. Expected: each identifies its actual screen, never only TransTing;
no duplicate body title required on phone. Unknown paths retain the brand fallback.
Save screenshots, actual title assertions, unchanged API snapshots and driver log.

# QA-AUDIT-UI-17 — record facts cannot overlap their neighbors

Open Hoàn cược at390/768/1440 with existing long Bill values and the full label
Ngày dự kiến hoàn cược. Click a real filter, then inspect every record cell and
scroll the populated list. Expected: labels and complete values stay in their own
cells, no clipping or crossing the divider; dates and Money remain readable.
Sweep shared record consumers (invoice, catalog, expenses and work inbox).
Desktop keeps the natural grid/token widths. API snapshots remain unchanged.
