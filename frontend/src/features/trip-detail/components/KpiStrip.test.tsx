import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { KpiStrip } from './KpiStrip';

const tile = (label: string) => screen.getByText(label).parentElement as HTMLElement;

describe('KpiStrip money law (SIL-1137)', () => {
  it('renders stored P&L gaps as — in the inline strip, never a fabricated 0 or a bare —%', () => {
    render(<KpiStrip revenue={3800000} totalCost={null} grossProfit={null} marginPct={null} />);
    expect(within(tile('Tổng chi phí')).getByText('—')).toBeVisible();
    expect(within(tile('Lợi nhuận gộp')).getByText('—')).toBeVisible();
    const margin = tile('Biên lợi nhuận');
    expect(within(margin).getByText('—')).toBeVisible();
    expect(within(margin).queryByText('%')).toBeNull();
  });

  it('renders known values truthfully — a real 0 ₫ cost and a full 100,0% margin', () => {
    render(<KpiStrip revenue={3800000} totalCost={0} grossProfit={3800000} marginPct="100.0" />);
    expect(within(tile('Tổng chi phí')).getByText('0 ₫')).toBeVisible();
    expect(within(tile('Lợi nhuận gộp')).getByText('3.800.000 ₫')).toBeVisible();
    expect(within(tile('Biên lợi nhuận')).getByText('100.0')).toBeVisible();
    expect(within(tile('Biên lợi nhuận')).getByText('%')).toBeVisible();
  });

  it('renders the same gap law in the rail variant', () => {
    render(<KpiStrip variant="rail" revenue={3800000} totalCost={null} grossProfit={null} marginPct={null} />);
    expect(within(tile('Tổng chi phí')).getByText('—')).toBeVisible();
    expect(within(tile('Lợi nhuận gộp')).getByText('—')).toBeVisible();
    const margin = tile('Biên LN');
    expect(within(margin).getByText('—')).toBeVisible();
    expect(within(margin).queryByText('%')).toBeNull();
  });
});
