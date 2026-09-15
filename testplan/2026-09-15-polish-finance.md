# Finance presentation polish — 2026-09-15

Scope: financial workspaces and their page/feature components only. Preserve existing financial calculations, role access, online-only and direct-record workflows. No backend, shared primitive, global style, or migration changes. No commits.

Acceptance: compact readable data and controls (12px) and labels (11px), minimal phone gutters, no decorative nested cards, responsive actions, helpful stable loading/error/empty states. Source-audit accounting, finance/profit/treasury, expenses, receivables/payables/fuel invoices, advances/settlements, recoverable costs, salary/discipline. Inspect current UI before edits and repeat representative local Chrome flows at390,834,1440; no claim of every state/role.

| Case | Reproduction | Expected |
|---|---|---|
| FIN-POL-01 | Open expense entry/list and financial ledgers at390/834/1440; inspect filters, record and actions | Form and data use canvas width; no clipped controls, nested decorative boundaries, or avoidable oversized whitespace |
| FIN-POL-02 | Open accounting work/advisory views and finance/profit/treasury | Dense information hierarchy, reachable view controls, consistent section/table layout |
| FIN-POL-03 | Open office and OPS advance/settlement surfaces, interact with tabs, filters and dialog cancel | Responsive action groups and clear state, no lost context or accidental write |
| FIN-POL-04 | Open salary/discipline and select record/detail; inspect phone/tablet/desktop | Salary context and amounts readable, calendar/toolbars and dialog fit, consistent data/labels |
| FIN-POL-05 | Use search/filter to produce empty state and clear it; inspect loading/error handling in source and scoped regressions | Retain filters/context; explicit clear/retry where applicable, no unexplained blank content |

Validation: scoped frontend regressions and TypeScript; root owns combined build/full frontend/lint. Capture UI DOM and screenshots after interactions under qa/2026-09-15-polish-finance. Pure presentation changes make no DB mutation; do not imply DB-side-effect coverage. Report each claim and explicit remaining gaps.

Concrete regression extensions before completion:
- FIN-POL-01a: expense filters have visible date labels, stacked catalog labels, paired dates; reset clears the date range.
- FIN-POL-02a: receivable detail aging is collapsed initially, opens by native disclosure, and leaves the ledger and payment tabs available; balance/risk overview remains visible.
- FIN-POL-03a: office advance phone filter initially says Tất cả; selecting RECORDED then all never sends literal all to backend. Three workspace tabs fit one row at390.
- FIN-POL-01b: commission dialog supplier required marker appears once.
- FIN-POL-02b: analytical profit report uses the shared compact summary; an empty result explicitly explains no matching completed records, and clearing the low-margin filter returns available rows. Loading must not imply zero revenue.
- FIN-POL-02c: accounting leaves one main landmark supplied by the app layout; work-inbox/table remains labelled after removing nested row chrome.
- FIN-POL-04a: salary roster retains a visible bounded scrollbar and selected-driver context; its input width rule must not affect other pages. Reduced-motion preferences suppress roster auto-scroll animation.

Final bounded follow-up acceptance (before edits):
- FIN-POL-03b: OPS advance initial query failure offers retry; retry shows disabled loading feedback, retains the error context, then restores records after success without changing filters.
- FIN-POL-03c: settlement unfinished (DRAFT) filter uses its full-set server count, defaults to0 when absent, and never displays undefined.
- FIN-POL-01c: fuel invoice phone summary/detail/editor metrics remain paired, labels11px/value14px; allocation sections use divided rows without nested decorative borders. Narrow input fields retain their current one-column layout to avoid squeezing trip/evidence selectors.
