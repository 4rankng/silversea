# Customer workflow audit — CUS, dispatcher, driver

User requested browser-driven workflow testing only; no automated suites for this pass. All work remains uncommitted on latest prod. Local dev uses actual server data, never fake browser responses.

- FLOW-CUS-01: Create an undated FCL shipment, add a second container, save, locate via full/suffix search, open detail, supplement appointment/container/notes, reload and confirm persistence. Invalid required data must keep the draft and explain correction.
- FLOW-CUS-02: Create/edit LCL and combined cargo, validate negative values and missing required fields, cancel safely. Calendar/time selectors must stay compact and reachable.
- FLOW-CUS-03: Exercise overview/detail filters, sort, pagination, inline groups, drawer, exports; selected filters and edited values must survive appropriate navigation.
- FLOW-CATALOG-01: Customer/factory/route management and CUS fuel-period screens, search/create/edit/cancel and invalid entry. Dialogs, tabs and long values must remain usable at390/820/1440px.
- FLOW-DISPATCH-01: Assign/reassign and release a shipment to an internal vehicle and a driver; verify task/driver notes, appointment and movement semantics. Pair compatible containers, reject incompatible assignments clearly without losing draft.
- FLOW-DISPATCH-02: General/detail plan filters/tabs/quick edits, customer/route create-only boundaries, truck/driver/carrier resource lookups and details.
- FLOW-DRIVER-01: New → accepted → started → complete journey including details, container/seal edits, BBGH attachment and POD. Validate missing input; reload and confirm saved state.
- FLOW-DRIVER-02: History, income, payslips, penalties, notifications, profile/navigation. Correct period/state, no irrelevant pending approvals or offline queue promises.
- FLOW-RESPONSIVE-01: Phone/tablet/desktop on every role's main and supporting pages. No viewport overflow, clipped required actions, nested label grids, oversized whitespace, or vertical scrollbar tracks on phone. Content must remain scrollable.

Record observed results and exact newly reproduced defects in qa/2026-09-15_customer-workflows/. Add specific regression steps here before fixing a newly reproduced issue.
