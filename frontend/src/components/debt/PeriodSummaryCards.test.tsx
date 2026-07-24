import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { PeriodSummaryCards } from './PeriodSummaryCards';

describe('PeriodSummaryCards', () => {
  it('uses the vertical base layout controlled by the 1100px CSS breakpoint', () => {
    const { container } = render(
      <PeriodSummaryCards
        isLoading={false}
        entityType="CUSTOMER"
        summary={{
          openingBalance: 1000000,
          closingBalance: 2000000,
          periodActivity: 1000000,
          debitTotal: 2500000,
          creditTotal: 1500000,
          dateFrom: '2026-07-01',
          dateTo: '2026-07-31',
        }}
      />,
    );

    const root = container.firstElementChild as HTMLElement | null;
    expect(root).not.toBeNull();
    expect(root?.className).toContain('d-stats-vertical');
    expect(root?.className).not.toContain('d-stats-horizontal');
  });
});
