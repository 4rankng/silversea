// SIL-1030 (K6.13) — shipment-keyed selection pins for the consolidated phiếu.
// The drawer's shared lot (a shipment's fees with no single live trip,
// SIL-729) must book through the SAME engine path a trip selection takes:
// one shipment working set, the SAME intake-rule filter, and a namespaced
// physicalReference so trip ids and shipment ids can never collide on the
// treasury uniqueness key.
//
// Unit source pins only, no app boot, no DB — source-scan contract style
// (same as phoi-phieu-source-rule.test.ts).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { test } from 'node:test';

const source = readFileSync(
  path.resolve(process.cwd(), 'src/services/phoi-phieu-control.service.ts'),
  'utf8',
);

const voucher = source.slice(
  source.indexOf('export async function createPhoiPhieuVoucher'),
  source.indexOf('export async function listPhoiPhieuStk'),
);

test('the phiếu input carries the shipment-keyed selection beside tripIds', () => {
  const doc = source.slice(
    source.indexOf('export interface PhoiPhieuVoucherInput'),
    source.indexOf('export function phoiPhieuPhysicalReference'),
  );
  assert.match(doc, /shipmentIds\?: number\[\];/, 'the input accepts the shared-lot selection');
});

test('an empty selection — no trips AND no shipments — is still rejected 400', () => {
  assert.match(voucher, /wantedTripIds\.length === 0 && wantedShipmentIds\.length === 0/,
    'the both-empty guard runs before any query');
  assert.match(voucher, /'Chưa chọn dòng nào để lập phiếu\.'/);
});

test('a direct shipment passes the same alive check a trip gets, and 404s by its own message', () => {
  assert.match(voucher, /from\(s\.shipments\)\s*\n\s*\.where\(and\(inArray\(s\.shipments\.id, wantedShipmentIds\), isNull\(s\.shipments\.deletedAt\)\)\)/,
    'the shared lot ships only against a live (not soft-deleted) shipment');
  assert.match(voucher, /'Có lô không còn hợp lệ\.'/, 'the vanished shipment 404s distinctly from the vanished trip');
});

test('trip picks and the shipment pick land on ONE working set — a multi-trip shipment books once', () => {
  assert.match(voucher, /const shipmentWork = new Map<number, \{ blNumber: string \| null; bookingRef: string \| null \}>\(\);/,
    'the working set is keyed by shipment, not by the picked row');
  assert.match(voucher, /for \(const row of tripRows\) \{[\s\S]*?shipmentWork\.set\(row\.shipmentId/, 'trip picks join the set');
  assert.match(voucher, /for \(const row of directShipments\) \{[\s\S]*?if \(!shipmentWork\.has\(row\.shipmentId\)\) shipmentWork\.set/,
    'the shipment pick joins the same entry instead of doubling');
  assert.match(voucher, /const shipmentIds = \[\.\.\.shipmentWork\.keys\(\)\];/, 'the source read spans the union');
  assert.match(voucher, /for \(const \[shipmentId, identity\] of shipmentWork\)/, 'the entries loop walks shipments');
});

test('the shipment path keeps the SAME intake-rule filter — preview and phiếu cannot drift', () => {
  assert.match(voucher, /\.filter\(\(source\) => !isExcludedOpsNangHaSource\(source, intakeRoleByShipment\)\)/,
    'the lockstep predicate survives the shipment-keyed extension');
});
