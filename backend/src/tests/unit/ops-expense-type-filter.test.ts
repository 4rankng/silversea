// SIL-770 (owner decision 09/11/2026, "khách hàng bảo thế nào thì làm thế") —
// the Ops/CUS "Khai báo chi phí" picker filters the DRIVER's own cost buckets
// (tiền dầu, sửa chữa dọc đường/vá vỏ) out of the catalog; the driver side
// keeps its full list. The live rule is `opsDeclarableExpenseTypes`
// (ops-expenses.service.ts) — a pure tail so this test needs no database
// (BE unit tests are db-free, owner ruling 2026-10-19); the source pin below
// proves the endpoint actually applies it.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DRIVER_EXPENSE_TYPE_CODES } from '@tingting/shared';
import { opsDeclarableExpenseTypes } from '../../services/ops-expenses.service';

const here = dirname(fileURLToPath(import.meta.url));
const serviceSource = readFileSync(join(here, '../../services/ops-expenses.service.ts'), 'utf8');

const row = (code: string, name = `Pin ${code}`) => ({ id: 1, code, name, requiresInvoice: false, category: null });

test('SIL-770: the Ops picker drops every driver-only cost code', () => {
  const driverOnly = Object.keys(DRIVER_EXPENSE_TYPE_CODES);
  assert.ok(driverOnly.includes('FUEL'), 'FUEL (tiền dầu) is a driver cost');
  assert.ok(driverOnly.includes('ROAD_REPAIR'), 'ROAD_REPAIR (vá vỏ/sửa dọc đường) is a driver cost');
  const items = [
    row('FUEL', 'Phí nhiên liệu / dầu'),
    row('ROAD_REPAIR', 'Phí sửa chữa dọc đường'),
    row('INSPECTION', 'Phí kiểm hóa tại cảng'),
    row('FEE_STEVEDORING', 'Phí bốc xếp'),
    row('INFRASTRUCTURE', 'Phí kết cấu hạ tầng'),
    row('YARD_STORAGE', 'Phí lưu bãi'),
  ];
  const kept = opsDeclarableExpenseTypes(items);
  assert.deepEqual(kept.map((item) => item.code), ['INSPECTION', 'FEE_STEVEDORING', 'INFRASTRUCTURE', 'YARD_STORAGE']);
  assert.equal(items.length, 6, 'the input array is not mutated');
});

test('SIL-770: Ops fees (Kiểm hóa/Luồng đỏ/Bốc xếp/Nâng/Hạ/CSHT/Lưu bãi) stay declarable', () => {
  const opsFees = ['INSPECTION', 'FEE_SCANNING', 'FEE_STEVEDORING', 'LIFTING', 'LOWERING', 'INFRASTRUCTURE', 'YARD_STORAGE_LIFT'];
  const kept = opsDeclarableExpenseTypes(opsFees.map((code) => row(code)));
  assert.deepEqual(kept.map((item) => item.code), opsFees, 'no Ops fee leaves the picker');
});

test('SIL-770: the catalog endpoint applies the filter (source pin)', () => {
  assert.match(
    serviceSource,
    /return opsDeclarableExpenseTypes\(rows\)/,
    'listActiveOpsExpenseTypes must pass its rows through opsDeclarableExpenseTypes',
  );
  assert.match(
    serviceSource,
    /DRIVER_EXPENSE_TYPE_CODES/,
    'the filter reads the shared DRIVER_EXPENSE_TYPE_CODES classification',
  );
});
