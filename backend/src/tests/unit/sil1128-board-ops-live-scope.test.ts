// SIL-1128 — the bảng Kiểm soát lô hàng's ops-expense read rides LIVE money.
// Regression context (QA evidence 27/11, lô 6 EHPH26080202 SHP-2609-00006):
// Phát sinh ĐV + Tổng trả counted VOIDED fees Chi tiết Debit had already
// dropped (bảng 1.105.000 ₫ vs chi tiết 705.000 ₫ — 400.000 ₫ dead), and
// deleting a 200.000 ₫ fee moved Chi tiết Debit but not the board. The
// reject path shares the root (owner evidence comment 09:23) — a REJECTED
// ops fee (SIL-882 tự động gỡ) must not count either.
//
// Pure source pins (house pattern sil1050/sil1072): the board read is
// route+DB code — the endpoint-level shape rides
// debit-board-void-ops-scope.test.ts's real-router harness.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const closeSource = readFileSync(join(here, '..', '..', 'services', 'accounting-debit-close.service.ts'), 'utf8');
const scopeSource = readFileSync(join(here, '..', '..', 'services', 'live-debit-expense-scope.ts'), 'utf8');

describe('SIL-1128 — board ops read rides the shared live scope', () => {
  test('the board imports liveDebitOpsExpense (the shared owner, not a local re-filter)', () => {
    assert.match(closeSource, /import \{ liveDebitOpsExpense \} from '\.\/live-debit-expense-scope';/);
  });

  test('the ops-expense read carries liveDebitOpsExpense + not-REJECTED (the merge grid law)', () => {
    const readBlock = closeSource.slice(
      closeSource.indexOf("const opsRows = await executor.select({"),
      closeSource.indexOf("const zoneCostByLot"),
    );
    assert.match(readBlock, /liveDebitOpsExpense\(\)/);
    assert.match(readBlock, /ne\(s\.opsExpenseEntries\.approvalStatus, 'REJECTED'\)/);
  });

  test('the shared scope itself excludes VOIDED natively and through the registry', () => {
    assert.match(scopeSource, /ne\(s\.opsExpenseEntries\.approvalStatus, 'VOIDED'\)/);
    assert.match(scopeSource, /eq\(s\.expenseAccountingSources\.sourceKind, 'OPS'\),\s*\n\s*eq\(s\.expenseAccountingSources\.sourceId, s\.opsExpenseEntries\.id\),\s*\n\s*eq\(s\.expenseAccountingSources\.status, 'VOIDED'\)/);
  });
});
