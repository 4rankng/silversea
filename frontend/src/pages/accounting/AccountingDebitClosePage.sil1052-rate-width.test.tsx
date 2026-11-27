// K1.31 (SIL-1052) — superseded owner law 27/11: the rate input no longer
// self-sizes to its placeholder. The ch-based min-width floor pushed the input
// past the fixed 15% money track onto the adjacent column (the value visually
// escaped the input). The input now owns the FULL cell width via the paired
// `.debit-line--rate` CSS contract; the formatted placeholder must still be
// complete ('3.952.000 ₫'), and the Chưa-xác-định face (SIL-814) stays empty.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { AccountingDebitBoardRow } from '../../api/accountingDebitClient';
import { RateCell } from './AccountingDebitClosePage.rate-cell';

const row = {
  shipmentId: 1,
  billOrBooking: 'W4A1-FCL-03',
  code: 'LOT-1',
  costLockedAt: null,
} as unknown as AccountingDebitBoardRow;

const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), './AccountingDebitClosePage.css'), 'utf8');
const rateBlock = css.match(/\.debit-line--rate \.debit-ext-cost \{[^}]+\}/)?.[0] ?? '';

describe('RateCell full-cell-width law (owner 27/11, supersedes SIL-1052 self-sizing)', () => {
  it('never carries an inline width floor — the value stays inside the input', () => {
    render(
      <RateCell
        row={row}
        field="cuocThu"
        label="Cước thu"
        value="3952000"
        onCommit={vi.fn()}
        saving={false}
      />,
    );
    const input = screen.getByLabelText(/Cước thu lô W4A1-FCL-03/) as HTMLInputElement;
    expect(input.placeholder).toBe('3.952.000 ₫');
    expect(input.getAttribute('style')).toBeNull();
  });

  it('keeps the unpriced em-dash ghost (SIL-1081 KB money law, supersedes the SIL-814 blank)', () => {
    render(
      <RateCell
        row={row}
        field="lachHuyen"
        label="Lạch Huyện"
        value={null}
        onCommit={vi.fn()}
        saving={false}
      />,
    );
    const input = screen.getByLabelText(/Lạch Huyện lô W4A1-FCL-03/) as HTMLInputElement;
    expect(input.placeholder).toBe('—');
    expect(input.getAttribute('style')).toBeNull();
  });

  it('the paired CSS gives the input the full cell width with no intrinsic floor', () => {
    expect(rateBlock).toContain('width: 100%');
    expect(rateBlock).toContain('min-width: 0');
    expect(rateBlock).not.toMatch(/width:\s*\d+ch/);
    expect(css).not.toMatch(/\.debit-line--rate \{[^}]*minmax\(88px/);
  });
});
