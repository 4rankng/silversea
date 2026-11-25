// K3.61 — the debt screen (Kiểm soát lô hàng) shows the lot's số tờ khai as
// the SECOND display key right after Bill/Booking. The number lives in TWO
// stores: the per-cont attribute (shipment_containers.declarationNumber — the
// CUS operational truth; the W4A-FCL-01 example lives ONLY there) and the
// lot-level entity rows (shipment_declarations). Both debit readers used to
// read ONLY the entity store, so customsNumber came back null for every lot
// whose office saved the number per-cont and the board showed no tờ khai at
// all. Both services now resolve BOTH stores through ONE merge law
// (mergeDeclarationNumbersByLot — the JS mirror of lotDeclarationNumbersSql /
// loadDeclarationNumbers: per-cont first in container-id order, entity rows
// after in id order, DISTINCT case-insensitively, blanks skipped).
// Pinned at the unit boundary (BE unit-only law, no db boot): the merge law
// executes headlessly below, and source-wiring scans pin both services onto
// it. The SQL behavior itself stays with the qa/scripts integration probes.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeDeclarationNumbersByLot } from '../../services/shipment-debit-summary.service';

const here = dirname(fileURLToPath(import.meta.url));

/** Test seam: the source slice between two anchors (sil657 convention). */
const sliceBetween = (source: string, start: string, end: string) => {
  const from = source.indexOf(start);
  assert.ok(from >= 0, `missing anchor: ${start}`);
  const to = source.indexOf(end, from);
  assert.ok(to > from, `missing end anchor: ${end}`);
  return source.slice(from, to);
};

// The repro lot: W4A-FCL-01 — declarations ONLY on the per-cont store,
// MSKU9000100 → W4ADEL001 and MSKU9000115 → W4ADEL002, in container-id order.
const w4aContainerRows = [
  { shipmentId: 501, declarationNumber: 'W4ADEL001' }, // MSKU9000100
  { shipmentId: 501, declarationNumber: 'W4ADEL002' }, // MSKU9000115
];

describe('the lot declaration aggregate resolves BOTH stores (K3.61 merge law)', () => {
  test('a lot whose numbers live ONLY per-cont returns W4ADEL001, W4ADEL002', () => {
    const merged = mergeDeclarationNumbersByLot(w4aContainerRows, []);
    assert.equal(merged.get(501)?.join(', '), 'W4ADEL001, W4ADEL002');
  });

  test('per-cont values merge first in container-id order, entity rows after in id order', () => {
    const merged = mergeDeclarationNumbersByLot(
      [{ shipmentId: 1, declarationNumber: 'TK-CONT-1' }, { shipmentId: 1, declarationNumber: 'TK-CONT-2' }],
      [{ shipmentId: 1, declarationNumber: 'TK-DOCS-9' }],
    );
    assert.deepEqual(merged.get(1), ['TK-CONT-1', 'TK-CONT-2', 'TK-DOCS-9']);
  });

  test('dedup is case-insensitive — the first (per-cont) copy keeps its casing', () => {
    const merged = mergeDeclarationNumbersByLot(
      [{ shipmentId: 1, declarationNumber: 'W4ADEL001' }],
      [{ shipmentId: 1, declarationNumber: 'w4adel001' }, { shipmentId: 1, declarationNumber: 'W4ADEL002' }],
    );
    assert.deepEqual(merged.get(1), ['W4ADEL001', 'W4ADEL002']);
  });

  test('blank-only values and orphan lot ids never enter', () => {
    const merged = mergeDeclarationNumbersByLot(
      [
        { shipmentId: 1, declarationNumber: '   ' },
        { shipmentId: null, declarationNumber: 'TK-ORPHAN' },
        { shipmentId: 1, declarationNumber: 'TK-1' },
      ],
      [{ shipmentId: 1, declarationNumber: '' }],
    );
    assert.deepEqual(merged.get(1), ['TK-1']);
    assert.deepEqual([...merged.keys()], [1]);
  });
});

describe('both debt-screen readers carry the second display key from the merge', () => {
  const summary = readFileSync(join(here, '../../services/shipment-debit-summary.service.ts'), 'utf8');
  const board = readFileSync(join(here, '../../services/accounting-debit-close.service.ts'), 'utf8');

  test('getShipmentDebitSummary reads BOTH stores and emits customsNumber from the merge', () => {
    const declarationsBlock = sliceBetween(summary, '// K3.61', '// Auto freight');
    assert.match(declarationsBlock, /from\(s\.shipmentDeclarations\)/);
    assert.match(declarationsBlock, /from\(s\.shipmentContainers\)/);
    assert.match(declarationsBlock, /mergeDeclarationNumbersByLot\(declarationContainerRows, declarationEntityRows\)/);
    // The shared wire field is fed from the merged map — never a docs-only read.
    assert.match(summary, /customsNumber: \(declarationNumbersByLot\.get\(lot\.id\) \?\? \[\]\)\.join\(', '\) \|\| null/);
  });

  test('the debit-board row carries customsNumber resolved from BOTH stores', () => {
    const readsBlock = sliceBetween(board, 'const containerRows = await executor.select', 'const containerTypeRows');
    assert.match(readsBlock, /declarationNumber: s\.shipmentContainers\.declarationNumber/);
    assert.match(readsBlock, /from\(s\.shipmentDeclarations\)/);
    // Both feeds stay in id order — the merge preserves input order, so the
    // per-cont-first display law depends on it.
    assert.match(readsBlock, /\.orderBy\(asc\(s\.shipmentContainers\.id\)\)/);
    assert.match(readsBlock, /mergeDeclarationNumbersByLot\(containerRows, declarationEntityRows\)/);
    assert.match(board, /customsNumber: \(declarationNumbersByLot\.get\(lot\.id\) \?\? \[\]\)\.join\(', '\) \|\| null/);
    // The wire type carries the field next to Bill/Booking.
    assert.match(board, /billOrBooking: string \| null;\s*\n[\s\S]{0,240}?customsNumber: string \| null;/);
  });
});
