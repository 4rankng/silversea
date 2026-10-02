import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { monthlyChange } from '../utils';
import { CostBreakdown, DeltaPill } from './dashboard-presenters';

describe('monthly KPI direction and favorable tone (UI75)', () => {
  it('shows rising cost as unfavorable without reversing its arrow', () => {
    const { rerender } = render(<DeltaPill change={monthlyChange(1_650_000, 110_000)} favorableDirection="down" />);
    expect(screen.getByText('▲ 1400.0%')).toHaveClass('down', 'd-badge-error');
    rerender(<DeltaPill change={monthlyChange(50, 100)} favorableDirection="down" />);
    expect(screen.getByText('▼ 50.0%')).toHaveClass('up', 'd-badge-success');
  });

  it('renders profit recovery, new loss and flat/unknown comparisons honestly', () => {
    const { rerender } = render(<DeltaPill change={monthlyChange(2_850_000, -110_000)} />);
    expect(screen.getByText('▲ 2690.9%')).toHaveClass('up', 'd-badge-success');
    rerender(<DeltaPill change={monthlyChange(-100, 0)} />);
    expect(screen.getByText('▼ Mới')).toHaveClass('down', 'd-badge-error');
    rerender(<DeltaPill change={monthlyChange(-100, -100)} />);
    expect(screen.getByText('· 0.0%')).toHaveClass('flat', 'd-badge-ghost');
    rerender(<DeltaPill change={monthlyChange(100, null)} />);
    expect(screen.getByText('· —')).toHaveClass('flat', 'd-badge-ghost');
  });
});


describe('recognized cost rows (UI81)', () => {
  it('keeps every signed source row without claiming a positive 100% distribution', () => {
    render(<CostBreakdown total={70} items={[
      { name: 'Fuel', value: 100, pct: 100, color: 'green' },
      { name: 'Adjustment', value: -30, pct: 0, color: 'red' },
    ]} />);
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByRole('listitem', { name: /Adjustment.*-30/ })).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: /Cơ cấu chi phí/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/100%/)).not.toBeInTheDocument();
  });

  it('shows loaded zero and incomplete report states without fabricated amount or percentage', () => {
    const { rerender } = render(<CostBreakdown total={0} items={[]} />);
    expect(screen.getByText('Không có chi phí đã ghi nhận trong kỳ.')).toBeInTheDocument();
    expect(screen.queryByText(/100%/)).not.toBeInTheDocument();
    rerender(<CostBreakdown total={100} complete={false} items={[{ name: 'Fuel', value: null, pct: null, color: 'green' }]} />);
    expect(screen.getByText('Chưa đủ dữ liệu để phân loại toàn bộ chi phí.')).toBeInTheDocument();
    expect(screen.getByRole('listitem', { name: /Fuel: chưa có dữ liệu/ })).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    rerender(<CostBreakdown total={null} complete={false} items={[]} />);
    expect(screen.getByText('Chưa có báo cáo chi phí trong kỳ.')).toBeInTheDocument();
  });

  it('retains a real zero-percent row in the list', () => {
    render(<CostBreakdown total={1000.25} items={[
      { name: 'Fuel', value: 1000, pct: 100, color: 'green' },
      { name: 'Small adjustment', value: 0.25, pct: 0, color: 'red' },
    ]} />);
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByRole('listitem', { name: /Small adjustment/ })).toBeInTheDocument();
  });
});
