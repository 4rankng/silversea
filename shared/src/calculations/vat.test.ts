import { test, describe } from 'node:test';
import assert from 'node:assert';
import { debitRoundVatTotals, vatForAmount } from './vat.ts';

describe('vatForAmount', () => {
  test('matches the chốt-time convention: base is pre-VAT, rounded to unit VND', () => {
    assert.equal(vatForAmount(570000, 8), 45600);
    assert.equal(vatForAmount('570000', 10), 57000);
    assert.equal(vatForAmount(123456, 5), 6172.8); // round(×5)/100 — the service's exact convention
    assert.equal(vatForAmount(100000, 0), 0);
  });
});

describe('debitRoundVatTotals', () => {
  const rounds = [
    { periodKey: '2026-10', direction: 'THU', amount: 570000, vatRate: 8 },
    { periodKey: '2026-10', direction: 'TRA', amount: 570000, vatRate: 8 },
    { periodKey: '2026-09', direction: 'THU', amount: 1000000, vatRate: 10 },
    { periodKey: '2026-10', direction: 'THU', amount: 250000, vatRate: 0 },
  ];

  test('sums per direction inside the inclusive period bounds', () => {
    const t = debitRoundVatTotals(rounds, '2026-10', '2026-10');
    assert.equal(t.hasRounds, true);
    assert.equal(t.thuBase, 820000);
    assert.equal(t.thuVat, 45600);
    assert.equal(t.traVat, 45600);
    assert.equal(t.totalVat, 91200);
  });

  test('spans a multi-month range', () => {
    const t = debitRoundVatTotals(rounds, '2026-09', '2026-10');
    assert.equal(t.thuVat, 145600); // 45600 + 100000
    assert.equal(t.totalVat, 191200);
  });

  test('an empty period keeps hasRounds false — the honest dash case', () => {
    const t = debitRoundVatTotals(rounds, '2026-11', '2026-11');
    assert.equal(t.hasRounds, false);
    assert.equal(t.totalVat, 0);
  });

  test('a zero-rate round is a computed zero that still counts as data', () => {
    const t = debitRoundVatTotals([rounds[3]], '2026-10', '2026-10');
    assert.equal(t.hasRounds, true);
    assert.equal(t.thuVat, 0);
    assert.equal(t.totalVat, 0);
  });
});
