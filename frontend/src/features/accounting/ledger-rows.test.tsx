// Card 071026141540 — the /finance ledger legend rendered glued amounts
// ("73.500đ", the staging report's confirmed instance). The house money law
// (FB-034 / the export-feedback card's spacing standard) renders
// "73.500 ₫" — digits, space, unit — everywhere on screen.
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LedgerRow } from './ledger-rows';

const row = {
  timestamp: '2026-10-07T01:00:00.000Z',
  txnType: 'ADJUSTMENT',
  receiptId: 'GBN-ADJ:1',
  debit: '0',
  credit: '73500',
  balance: '73500',
  note: 'điều chỉnh',
};

describe('ledger row money spacing (card 071026141540)', () => {
  it('renders ledger amounts spaced — "73.500 ₫", never glued "73.500đ"', () => {
    render(
      <table><tbody><tr><table /><LedgerRow row={row as never} /></tr></tbody></table>,
    );
    expect(screen.getAllByText('73.500 ₫').length).toBeGreaterThanOrEqual(2);
    expect(document.body.textContent).not.toContain('73.500đ');
  });
});
