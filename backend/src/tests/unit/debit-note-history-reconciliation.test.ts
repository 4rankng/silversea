// Debit-note history card reconciliation (QA round 9, 23/11): the history and
// the editor must show the note number, its lifecycle status, the issue/cancel
// date, and the cumulative-debt change the note reconciled — so accounting can
// đối chiếu the debt movement without opening the ledger.
//
// Money-law anchor (QA round 9 + round-5 books evidence 52.040.480 →
// 60.576.800, +8.536.320): the "công nợ cộng dồn" a note is reconciled
// against is the customer's LIVE debit-note books — Σ totalGross over their
// billing documents that exist, are not soft-deleted and are not CANCELED.
// The note moves those books by its own gross iff it is itself live; a
// canceled note shows a 0 delta. Raw ledger balances measure the whole AR
// (unbilled trip revenue included), not the note books.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const serviceSource = readFileSync(join(here, '../../services/billing-document.service.ts'), 'utf8');
const sharedTypes = readFileSync(join(here, '../../../../shared/src/types/index.ts'), 'utf8');
const sharedConstants = readFileSync(join(here, '../../../../shared/src/constants/index.ts'), 'utf8');

describe('debit-note history reconciliation payload', () => {
  test('issued notes carry their SENT timestamp (issuedAt) to the client', () => {
    assert.match(serviceSource, /issuedAt: doc\.issuedAt\?\.toISOString\(\) \?\? null/);
    assert.match(sharedTypes, /issuedAt\?: string \| null;/);
  });

  test('AR before/after reads the customer LIVE debit-note books (not the raw ledger)', () => {
    const hydrate = serviceSource.slice(serviceSource.indexOf('let arBalanceBefore: number | null = null'));
    // Same live predicate as the settlement-round books measure: exists, not
    // soft-deleted, not CANCELED — scoped to this customer's DEBIT_NOTEs.
    assert.match(hydrate, /eq\(s\.billingDocuments\.type, 'DEBIT_NOTE'\)/);
    assert.match(hydrate, /eq\(s\.billingDocuments\.entityType, 'CUSTOMER'\)/);
    assert.match(hydrate, /eq\(s\.billingDocuments\.entityId, doc\.entityId\)/);
    assert.match(hydrate, /isNull\(s\.billingDocuments\.deletedAt\)/);
    assert.match(hydrate, /ne\(s\.billingDocuments\.debitNoteStatus, 'CANCELED'\)/);
    assert.match(hydrate, /coalesce\(sum\(\$\{s\.billingDocuments\.totalGross\}\), 0\)/);
  });

  test('live note: before = books − own gross, after = books, so delta ≡ gross (QA: +8.536.320)', () => {
    const hydrate = serviceSource.slice(serviceSource.indexOf('let arBalanceBefore: number | null = null'));
    assert.match(hydrate, /arBalanceBefore = liveBooks - Number\(doc\.totalGross\)/);
    assert.match(hydrate, /arBalanceAfter = liveBooks;/);
  });

  test('canceled note: before = after = live books (delta 0 — it no longer contributes)', () => {
    const hydrate = serviceSource.slice(serviceSource.indexOf('let arBalanceBefore: number | null = null'));
    assert.match(hydrate, /if \(doc\.debitNoteStatus === 'CANCELED'\)/);
    assert.match(hydrate, /arBalanceBefore = liveBooks;\s*\n\s*arBalanceAfter = liveBooks;/s);
  });

  test('drafts keep null balances (no books line on a not-yet-posted card)', () => {
    const hydrate = serviceSource.slice(serviceSource.indexOf('let arBalanceBefore: number | null = null'));
    assert.match(hydrate, /\(doc\.debitNoteStatus \?\? 'DRAFT'\) !== 'DRAFT'/);
  });

  test('the shared payload exposes the balances for the history card', () => {
    assert.match(sharedTypes, /arBalanceBefore\?: number \| null;/);
    assert.match(sharedTypes, /arBalanceAfter\?: number \| null;/);
  });

  test('every lifecycle status has a Vietnamese label', () => {
    for (const status of ['DRAFT', 'SENT', 'PENDING_CONFIRM', 'CONFIRMED', 'PARTIAL_PAID', 'PAID', 'REJECTED', 'CANCELED']) {
      assert.match(sharedConstants, new RegExp(`${status}: '`));
    }
  });
});
