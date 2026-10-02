import { test } from 'node:test';
import assert from 'node:assert';
import {
  QUOTATION_GRID_COLUMNS,
  QUOTATION_PATHS,
  isQuotationContainerClass,
  quotationBaseClassCode,
  quotationCellSchema,
  quotationCreateSchema,
} from './index';

// Card 20260922_66: the quotation grid reproduces Mẫu báo giá 1's column
// order/labels exactly; the weight-band rule is a contract, not a service detail.

test('grid layout matches the Mẫu 1 file column order', () => {
  assert.strictEqual(QUOTATION_GRID_COLUMNS.length, 10);
  assert.deepStrictEqual(
    QUOTATION_GRID_COLUMNS.map((c) => c.vehicleSizeClassCode),
    [
      '1.25T',
      '2.5T',
      '3.5T',
      '5T',
      '8T',
      '10T',
      'CONT20.LIGHT',
      'CONT20.HEAVY',
      'CONT40.LIGHT',
      'CONT40.HEAVY',
    ],
  );
});

test('container classes resolve to base codes for norms', () => {
  assert.strictEqual(isQuotationContainerClass('CONT20'), true);
  assert.strictEqual(isQuotationContainerClass('CONT40.LIGHT'), true);
  assert.strictEqual(isQuotationContainerClass('1.25T'), false);
  assert.strictEqual(quotationBaseClassCode('CONT20.HEAVY'), 'CONT20');
  assert.strictEqual(quotationBaseClassCode('CONT40.LIGHT'), 'CONT40');
  assert.strictEqual(quotationBaseClassCode('10T'), '10T');
  const ok = quotationCellSchema.safeParse({ routeId: 1, vehicleSizeClassCode: 'CONT20.LIGHT' });
  assert.strictEqual(ok.success, true);
});

test('heSo defaults to 1 and rejects out-of-range values', () => {
  const cell = quotationCellSchema.parse({
    routeId: 1,
    vehicleSizeClassCode: 'CONT20.HEAVY',
  });
  assert.strictEqual(cell.heSo, 1);
  assert.strictEqual(
    quotationCellSchema.safeParse({ routeId: 1, vehicleSizeClassCode: 'CONT20.HEAVY', heSo: -1 }).success,
    false,
  );
  assert.strictEqual(
    quotationCellSchema.safeParse({ routeId: 1, vehicleSizeClassCode: 'CONT20.HEAVY', heSo: 1000 }).success,
    false,
  );
});

test('create schema coerces ids and defaults empty cells', () => {
  const parsed = quotationCreateSchema.parse({
    customerId: '7',
    templateName: 'Mẫu báo giá 1',
    effectiveDate: '2026-09-22',
  });
  assert.strictEqual(parsed.customerId, 7);
  assert.deepStrictEqual(parsed.cells, []);
});

test('quotation paths resolve', () => {
  assert.strictEqual(QUOTATION_PATHS.LIST, '/quotations');
  assert.strictEqual(QUOTATION_PATHS.DETAIL(3), '/quotations/3');
});
