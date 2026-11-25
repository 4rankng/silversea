// K1.31 (SIL-1052) — the inline rate input self-sizes to its placeholder: a
// money placeholder ('3.952.000 ₫' = 68px) wider than the value track must
// never lose its last digit on the Kiểm soát lô hàng board. The input carries
// an inline ch-based min-width floor derived from the formatted placeholder
// (the safe-direction estimate: dots are narrower than the tabular '0'); the
// empty Chưa-xác-định face (SIL-814) stays floor-free so it keeps shrinking.
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

describe('RateCell placeholder-driven self-sizing (K1.31 / SIL-1052)', () => {
  it('floors the input at the placeholder width so the last digit survives', () => {
    render(
      <RateCell
        row={row}
        containerId={null}
        field="cuocThu"
        label="Cước thu"
        value="3952000"
        onCommit={vi.fn()}
        saving={false}
      />,
    );
    const input = screen.getByLabelText(/Cước thu lô W4A1-FCL-03/) as HTMLInputElement;
    expect(input.placeholder).toBe('3.952.000 ₫');
    // 11 formatted characters + the 8px padding — measured, not guessed.
    expect(input.style.minWidth).toBe('calc(11ch + 8px)');
  });

  it('keeps the Chưa-xác-định empty face floor-free (SIL-814 stays intact)', () => {
    render(
      <RateCell
        row={row}
        containerId={null}
        field="lachHuyen"
        label="Lạch Huyện"
        value={null}
        onCommit={vi.fn()}
        saving={false}
      />,
    );
    const input = screen.getByLabelText(/Lạch Huyện lô W4A1-FCL-03/) as HTMLInputElement;
    expect(input.placeholder).toBe('');
    expect(input.style.minWidth).toBe('');
  });
});
