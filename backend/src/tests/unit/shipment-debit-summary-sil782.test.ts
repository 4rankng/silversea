/**
 * SIL-782 (REV2, ticket-v2 Phần VI mục 2, 09/11/2026) — the /shipments-debit
 * flat board's two sell columns + the CUS giá-vồn strip:
 *  - `chiHoSellTotal` (Tổng Chi hộ Có HĐ = pass-through recharge + negotiated
 *    HQGS charge) and `serviceSellTotal` (Tổng Dịch vụ Không HĐ = typed Phí
 *    khác sell + entered PS thực tế) conserve the receivable sum with
 *    freightAuto — knowns-sum, null when no data backs either component;
 *  - for the CUS role the producer STRIPS the cost fields (cước trả vendor /
 *    tổng chi phí đầu vào / biên lợi nhuận) from the wire — the board never
 *    carries giá vốn.
 * Static source pins + schema parse checks (BE unit tests are db-free per
 * the 2026-10-19 owner ruling); the money itself is verified by the qa drive
 * (qa/scripts/r9b-ops-debit-drive.mjs).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shipmentDebitSummaryItemSchema } from '@tingting/shared';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, '../../services/shipment-debit-summary.service.ts'), 'utf8');
const routesSource = readFileSync(join(here, '../../routes/shipments/core.routes.ts'), 'utf8');

test('SIL-782: the summary emits the two sell columns from the revenue composition', () => {
  // Chi hộ (Có HĐ) = derived recharge + HQGS negotiated charge.
  assert.match(source, /chiHoSellTotal = knownSum\(/);
  assert.match(source, /revenue != null \? revenue\.derived : null,/);
  assert.match(source, /opsCharge\?\.known \? opsCharge\.total : null,/);
  // Dịch vụ (Không HĐ) = typed Phí khác sell + entered PS thực tế.
  assert.match(source, /serviceSellTotal = knownSum\(/);
  assert.match(source, /revenue != null \? revenue\.otherSell : null,/);
  assert.match(source, /ps\?\.known \? ps\.total : null,/);
  // Emitted on the row, string-encoded like every money field.
  assert.match(source, /chiHoSellTotal: chiHoSellTotal == null \? null : String\(chiHoSellTotal\)/);
  assert.match(source, /serviceSellTotal: serviceSellTotal == null \? null : String\(serviceSellTotal\)/);
});

test('SIL-782: the CUS wire strips the giá-vốn fields (TUYỆT ĐỐI ẨN clause)', () => {
  assert.match(source, /const hideCost = query\.viewerRole === 'CUS';/);
  assert.match(source, /carrierCostTotal: hideCost \|\| externalFreight == null \? null : String\(externalFreight\)/);
  assert.match(source, /opsCostTotal: hideCost \|\| opsTotal == null \? null : String\(opsTotal\)/);
  assert.match(source, /payableTotal: hideCost \? null : payableTotal/);
  assert.match(source, /profit: hideCost \? null : \(profit == null \? null : String\(profit\)\)/);
  assert.match(routesSource, /viewerRole: getUser\(req\)\.role/);
});

const baseRow = {
  customerId: null, shipmentId: 1, code: 'S', customerName: null, factoryName: null,
  factoryAddress: null, billOrBookNumber: null, customsNumber: null, documentsSummary: null,
  freightAuto: null, freightOverrideReason: null, chiHoTotal: null, receivableTotal: null,
  payableTotal: null, profit: null, lockStatus: 'OPEN' as const, lockedAt: null,
  cargoWeightKg: null, cargoVolumeCbm: null, cargoMode: null, costGroupId: null,
  costGroupOrder: null, revGroupId: null, revGroupOrder: null, costGroupMemberCount: null,
  revGroupMemberCount: null, actualTruckNo: null, billingTruckNo: null,
  costVehicleClassCode: null, revVehicleClassCode: null, revGroupPrincipalRef: null,
  costGroupPrincipalRef: null,
};

test('SIL-782: the sell columns are optional + nullable on the shared contract (skew-safe)', () => {
  const older = shipmentDebitSummaryItemSchema.safeParse(baseRow);
  assert.equal(older.success, true, 'an older response without the sell columns still parses');
  const full = shipmentDebitSummaryItemSchema.safeParse({
    ...baseRow, chiHoSellTotal: '300000', serviceSellTotal: null,
  });
  assert.equal(full.success, true);
  if (full.success) {
    assert.equal(full.data.chiHoSellTotal, '300000');
    assert.equal(full.data.serviceSellTotal, null);
  }
  const junk = shipmentDebitSummaryItemSchema.safeParse({
    ...baseRow, chiHoSellTotal: 300000,
  });
  assert.equal(junk.success, false, 'money rides the wire as a string, never a number');
});
