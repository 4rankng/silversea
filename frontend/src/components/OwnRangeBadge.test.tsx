import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

// The header period is the only input the chip does not own — mock the
// dedicated period hook the way the topbar's own tests do.
const salaryPeriod: { current: { start: string; end: string } | null } = { current: null };
vi.mock('../design-system/hooks/useSalaryPeriod', () => ({
  useSalaryPeriod: () => ({ data: salaryPeriod.current }),
}));

import { OwnRangeBadge } from './OwnRangeBadge';
import { MonthProvider } from '../hooks/useMonth';

function renderBadge(from: string, to: string) {
  return render(
    <MonthProvider>
      <OwnRangeBadge from={from} to={to} />
    </MonthProvider>,
  );
}

// The chip explains a page filtering its own date range, different from the
// header work period. It must appear ONLY for that state: an equal range and
// an unknown/incomplete range both render nothing.
describe('OwnRangeBadge', () => {
  it('shows the separate-range chip when the page range differs from the header period', () => {
    salaryPeriod.current = { start: '2026-11-01', end: '2026-11-30' };
    const { unmount } = renderBadge('2026-11-01', '2026-11-28');
    expect(screen.getByText('Đang dùng khoảng riêng')).toBeTruthy();
    unmount();
  });

  it('stays hidden when the page range matches the header period', () => {
    salaryPeriod.current = { start: '2026-11-01', end: '2026-11-30' };
    const { unmount } = renderBadge('2026-11-01', '2026-11-30');
    expect(screen.queryByText('Đang dùng khoảng riêng')).toBeNull();
    unmount();
  });

  it('stays hidden while the header period is unknown', () => {
    salaryPeriod.current = null;
    const { unmount } = renderBadge('2026-11-01', '2026-11-28');
    expect(screen.queryByText('Đang dùng khoảng riêng')).toBeNull();
    unmount();
  });

  it('stays hidden when the page has not chosen a complete range', () => {
    salaryPeriod.current = { start: '2026-11-01', end: '2026-11-30' };
    const { unmount } = renderBadge('2026-11-01', '');
    expect(screen.queryByText('Đang dùng khoảng riêng')).toBeNull();
    unmount();
  });
});
