import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateImportRows, type ImportPreviewRoute } from '../../services/quotation-import.service';
import { computePortZoneConfigSurcharge } from '../../services/zone-surcharge.service';

const here = dirname(fileURLToPath(import.meta.url));
const readSvc = (name: string) => readFileSync(join(here, '..', '..', 'services', name), 'utf8');

describe('K2.22 — quotation XLSX re-import skips genuinely blank Giá cos cells', () => {
  const baseRoute = (rows: ImportPreviewRoute['rows']): ImportPreviewRoute => ({
    factoryName: 'ASKEY-XƯỞNG 1',
    routeId: 1,
    matchedRouteName: 'KCN Quế Võ',
    sharePct: 4,
    rows,
    errors: [],
  });

  test('valid blank Giá cos cells (unpriced classes from export) produce 0 errors alongside priced rows', () => {
    const issues = validateImportRows(baseRoute([
      {
        classCode: 'CONT20.LIGHT', classLabel: 'Cont 20 < 20T',
        heSo: 1, liters: 60, giaCos: 3952000, giaCosRawEmpty: false,
        basePrice: null, billingKmOneWay: null, error: null, surcharge: null,
        sourceRow: 8, sourceCol: 2,
      },
      {
        classCode: 'CONT20.HEAVY', classLabel: 'Cont 20 > 20T',
        heSo: 1, liters: 60, giaCos: null, giaCosRawEmpty: true,
        basePrice: null, billingKmOneWay: null, error: null, surcharge: null,
        sourceRow: 8, sourceCol: 3,
      },
    ]));
    assert.equal(issues.length, 0);
  });

  test('non-empty invalid Giá cos (0 or non-numeric) still produces a row error', () => {
    const issues = validateImportRows(baseRoute([
      {
        classCode: 'CONT20.LIGHT', classLabel: 'Cont 20 < 20T',
        heSo: 1, liters: 60, giaCos: 0, giaCosRawEmpty: false,
        basePrice: null, billingKmOneWay: null, error: null, surcharge: null,
        sourceRow: 8, sourceCol: 2,
      },
      {
        classCode: 'CONT40.LIGHT', classLabel: 'Cont 40 < 20T',
        heSo: 1, liters: 80, giaCos: null, giaCosRawEmpty: false,
        basePrice: null, billingKmOneWay: null, error: null, surcharge: null,
        sourceRow: 8, sourceCol: 4,
      },
    ]));
    assert.equal(issues.length, 2);
  });

  test('route where every class has blank Giá cos still errors (0 priced rows)', () => {
    const issues = validateImportRows(baseRoute([
      {
        classCode: 'CONT20.HEAVY', classLabel: 'Cont 20 > 20T',
        heSo: 1, liters: 60, giaCos: null, giaCosRawEmpty: true,
        basePrice: null, billingKmOneWay: null, error: null, surcharge: null,
        sourceRow: 8, sourceCol: 3,
      },
    ]));
    assert.equal(issues.length, 1);
    assert.match(issues[0]!.message, /Giá cos > 0/);
  });
});

describe('K2.121 — Lạch Huyện port_zone_surcharges config auto-calculation', () => {
  test('counts each configured pickup/dropoff end per container (e.g. Hateco 500.000₫/đầu)', () => {
    const amountByPort = new Map<number, number>([[10, 500000]]);
    assert.equal(
      computePortZoneConfigSurcharge([{ pickupPortId: 2, dropoffPortId: 10 }], amountByPort),
      500000,
    );
    assert.equal(
      computePortZoneConfigSurcharge([{ pickupPortId: 10, dropoffPortId: 10 }], amountByPort),
      1000000,
    );
    assert.equal(
      computePortZoneConfigSurcharge([{ pickupPortId: 2, dropoffPortId: 3 }], amountByPort),
      null,
    );
  });
});

describe('K2.120 — chot-debit otherSellKnown only arms on OTHER expenses with sellAmount', () => {
  test('accounting-debit-close guards otherSellKnown inside expenseType === OTHER && sell != null', () => {
    const src = readSvc('accounting-debit-close.service.ts');
    assert.match(src, /if \(row\.expenseType === 'OTHER' && row\.sell != null\) \{\s*otherSellKnown\.add\(row\.shipmentId\);/);
  });
});
