# QA-AUDIT-UI-28B — one expense workspace name

Local ADMIN opens /accounting/expenses at390,768,1440. Expect the phone topbar and tablet/desktop topbar plus shared PageHeader to use “Chi phí phát sinh”, sourced from the existing page catalog. The description/queues/actions and row data retain their original meaning. Open an existing expense drawer and Cancel; source reads remain unchanged. Regression: titleForPath('/accounting/expenses') equals the established expenses catalog title. Final route screenshots and actual driver/source parity are required before this case is reported UI DRIVEN.
