// SIL-548 (id 615, QA fail round 3) — the per-lot cước thu editor's
// REOPEN-PREFILL + GROUP-LOCK law, pinned in the unit-only tree (no db, no
// app boot — 2026-10-19 owner ruling):
//   - the manual-price note vocabulary classifies a lot's money note (which
//     writer stamped it: CUS's negotiated price vs an auto trace vs a group
//     artifact);
//   - `revManualPrice` reads the WINNING channel note with the money boards'
//     own channel precedence (override for a qualified lot, snapshot
//     otherwise) so the editor prefill can never diverge from what the
//     settlement boards print;
//   - the Chi tiết wire carries BOTH merge dimensions and the saved manual
//     price onto the lot rows (source-scan — the db-bound projection cannot
//     run here).
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isRevManualPriceNote,
  REV_LOT_AWAITING_REPRICE_REASON,
  REV_LOT_MANUAL_PRICE_REASON,
  revGroupManualPriceNote,
} from '../../services/lcl-rev-notes';
import { revManualPrice } from '../../services/lcl-effective-freight';

const here = dirname(fileURLToPath(import.meta.url));
const reads = readFileSync(join(here, '../../services/cus-shipment-workspace-reads.service.ts'), 'utf8');
const lotRowSource = () => reads.slice(
  reads.indexOf('function buildLotFlatRow('),
  reads.indexOf('export async function listCusShipmentContainers('),
);
const pageSource = () => reads.slice(reads.indexOf('export async function listCusShipmentContainers('));

test('manual-price vocabulary: only CUS negotiated prices classify manual', () => {
  assert.equal(isRevManualPriceNote(REV_LOT_MANUAL_PRICE_REASON), true);
  assert.equal(isRevManualPriceNote(revGroupManualPriceNote('5T')), true);
  // Auto traces are NOT manual — the editor must reopen blank for them.
  assert.equal(isRevManualPriceNote('Chọn loại xe tính cước thu khách — Xe 5T'), false);
  assert.equal(isRevManualPriceNote('Chọn loại xe tính cước thu khách — 100% bảng giá khách × tuyến × 5T, ngày 2026-10-26'), false);
  // Group artifacts keep their citation but never masquerade as manual.
  assert.equal(isRevManualPriceNote('Ghép cước cùng Bill BL-1'), false);
  assert.equal(isRevManualPriceNote(REV_LOT_AWAITING_REPRICE_REASON), false);
  assert.equal(isRevManualPriceNote(null), false);
});

test('revManualPrice reads the WINNING channel note (money-board precedence)', () => {
  const manualSnapshot = { total: 1_600_000, formulaNote: REV_LOT_MANUAL_PRICE_REASON };
  const autoSnapshot = { total: 3_100_000, formulaNote: 'Chọn loại xe tính cước thu khách — Xe 10T' };
  const base = { revGroupId: null, revGroupOrder: null, cargoMode: 'LCL' };

  // Unqualified lot (no group, no stamp): the snapshot channel decides.
  assert.equal(revManualPrice({ ...base, snapshotChannel: manualSnapshot, override: null }), 1_600_000);
  assert.equal(revManualPrice({ ...base, snapshotChannel: autoSnapshot, override: null }), null);

  // Stamped lot: the override channel wins — the manual stamp reads back…
  assert.equal(revManualPrice({
    ...base,
    snapshotChannel: manualSnapshot,
    override: { total: 900_000, reason: REV_LOT_MANUAL_PRICE_REASON, stamped: true },
  }), 900_000);
  // …and a stamped AUTO over a stale manual snapshot reads blank (the money
  // board shows the trace; the editor must NOT resurrect the superseded
  // manual).
  assert.equal(revManualPrice({
    ...base,
    snapshotChannel: manualSnapshot,
    override: { total: 3_100_000, reason: 'Chọn loại xe tính cước thu khách — Xe 10T', stamped: true },
  }), null);

  // A rev-grouped lot qualifies through its group even unstamped.
  assert.equal(revManualPrice({
    revGroupId: 'rev-1', revGroupOrder: 1, cargoMode: 'LCL',
    snapshotChannel: manualSnapshot,
    override: null,
  }), 1_600_000);

  // Nothing anywhere → null (the blank "Bỏ trống = tự tra" state).
  assert.equal(revManualPrice({ ...base, snapshotChannel: null, override: null }), null);
});

test('the Chi tiết wire carries BOTH group dimensions + the saved manual price (source pin)', () => {
  const lotRow = lotRowSource();
  assert.match(lotRow, /revGroupId: row\.shipment\.revGroupId \?\? null/);
  assert.match(lotRow, /costGroupId: row\.shipment\.costGroupId \?\? null/);
  assert.match(lotRow, /revFreightManual/);
  const page = pageSource();
  // The manual price rides the shared money channel loader, never a parallel
  // read — and container rows keep the uniform null shape.
  assert.match(page, /loadRevManualPriceByLot\(/);
  assert.match(page, /costGroupId: null/);
  assert.match(page, /revFreightManual: null/);
});
