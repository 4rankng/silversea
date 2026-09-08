// cases/customer-regression/index.mjs — topic set for the 2026-09-06/07 customer
// regression sweep. Re-run with:
//   STAGING_URL=https://vantai.tingting.vip \
//   node testplan/qa/scripts/run-all.mjs customer-regression

export const cases = [
  { id: 'FACTORY-DISPLAY-REGRESSION-2026-09-07', role: 'CUS', file: 'factory-display.mjs' },
  { id: 'TC-CUS-CREATE-021', role: 'CUS', file: 'TC-CUS-CREATE-021.mjs' },
  { id: 'TC-CUS-CREATE-022', role: 'CUS', file: 'TC-CUS-CREATE-022.mjs' },
  { id: 'TC-CUS-CREATE-023', role: 'CUS', file: 'TC-CUS-CREATE-023.mjs' },
  { id: 'TC-CUS-CREATE-026', role: 'CUS', file: 'TC-CUS-CREATE-026.mjs' },
  { id: 'TC-CUS-CREATE-028', role: 'CUS', file: 'TC-CUS-CREATE-028.mjs' },
];
