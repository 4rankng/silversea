// cases/chungtu-regression/index.mjs — topic set for the 2026-09-06/07 customer
// regression sweep. Re-run with:
//   STAGING_URL=https://vantai.tingting.vip \
//   node testplan/qa/scripts/run-all.mjs chungtu-regression

export const cases = [
  { id: 'FACTORY-DISPLAY-REGRESSION-2026-09-07', role: 'CUS', file: 'factory-display.mjs' },
  { id: 'TC-CUS-CREATE-021', role: 'CUS', file: 'TC-CUS-CREATE-021.mjs' },
  { id: 'TC-CUS-CREATE-022', role: 'CUS', file: 'TC-CUS-CREATE-022.mjs' },
  { id: 'TC-CUS-CREATE-023', role: 'CUS', file: 'TC-CUS-CREATE-023.mjs' },
  { id: 'TC-CUS-CREATE-026', role: 'CUS', file: 'TC-CUS-CREATE-026.mjs' },
  { id: 'TC-CUS-CREATE-028', role: 'CUS', file: 'TC-CUS-CREATE-028.mjs' },
  // API-contract regression pins (2026-09-16). WRITE-ONLY UNTIL THE STAGING
  // CUT: both cases degrade to SKIP (non-failing) on pre-fix behavior
  // (phantom refs accepted / details stringified blob) — do not RUN them
  // against staging before the cut lands; pre-fix 201/200 creates orphan rows.
  { id: 'TC-CUS-API-MASTERREF-001', role: 'CUS', file: 'TC-CUS-API-MASTERREF-001.mjs' },
  { id: 'TC-CUS-API-ERRCONTRACT-001', role: 'CUS', file: 'TC-CUS-API-ERRCONTRACT-001.mjs' },
];
