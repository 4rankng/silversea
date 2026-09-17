// cases/shipments-qa/index.mjs — comprehensive /shipments page QA.
// Re-run with:
//   STAGING_URL=https://vantai.tingting.vip \
//   node testplan/qa/scripts/run-all.mjs shipments-qa

export const cases = [
  // Search & filters
  { id: 'TC-SHIP-SEARCH-001', role: 'ADMIN', file: 'TC-SHIP-SEARCH-001.mjs' },
  // Quick edit all fields (identity, documents, classification, cargo, schedule, notes)
  { id: 'TC-SHIP-QUICKEDIT-001', role: 'ADMIN', file: 'TC-SHIP-QUICKEDIT-001.mjs' },
  // Schedule quick edit dialog stability (known bug area)
  { id: 'TC-SHIP-QUICKEDIT-SCHEDULE-001', role: 'ADMIN', file: 'TC-SHIP-QUICKEDIT-SCHEDULE-001.mjs' },
  // Detail drawer + container ledger
  { id: 'TC-SHIP-DRAWER-001', role: 'ADMIN', file: 'TC-SHIP-DRAWER-001.mjs' },
  // Actions: confirm finance, lock, reopen
  { id: 'TC-SHIP-ACTIONS-001', role: 'ADMIN', file: 'TC-SHIP-ACTIONS-001.mjs' },
];
