import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import {
  AdvanceSettlementStatus,
  ExpenseEntryStatus,
  type AdvanceSettlementWithRefs,
} from '@tingting/shared';
import {
  SettlementGridRow,
  SettlementMobileCard,
  summarizeSettlementStats,
} from './AdminAdvanceSettlementsPage';

describe('admin advance settlement ledger density', () => {
  it('counts reversed settlements for the history filter', () => {
    const stats = summarizeSettlementStats([
      { status: AdvanceSettlementStatus.REVERSED, totalExpenseAmount: '1250000' },
      { status: AdvanceSettlementStatus.APPROVED, totalExpenseAmount: '900000' },
    ]);

    expect(stats.counts.REVERSED).toBe(1);
    expect(stats.totals.REVERSED).toBe(1_250_000);
  });

  const settlement = {
    id: 7,
    code: 'PT-2607-0004',
    forwarderName: 'Nguyễn Sĩ Quân',
    status: AdvanceSettlementStatus.APPROVED,
    totalExpenseAmount: 49_952_400,
    refundAmount: 1_000_000,
    createdAt: '2026-07-21T00:00:00.000Z',
    linkedExpenses: [
      {
        tripId: 42,
        tripCode: 'TRP-202607-0042',
        departureDate: '2026-07-23',
        customerName: 'Công ty Biển Bạc',
        routeName: 'Hải Phòng – Hà Nội',
        tripContainerCount: 2,
        containerNumber: 'MSKU-001',
        expenseType: 'LIFTING',
        expenseTypeName: 'Phí nâng container',
        buyAmount: '1200000',
      },
      {
        tripId: 42,
        tripCode: 'TRP-202607-0042',
        departureDate: '2026-07-23',
        customerName: 'Công ty Biển Bạc',
        routeName: 'Hải Phòng – Hà Nội',
        tripContainerCount: 2,
        containerNumber: 'MSKU-002',
        expenseType: 'CUSTOMS',
        expenseTypeName: 'Phí hải quan',
        buyAmount: '800000',
      },
    ],
    opsCompletion: {
      tripCount: 1,
      completedGroupCount: 1,
      totalGroupCount: 2,
      trips: [{
        tripId: 42,
        tripCode: 'TRP-202607-0042',
        departureDate: '2026-07-23',
        completedGroupCount: 1,
        totalGroupCount: 2,
        groups: [
          {
            tripContainerId: 10,
            containerNumber: 'MSKU-001',
            expenseCount: 1,
            status: ExpenseEntryStatus.COMPLETED,
          },
          {
            tripContainerId: 11,
            containerNumber: 'MSKU-002',
            expenseCount: 1,
            status: ExpenseEntryStatus.IN_PROGRESS,
          },
        ],
      }],
    },
  } as unknown as AdvanceSettlementWithRefs;

  it.each([
    {
      layout: 'desktop row',
      component: (
        <SettlementGridRow
          s={settlement}
        />
      ),
    },
    {
      layout: 'constrained-width card',
      component: (
        <SettlementMobileCard
          s={settlement}
        />
      ),
    },
  ])('shows one transport-plan row with decision context in the $layout', ({ layout, component }) => {
    render(
      <MemoryRouter>
        {component}
      </MemoryRouter>,
    );

    if (layout === 'constrained-width card') {
      expect(screen.getByText('Khoản chi').previousElementSibling?.textContent).toBe('2');
      expect(screen.getByText('Chuyến').previousElementSibling?.textContent).toBe('1');
      expect(screen.getByText('Container').previousElementSibling?.textContent).toBe('2');
    } else {
      expect(screen.getByText('Tạm ứng quyết toán')).toBeTruthy();
      expect(screen.getByText('Tổng chi phí')).toBeTruthy();
      expect(screen.getByText('Hoàn lại')).toBeTruthy();
    }
    expect(screen.getByText(/TRP-202607-0042/)).toBeTruthy();
    expect(screen.getByText(/Công ty Biển Bạc/)).toBeTruthy();
    expect(screen.getByText(/Hải Phòng – Hà Nội/)).toBeTruthy();
    expect(screen.getByText(/Phí nâng container/)).toBeTruthy();
    expect(screen.getByText(/Phí hải quan/)).toBeTruthy();
    expect(screen.queryByText(/MSKU-001/)).toBeNull();
    expect(screen.queryByText(/MSKU-002/)).toBeNull();
  });
});
