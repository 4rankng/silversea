// SIL-807 (UAT KH 12/11) — cột Chi phí phát sinh / Số HĐ trên bảng phơi phiếu
// phải hiện TOÀN BỘ khoản chi có của lô, không chỉ OPS: DRIVER (lái xe khai)
// và TRIP (chi phí chuyến) cùng vào chiHoRows với id/giá/version của kind đó
// (unit source pins, no db — 2026-10-19 owner ruling).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { test } from 'node:test';

const source = readFileSync(
  path.resolve(process.cwd(), 'src/services/phoi-phieu-control.service.ts'),
  'utf8',
);

test('chiHoRows composes OPS + DRIVER + TRIP rows, not OPS alone', () => {
  const push = source.slice(source.indexOf('chiHoRows: ['), source.indexOf(']\n    };\n  }\n  return out;') > 0
    ? source.indexOf(']\n    };\n  }\n  return out;')
    : source.length);
  assert.match(push, /opsByShipment\.get\(row\.shipmentId\)/, 'OPS rows keep the shipment grouping');
  assert.match(push, /driverByTrip\.get\(row\.tripId\)/, 'DRIVER rows join by trip');
  assert.match(push, /tripByShipment\.get\(row\.shipmentId\)/, 'TRIP rows join by shipment');
  assert.match(push, /sourceKind: 'DRIVER' as const,\s*\n\s*costType: source\.costType/,
    'DRIVER rows carry costType for the fee-label fallback');
});

test('the DRIVER source query reads the incidental-cost native id + invoice fields', () => {
  assert.match(source, /eq\(s\.expenseAccountingSources\.sourceKind, 'DRIVER'\),\s*\n\s*confirmationCondition\(query\.confirmation\)\)\);\s*\n\s*const driverByTrip/,
    'the DRIVER query filters registry DRIVER rows of the page trips with the same confirmation rule');
  assert.match(source, /entryId: s\.driverIncidentalCosts\.id,\s*\n\s*feeName: s\.driverIncidentalCosts\.feeName,\s*\n\s*costType: s\.driverIncidentalCosts\.costType,\s*\n\s*invoiceNumber: s\.driverIncidentalCosts\.invoiceNumber,/,
    'DRIVER hydration carries the mutation id space and invoice fields');
});

test('TRIP hydration selects the invoice fields the board editor needs', () => {
  assert.match(source, /entryId: s\.tripExpenses\.id,\s*\n\s*feeName: s\.tripExpenses\.feeName,\s*\n\s*invoiceNumber: s\.tripExpenses\.invoiceNumber,/,
    'tripSources selects entryId/feeName/invoiceNumber');
});
