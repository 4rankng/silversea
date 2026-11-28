/**
 * Ticket 18/11 Task 4.1 — the two HARD 409 paths of the Ops expense write.
 * The no-invoice family's same-type duplicate gate ignores
 * `duplicateConfirmed` (the invoice family keeps card 141026230720's
 * warn-then-confirm), and a Số hóa đơn may exist only once per lô compared
 * case/whitespace-insensitively. The decisions are pure; the database reads
 * behind them (findLiveDuplicateOpsExpenses /
 * findLiveDuplicateOpsInvoiceNumber) apply these exact rules.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  opsExpenseDuplicateGate,
  normalizeOpsInvoiceNumber,
  duplicateOpsInvoiceMessage,
  duplicateSetScopeLabel,
  opsExpenseContainerIdList,
  duplicateHitSharedNumbers,
} from '../../services/ops-expenses.service';

describe('opsExpenseDuplicateGate — no-invoice family is HARD, invoice family keeps confirm', () => {
  test('no-invoice types (requiresInvoice false/null/undefined) hard-block whatever the flag says', () => {
    assert.equal(opsExpenseDuplicateGate(false), 'HARD');
    assert.equal(opsExpenseDuplicateGate(false, true), 'HARD', 'duplicateConfirmed must NOT unlock the no-invoice family');
    assert.equal(opsExpenseDuplicateGate(null), 'HARD');
    assert.equal(opsExpenseDuplicateGate(null, true), 'HARD');
    assert.equal(opsExpenseDuplicateGate(undefined, true), 'HARD');
  });

  test('invoice types keep the warn-then-confirm law', () => {
    assert.equal(opsExpenseDuplicateGate(true), 'WARN', 'unconfirmed invoice duplicate still warns');
    assert.equal(opsExpenseDuplicateGate(true, true), 'PASS', 'explicit confirm lets the invoice duplicate save');
    assert.equal(opsExpenseDuplicateGate(true, false), 'WARN');
  });
});

describe('normalizeOpsInvoiceNumber — case/space-insensitive identity', () => {
  test('the classic variants fold to one key', () => {
    assert.equal(normalizeOpsInvoiceNumber(' TD-20260923-001 '), normalizeOpsInvoiceNumber('td-20260923-001'));
    assert.equal(normalizeOpsInvoiceNumber('TD 001'), normalizeOpsInvoiceNumber('td001'));
    assert.equal(normalizeOpsInvoiceNumber('TD\t001\n'), 'td001');
  });

  test('different documents stay distinct', () => {
    assert.notEqual(normalizeOpsInvoiceNumber('TD-001'), normalizeOpsInvoiceNumber('TD-002'));
    assert.notEqual(normalizeOpsInvoiceNumber('TD-001'), normalizeOpsInvoiceNumber('TD-001A'));
  });

  test('a whitespace-only number folds to the empty key', () => {
    assert.equal(normalizeOpsInvoiceNumber('   '), '');
    assert.equal(normalizeOpsInvoiceNumber('\t'), '');
  });
});

describe('duplicateOpsInvoiceMessage — the 409 names the invoice number', () => {
  test('message carries the declared number and the lô scope', () => {
    assert.equal(
      duplicateOpsInvoiceMessage('TD-20260923-001'),
      'Số hóa đơn TD-20260923-001 đã tồn tại trên lô này.',
    );
  });
});

describe('SIL-881 set law — one declaration, one record, overlap refusal', () => {
  const hit = (id: number, containerNumbers: string[]) => ({
    id, expenseTypeName: null, containerNumber: containerNumbers[0] ?? null, containerNumbers,
    paidById: 9, paidByName: 'Hoang', amount: '450000', paidAt: '2026-11-22',
  });

  test('duplicateSetScopeLabel names the overlapping conts; chung lô stays chung lô', () => {
    assert.equal(duplicateSetScopeLabel([hit(1, ['MSKU1234570']), hit(2, ['MSKU1234565'])]), 'cont MSKU1234570, MSKU1234565');
    assert.equal(duplicateSetScopeLabel([hit(3, [])]), 'phí chung lô');
  });

  test('opsExpenseContainerIdList — set column wins, legacy single id falls back, chung lô → []', () => {
    assert.deepEqual(opsExpenseContainerIdList({ shipmentContainerId: 7, shipmentContainerIds: [7, 8] }), [7, 8]);
    assert.deepEqual(opsExpenseContainerIdList({ shipmentContainerId: 7, shipmentContainerIds: null }), [7]);
    assert.deepEqual(opsExpenseContainerIdList({ shipmentContainerId: null, shipmentContainerIds: null }), []);
  });

  test('source-scan — ONE row per declaration and the gate queries set overlap', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(join(here, '../../services/ops-expenses.service.ts'), 'utf8');
    // K conts + tổng X = exactly one row: the single column only stays
    // authoritative for 1-cont rows, chung lô leaves both NULL.
    assert.ok(source.includes('shipmentContainerId: containerIds.length === 1 ? containerIds[0] : null'));
    assert.ok(source.includes('shipmentContainerIds: containerIds.length > 0 ? containerIds : null'));
    // The refusal queries SET overlap (`{a,b} && …::int[]`), never a
    // single-column eq — ONE shared cont is already a collision.
    assert.ok(source.includes("&& ${`{${shipmentContainerIds.join(',')}}`}::int[]"));
    // Tombstones never collide: VOIDED + REJECTED stay out of the live set.
    assert.ok(source.includes("notInArray(s.opsExpenseEntries.approvalStatus, ['VOIDED', 'REJECTED'])"));
  });
});

describe('QA 28/11 CR-010 1.2 — the duplicate refusal names the SHARED conts only', () => {
  // QA fixture (staging, 28/11): the earlier 'Hàn cont' row covers conts
  // #103 + #119 (QATU1128103 / QATU1128119); the refused declaration picks
  // #119 + #320. The old payload carried the earlier row's FULL set, so the
  // red conflict line named QATU1128103 — a cont this save never touches —
  // while the real intersection is QATU1128119 alone.
  const numberFor = (id: number) =>
    ({ 103: 'QATU1128103', 119: 'QATU1128119', 320: 'QATU1128320' } as Record<number, string | null>)[id] ?? null;

  test('duplicateHitSharedNumbers intersects the earlier row with the requested set', () => {
    const shared = duplicateHitSharedNumbers([103, 119], [119, 320], numberFor);
    assert.deepEqual(shared, ['QATU1128119']);
    assert.ok(!shared.includes('QATU1128103'), 'the untouched cont must never be named');
    assert.ok(!shared.includes('QATU1128320'), 'the new pick is not part of the earlier row');
  });

  test('the 409 scope label built from the shared hit names the actual intersection', () => {
    const shared = duplicateHitSharedNumbers([103, 119], [119, 320], numberFor);
    const hit = {
      id: 7,
      expenseTypeName: 'Hàn cont',
      containerNumber: shared[0] ?? null,
      containerNumbers: shared,
      paidById: 9,
      paidByName: 'Nguyễn Huy Hoàng',
      amount: '21401',
      paidAt: '2026-11-28',
    };
    assert.equal(duplicateSetScopeLabel([hit]), 'cont QATU1128119');
  });

  test('a chung lô probe (null requested set) keeps the row list unchanged', () => {
    assert.deepEqual(duplicateHitSharedNumbers([103, 119], null, numberFor), ['QATU1128103', 'QATU1128119']);
    assert.deepEqual(duplicateHitSharedNumbers([], [119, 320], numberFor), []);
  });

  test('source-scan — the gate payload maps every hit through the shared-set helper', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(join(here, '../../services/ops-expenses.service.ts'), 'utf8');
    assert.ok(
      source.includes('const rowNumbers = duplicateHitSharedNumbers('),
      'findLiveDuplicateOpsExpenses must intersect each hit with the requested set',
    );
  });
});
