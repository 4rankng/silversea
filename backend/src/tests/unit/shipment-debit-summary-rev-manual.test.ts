/**
 * Audit 2026-11-04 §2.2 — the L1 summary ships the lot's SAVED manual "Giá
 * cước thu khách" (`revFreightManual`) over the SAME SIL-548 channel the CUS
 * container ledger prefills from, so the settlement strip's reopen shows the
 * saved price instead of blank ("giá bị tiêu khi lưu", CHANGELOG 2026-10-28).
 * Static source pin + shared-zod contract check (unit-only tree, no DB).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shipmentDebitSummaryItemSchema } from '@tingting/shared';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, '../../services/shipment-debit-summary.service.ts'), 'utf8');

test('loads the saved manual price through the ONE SIL-548 channel (never a parallel assembly)', () => {
  assert.match(source, /import \{ loadFreightSnapshotChannelByLot, loadRevManualPriceByLot, loadRevenueOverrideByLot \} from '\.\/revenue-override-read\.service'/);
  assert.match(source, /const revManualByLot = await loadRevManualPriceByLot\(db, lots\.map\(\(lot\) => \(\{/);
  // The channel needs the group facts + cargo mode, exactly as the loader's
  // signature defines — mapped from the summary's own lot rows.
  assert.match(source, /id: lot\.id,\s*revGroupId: lot\.revGroupId \?\? null,\s*revGroupOrder: lot\.revGroupOrder \?\? null,\s*cargoMode: lot\.cargoMode \?\? null,/);
});

test('maps revFreightManual onto every item; null = auto-trace', () => {
  assert.match(source, /const revManual = revManualByLot\.get\(lot\.id\) \?\? null;/);
  assert.match(source, /revFreightManual: revManual == null \? null : String\(revManual\),/);
});

test('the shared zod contract keeps the field optional + nullable (skew-safe)', () => {
  const baseRow = {
    customerId: null, shipmentId: 1, code: 'S', customerName: null, factoryName: null,
    factoryAddress: null, billOrBookNumber: null, customsNumber: null, documentsSummary: null,
    freightAuto: null, freightOverrideReason: null, chiHoTotal: null, receivableTotal: null,
    payableTotal: null, profit: null, lockStatus: 'OPEN', lockedAt: null,
    cargoWeightKg: null, cargoVolumeCbm: null, cargoMode: null, costGroupId: null,
    costGroupOrder: null, revGroupId: null, revGroupOrder: null, costGroupMemberCount: null,
    revGroupMemberCount: null, actualTruckNo: null, billingTruckNo: null,
    costVehicleClassCode: null, revVehicleClassCode: null, revGroupPrincipalRef: null,
    costGroupPrincipalRef: null,
  } as const;
  // Legacy response without the field still parses; the strip falls back to
  // blank (auto).
  const legacy = shipmentDebitSummaryItemSchema.safeParse(baseRow);
  assert.equal(legacy.success, true);
  // A response carrying the saved price parses and keeps the decimal string.
  const withManual = shipmentDebitSummaryItemSchema.safeParse({
    ...baseRow, shipmentId: 2, revFreightManual: '2800000.00',
  });
  assert.equal(withManual.success, true);
  if (withManual.success) assert.equal(withManual.data.revFreightManual, '2800000.00');
  // Explicit null (auto-trace) parses too.
  const autoTrace = shipmentDebitSummaryItemSchema.safeParse({
    ...baseRow, shipmentId: 3, revFreightManual: null,
  });
  assert.equal(autoTrace.success, true);
  if (autoTrace.success) assert.equal(autoTrace.data.revFreightManual, null);
});
