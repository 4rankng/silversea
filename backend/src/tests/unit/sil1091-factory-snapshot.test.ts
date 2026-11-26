// SIL-1091 (K3.103) — renaming a factory in the master catalog must never
// silently rename it on a RUNNING lot.
//
// QA repro (staging, build trước fix): lot 1335 chạy với nhà máy
// 'R2E-K103-XM'; đổi tên danh mục thành 'R2E-K103-XM2' ⇒ tên trên lô đổi
// NGAY, version lô giữ nguyên, không có dòng lịch sử, không có thông báo.
//
// Law (KB §3.5.5 K3.103, recorded in
// testplan/2026-11-26-sil1091-factory-rename-snapshot.md): the lot KEEPS the
// factory label it was created/assigned with. The label is frozen
// (snapshot) at every write of `operational_site_id`; display surfaces read
// the snapshot FIRST and only fall back to the live catalog join for rows
// the snapshot never filled. Renaming master data touches neither the lot
// row nor its version — so no lot history entry and no notification are
// required: nothing on the lot mutated.
//
// Db-free unit tree: the two pure seams of the law —
//   • operationalSiteDisplayLabel: WHAT gets frozen at write time
//     (short name preferred, same rule the `operationalName` display join
//     uses, so the snapshot holds exactly the label the lot was showing);
//   • factoryLabelFromSnapshot: HOW a running lot resolves its label at
//     read time (snapshot leads; live join only as fallback).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  factoryLabelFromSnapshot,
  operationalSiteDisplayLabel,
} from '../../services/shipment-lifecycle-shared.service';

test('operationalSiteDisplayLabel freezes the short name when filled — the label the lot was showing', () => {
  // Given: catalog site 'R2E-K103-XM' (name) with short name 'XM'.
  assert.equal(operationalSiteDisplayLabel({ shortName: 'XM', name: 'R2E-K103-XM' }), 'XM');
  // Whitespace-only short name counts as unfilled — falls to the full name.
  assert.equal(operationalSiteDisplayLabel({ shortName: '   ', name: 'R2E-K103-XM' }), 'R2E-K103-XM');
  assert.equal(operationalSiteDisplayLabel({ shortName: null, name: 'R2E-K103-XM' }), 'R2E-K103-XM');
});

test('factoryLabelFromSnapshot: a catalog rename does NOT leak into a running lot (QA repro invariant)', () => {
  // Given: lot 1335 was assigned site 22 while its label read 'R2E-K103-XM'
  // (frozen into factory_name_snapshot).
  // When: the catalog is renamed to 'R2E-K103-XM2' (the live join now
  // resolves the NEW label).
  // Then: the lot still displays the frozen 'R2E-K103-XM' — on every
  // surface that resolves through this precedence.
  assert.equal(
    factoryLabelFromSnapshot('R2E-K103-XM', 22, 'R2E-K103-XM2'),
    'R2E-K103-XM',
  );
  // A whitespace-padded frozen label still leads (trimmed, not discarded).
  assert.equal(
    factoryLabelFromSnapshot('  R2E-K103-XM  ', 22, 'R2E-K103-XM2'),
    'R2E-K103-XM',
  );
});

test('factoryLabelFromSnapshot: the live join is only a fallback for rows the snapshot never filled', () => {
  // Pre-backfill row: no frozen label yet — the lot keeps showing the
  // catalog's CURRENT label (exactly what the backfill froze from then on).
  assert.equal(factoryLabelFromSnapshot(null, 22, 'R2E-K103-XM2'), 'R2E-K103-XM2');
  assert.equal(factoryLabelFromSnapshot(null, 22, ''), null);
  // No site linked at all ⇒ no factory label from this seam.
  assert.equal(factoryLabelFromSnapshot(null, null, 'R2E-K103-XM2'), null);
  assert.equal(factoryLabelFromSnapshot(null, undefined, null), null);
});
