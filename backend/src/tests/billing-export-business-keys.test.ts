// Debit-note export cells must render business identifiers, never internal
// ids (hard rule 2026-09-19: Số Bill/Booking + số tờ khai are the display
// keys; id-derived codes like SHP-/TRP- stay internal; a bare String(sourceId)
// in export content is an id leak into a customer-facing document).
// renderColumnValue is the pure cell resolver both xlsx exporters share.
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { renderColumnValue } from '../services/billing-export-shared.service';
import type { DebitNoteTemplateColumn } from '@tingting/shared';
import { disconnectRedis } from '../lib/redis';

type ExportLine = Parameters<typeof renderColumnValue>[0];
type TemplateCol = Parameters<typeof renderColumnValue>[1];

function mkLine(overrides: {
  sourceType?: string;
  sourceId?: string | number | null;
  renderData?: Record<string, unknown> | null;
  documentCode?: string | null;
  routeName?: string | null;
}): ExportLine {
  return {
    sourceType: overrides.sourceType ?? 'TRIP',
    sourceId: overrides.sourceId ?? null,
    routeName: overrides.routeName ?? null,
    renderData: (overrides.renderData ?? null) as ExportLine['renderData'],
    documentCode: overrides.documentCode ?? null,
  } as unknown as ExportLine;
}

const tripCodeCol = { id: 'tripCode', variable: 'tripCode' } as unknown as TemplateCol;
const chungTuCol = { id: 'chung_tu', variable: 'tripCode' } as unknown as TemplateCol;
const documentCodeCol = { id: 'documentCode', variable: 'documentCode' } as unknown as TemplateCol;

after(async () => {
  await disconnectRedis();
});

describe('debit-note export cells render business keys, never ids', () => {
  test('tripCode column never falls back to String(sourceId)', () => {
    const line = mkLine({ sourceType: 'TRIP', sourceId: '5', renderData: {} });
    const value = renderColumnValue(line, tripCodeCol, 0);
    assert.notEqual(String(value), '5', 'sourceId must never leak as the display value');
    assert.equal(value, null, 'no business key, no invented identifier');
  });

  test('tripCode column prefers the lot/trip business keys when present', () => {
    const byTripCode = renderColumnValue(
      mkLine({ sourceType: 'TRIP', sourceId: '7', renderData: { tripCode: 'TRP-202606-0007' } }),
      tripCodeCol, 0,
    );
    assert.equal(byTripCode, 'TRP-202606-0007');

    const byBill = renderColumnValue(
      mkLine({ sourceType: 'TRIP', sourceId: '9', renderData: { tripCode: null, billNumber: 'BILL-009' } }),
      tripCodeCol, 0,
    );
    assert.equal(byBill, 'BILL-009', 'Số Bill is a business key when the trip code is missing');

    const byDeclaration = renderColumnValue(
      mkLine({ sourceType: 'TRIP', sourceId: '11', renderData: { tripCode: null, declarationNumber: '1023456' } }),
      tripCodeCol, 0,
    );
    assert.equal(byDeclaration, '1023456', 'số tờ khai is a business key when the trip code is missing');
  });

  test('chung_tu column keeps source document numbers only', () => {
    const withDocCode = renderColumnValue(
      mkLine({ sourceType: 'EXPENSE', sourceId: '3', renderData: { documentCode: 'INV-77/decl 1023456' } }),
      chungTuCol, 0,
    );
    assert.equal(withDocCode, 'INV-77/decl 1023456');

    const withoutDocCode = renderColumnValue(
      mkLine({ sourceType: 'TRIP', sourceId: '13', renderData: {} }),
      chungTuCol, 0,
    );
    assert.equal(withoutDocCode, null, 'trip lines render no fabricated document number');
  });

  test('documentCode column passes business numbers through unchanged', () => {
    const value = renderColumnValue(
      mkLine({ sourceType: 'EXPENSE', sourceId: '4', renderData: { documentCode: 'INV-78' } }),
      documentCodeCol, 0,
    );
    assert.equal(value, 'INV-78');
  });
});
