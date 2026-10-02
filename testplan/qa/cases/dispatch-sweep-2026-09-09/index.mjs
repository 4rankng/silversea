// testplan/qa/cases/dispatch-sweep-2026-09-09/index.mjs
// Suite for customer-reported issues verified on staging (2026-09-09)

export const cases = [
  { id: 'TC-CUS-CREATE-048', role: 'ADMIN', file: 'TC-CUS-CREATE-048.mjs' },
  { id: 'TC-CUS-APPOINTMENT-001', role: 'ADMIN', file: 'TC-CUS-APPOINTMENT-001.mjs' },
  { id: 'TC-SHIPMENTS-DETAIL-001', role: 'ADMIN', file: 'TC-SHIPMENTS-DETAIL-001.mjs' },
  { id: 'TC-DISPATCH-ALLOC-001', role: 'ADMIN', file: 'TC-DISPATCH-ALLOC-001.mjs' },
  { id: 'TC-DISPATCH-EDIT-001', role: 'ADMIN', file: 'TC-DISPATCH-EDIT-001.mjs' },
  { id: 'TC-DISPATCH-EDIT-002', role: 'ADMIN', file: 'TC-DISPATCH-EDIT-002.mjs' },
  // Card 20260928_155: these three files were on disk but unregistered, so
  // run-all.mjs never executed them. TC-DV-DISPATCH-051 PASSES when run by
  // hand — a green topic was hiding a passing-but-unrun case. The other two
  // need fixtures the local dev DB lacks and return BLOCKED, which run-all
  // already counts as "not verified" (nonzero exit).
  { id: 'TC-DV-DISPATCH-051', role: 'ADMIN', file: 'TC-DV-DISPATCH-051.mjs' },
  { id: 'TC-DISPATCH-REASSIGN-001', role: 'ADMIN', file: 'TC-DISPATCH-REASSIGN-001.mjs' },
  { id: 'TC-ROAD-ALLOWANCE-001', role: 'ADMIN', file: 'TC-ROAD-ALLOWANCE-001.mjs' },
];
