import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

// SIL-933 (KB K1.3) — Lô lẻ tạo xong phải CÓ cước dự kiến: the auto engine
// locks at intake from the lot's own grounds (route + 'Trọng tải (Loại xe
// tính cước)' + ngày giao dự kiến), exactly like FCL locks from its first
// container. Source-scan lane (unit-only tree: no db, no app boot — same
// precedent as quote-engine-wiring). Data thiếu bảng giá ⇒ MANUAL zeros +
// hint, never an invented number.
const here = dirname(fileURLToPath(import.meta.url));
const lifecycle = readFileSync(join(here, '../../services/freight-rate-snapshot-lifecycle.service.ts'), 'utf8');
const createSvc = readFileSync(join(here, '../../services/shipment-create.service.ts'), 'utf8');
const updateSvc = readFileSync(join(here, '../../services/shipment-update.service.ts'), 'utf8');

test('SIL-933: grounds derive the LCL rate key from the lot rev class (no container needed)', () => {
  // The grounds shipment read carries the lot's pricing class.
  assert.match(lifecycle, /revVehicleClassId: s\.shipments\.revVehicleClassId/);
  // The fallback reads the live catalog (deleted rows never key a price).
  assert.match(lifecycle, /if \(!rateKey && shipment\.revVehicleClassId != null\) \{/);
  const fallback = lifecycle.slice(
    lifecycle.indexOf('if (!rateKey && shipment.revVehicleClassId != null) {'),
    lifecycle.indexOf('let containerCargoWeightKg'),
  );
  assert.match(fallback, /from\(s\.vehicleSizeClasses\)/);
  assert.match(fallback, /isNull\(s\.vehicleSizeClasses\.deletedAt\)/);
  assert.match(fallback, /rateKey = revClass\?\.code \?\? null/);
});

test('SIL-933: an LCL lot born ready locks its freight in the create tx', () => {
  // The lock sits INSIDE the LCL branch (FCL keeps its container-driven lock).
  const lclBranch = createSvc.slice(
    createSvc.indexOf("if (finalized.cargoMode === 'LCL') {"),
    createSvc.indexOf('return { shipment: finalized };'),
  );
  assert.match(lclBranch, /await lockShipmentFreightRate\(tx, \{ shipmentId: finalized\.id \}\)/);
  // The lock is gated on LCL — the FCL quick-create lock stays single-fire.
  const lclBranchStart = createSvc.indexOf("if (finalized.cargoMode === 'LCL') {");
  assert.ok(
    createSvc.indexOf('await lockShipmentFreightRate(tx, { shipmentId: finalized.id })', lclBranchStart)
      > lclBranchStart,
    'the intake lock lives in the LCL branch',
  );
});

test('SIL-933: a Loại xe tính cước change supersedes the snapshot like a date change', () => {
  assert.match(updateSvc, /const revVehicleClassChanged = input\.revVehicleClassId !== undefined/);
  assert.match(updateSvc, /&& input\.revVehicleClassId !== existing\.revVehicleClassId;/);
  // One shared lock call answers BOTH triggers.
  const relock = updateSvc.slice(
    updateSvc.indexOf('const revVehicleClassChanged'),
    updateSvc.indexOf('await lockShipmentFreightRate(tx, { shipmentId: id })'),
  );
  assert.match(relock, /\|\| revVehicleClassChanged/);
});
