// SIL-1081 (K2.120 merge-grid limb) — the merge grid's money cells follow the
// KB Ch.10 money law: a wire-null cell reads null (FE ghosts '—'), never a
// fabricated '0'. Two backend channels fabricated zeros the chot-debit board
// (already fixed by f9400a73's board sweep) no longer does:
//
//   1. PHỤ PHÍ: the merge grain loop armed psAutoByLot unconditionally, so a
//      priced freight snapshot whose surcharge was NEVER COMPUTED (0 with
//      zeroed fuel trace ids) priced the cell '0'. The board's twin channel
//      carries the K2.120 surchargeComputed gate; the merge loop must too.
//   2. PHÁT SINH (CUS): revenueByLot armed 'known' from ANY trip_expense row,
//      so a lot with only derived-type rows read otherSell 0 → '0'. The
//      board's law arms the cell from OTHER-sell rows only.
//
// Pure source pins (house pattern sil1050/sil1072): the wire assembly is
// route+DB code — the endpoint-level shape rides debit-merge-override-zero's
// real-router harness.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const mergeSource = readFileSync(join(here, '..', '..', 'services', 'debit-merge.service.ts'), 'utf8');

describe('SIL-1081 — merge grain Phụ phí rides the K2.120 surchargeComputed gate', () => {
  test('the leg carries surchargeComputed (0 surcharge + zeroed fuel trace ids = never computed)', () => {
    assert.match(mergeSource, /surchargeComputed: toNumber\(row\.surchargeAmount\) > 0\n\s*\|\| \(row\.fuelNormId !== 0 && row\.fuelPricePeriodId !== 0\)/);
  });

  test('trip-leg accumulator folds surchargeComputed across legs', () => {
    assert.match(mergeSource, /acc\.surchargeComputed = acc\.surchargeComputed \|\| leg\.surchargeComputed/);
  });

  test('psAutoByLot arms only a computed surcharge (no fabricated Phụ phí 0)', () => {
    assert.match(mergeSource, /if \(pick !== undefined && pick\.surchargeComputed\) \{\s*\n\s*psAutoByLot\.set\(lot, pick\.surcharge\);/);
  });
});

describe('SIL-1081 — merge Phát sinh (CUS) known only from OTHER-sell rows (board parity)', () => {
  test('the OTHER branch arms a dedicated known set', () => {
    assert.match(mergeSource, /const otherSellKnownLots = new Set<number>\(\);/);
    assert.match(mergeSource, /if \(row\.expenseType === 'OTHER'\) \{\s*\n\s*entry\.otherSell \+= toNumber\(row\.sell\);\s*\n\s*otherSellKnownLots\.add\(row\.shipmentId\);/);
  });

  test('the wire phatSinh cell reads the OTHER-only known set, never the any-row accumulator', () => {
    assert.match(mergeSource, /phatSinh: otherSellKnownLots\.has\(lot\.id\) \? String\(revenue\?\.otherSell \?\? 0\) : null,/);
  });

  test('the receivable rollup keeps its any-row law (only the CELL narrows)', () => {
    assert.match(mergeSource, /hasRevenueRows: revenue != null,/);
  });
});
