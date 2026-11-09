/**
 * SIL-751 (id 871) — the phiếu header is the sum of ITS LINES.
 *
 * QA 08–09/11 (staging c4cea6b6 → e6db602f, account hoapt): OS-2611-0005
 * printed a stored header 1.080.000₫ over 5 POSITIVE lines summing
 * 1.070.000₫ (150k QBOBD39C + 210k R3Q-680-B + 60k R3Q-679-D + 500k
 * R4B-CC-001 + 150k R4B-3E-FCL1) — no negative row, so the r3 disclosure law
 * was not the story: the stored `ops_settlements.total_amount` had gone
 * stale under an accountant amount edit that never recomputed it.
 *
 * r4 law: every reader derives the header from the lines at load time
 * (`opsSettlementTotalFromLinesSql` / `sumOpsAmounts` — the card 20260928_197
 * sumExcludingNegative rule), and the accountant OPS edit recomputes the
 * stored total inside its own transaction.
 *
 * Unit pins only (no app boot, no DB — 2026-10-19 owner ruling): pure law
 * pins on the exported sum + source scans that the readers and the edit path
 * are wired to the one implementation.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { sumOpsAmounts } from '../../services/ops-settlements.service';

const settlementsSource = fs.readFileSync(
  path.resolve(process.cwd(), 'src/services/ops-settlements.service.ts'),
  'utf8',
);
const advanceSource = fs.readFileSync(
  path.resolve(process.cwd(), 'src/services/advance-settlement.service.ts'),
  'utf8',
);
const writeSource = fs.readFileSync(
  path.resolve(process.cwd(), 'src/services/expense-accounting-write.service.ts'),
  'utf8',
);

// OS-2611-0005 exactly as QA counted it (comment 4691/4703/4715) — five
// positive lines, and the stale stored header value the bug reported.
const OS_2611_0005_LINES = ['150000', '210000', '60000', '500000', '150000']
  .map((amount) => ({ amount }));
// OS-2610-0001: two positive lines plus the genuine −50.000₫ negative row.
const OS_2610_0001_LINES = ['200000', '120000', '-50000']
  .map((amount) => ({ amount }));

describe('SIL-751 r4 — the phiếu header derives from its lines', () => {
  it('the line law returns 1.070.000 for OS-2611-0005 — the stored 1.080.000 never wins', () => {
    const derived = sumOpsAmounts(OS_2611_0005_LINES);
    assert.equal(derived, 1070000n, '5 positive lines sum to exactly what a reviewer counts by hand');
    assert.notEqual(derived.toString(), '1080000', 'the stale stored header value is gone from every surface');
  });

  it('the line law keeps OS-2610-0001 at 320.000 (the −50.000 row excluded, never netted)', () => {
    assert.equal(sumOpsAmounts(OS_2610_0001_LINES), 320000n, 'card 20260928_197: header 320.000 = 200.000 + 120.000');
  });

  it('every ops-settlement reader projects the derived total, never the stored column', () => {
    const listStart = settlementsSource.indexOf('export async function listOpsSettlements(');
    const list = settlementsSource.slice(listStart, settlementsSource.indexOf('filters.limit ?? 50', listStart));
    assert.ok(list.includes('totalAmount: opsSettlementTotalFromLinesSql()'),
      'the list header is the query-level sumExcludingNegative over the phiếu lines');
    const detail = settlementsSource.match(/export async function getOpsSettlementDetail\([\s\S]*?\n}/)?.[0] ?? '';
    assert.ok(detail.includes('totalAmount: sumOpsAmounts(entries).toString()'),
      'the detail header sums the SAME entries the sheet prints');
    assert.ok(!settlementsSource.includes('totalAmount: s.opsSettlements.totalAmount'),
      'no ops-settlement reader prints the stale stored column any more');
  });

  it('the advance-surface readers derive too (the /advances surfaces QA drove)', () => {
    assert.ok(advanceSource.includes('totalAmount: opsSettlementTotalFromLinesSql()'),
      'the paginated ops list derives its header from the lines');
    const fromOps = advanceSource.match(/async function getAdvanceSettlementFromOps\([\s\S]*?\n}\n/)?.[0] ?? '';
    assert.ok(fromOps.includes('totalExpenseAmount: sumOpsAmounts(entries).toString()'),
      'the ops advance detail header sums its own lines');
    assert.ok(!fromOps.includes('String(row.totalAmount)'),
      'the advance detail never echoes the stored column');
  });

  it('the accountant amount edit recomputes the stored total in its own transaction', () => {
    assert.ok(writeSource.includes('recomputeOpsSettlementTotal(tx, linkedSettlement.opsSettlementId)'),
      'an OPS edit on a settlement-linked entry moves the frozen header with it');
    const recompute = settlementsSource.match(/export async function recomputeOpsSettlementTotal\([\s\S]*?\n}/)?.[0] ?? '';
    assert.ok(recompute.includes("filter (where ${s.opsExpenseEntries.amount} >= 0)"),
      'the recompute carries the same card-197 law as the readers');
    assert.ok(recompute.includes('updatedAt: new Date()'),
      'the stored column keeps its audit stamp');
  });
});
