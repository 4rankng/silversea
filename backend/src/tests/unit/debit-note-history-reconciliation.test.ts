// Debit-note history card reconciliation (QA round 7, 23/11): the history and
// the editor must show the note number, its lifecycle status, the issue/cancel
// date, and the cumulative-debt change the note reconciled — so accounting can
// đối chiếu the debt movement without opening the ledger.
//
// Money-law anchor: every customer debit-note save reconciles its receivable
// through append-only ADJUSTMENT ledger entries stamped `GBN:<docId>` (see
// billing-document-posting.service.ts). Each entry stores the customer's
// running balance right after itself, so the FIRST entry yields the debt
// immediately before the note and the LAST entry the debt immediately after.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const serviceSource = readFileSync(join(here, '../../services/billing-document.service.ts'), 'utf8');
const postingSource = readFileSync(join(here, '../../services/billing-document-posting.service.ts'), 'utf8');
const sharedTypes = readFileSync(join(here, '../../../../shared/src/types/index.ts'), 'utf8');
const sharedConstants = readFileSync(join(here, '../../../../shared/src/constants/index.ts'), 'utf8');

describe('debit-note history reconciliation payload', () => {
  test('issued notes carry their SENT timestamp (issuedAt) to the client', () => {
    assert.match(serviceSource, /issuedAt: doc\.issuedAt\?\.toISOString\(\) \?\? null/);
    assert.match(sharedTypes, /issuedAt\?: string \| null;/);
  });

  test('AR before/after reads the note GBN ledger stamp with the running balance', () => {
    // The read key must equal the write key the posting service stamps.
    assert.match(postingSource, /receiptId: `GBN:\$\{input\.documentId\}`/);
    assert.match(serviceSource, /eq\(s\.ledger\.receiptId, `GBN:\$\{doc\.id\}`\)/);
    assert.match(serviceSource, /eq\(s\.ledger\.txnType, TxnType\.ADJUSTMENT\)/);
  });

  test('before derives from the FIRST entry balance; after from the LAST entry balance', () => {
    assert.match(serviceSource, /arBalanceAfter = Number\(last\.balance\)/);
    assert.match(serviceSource, /arBalanceBefore = Number\(first\.balance\) - Number\(first\.debit\) \+ Number\(first\.credit\)/);
  });

  test('notes without any AR reconciliation expose null balances (draft, never posted)', () => {
    const hydrate = serviceSource.slice(serviceSource.indexOf('let arBalanceBefore: number | null = null'));
    assert.match(hydrate, /if \(first && last\)/, 'balances stay null when no GBN entry exists');
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
