import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ProfitabilityReportPanel } from './ProfitabilityReportPanel';

const { getProfitabilityMock, exportProfitabilityMock } = vi.hoisted(() => ({
  getProfitabilityMock: vi.fn(),
  exportProfitabilityMock: vi.fn(),
}));

vi.mock('../../api/customerServiceFinanceClient', () => ({
  customerServiceFinanceClient: {
    getProfitability: getProfitabilityMock,
    exportProfitability: exportProfitabilityMock,
  },
}));

function renderPanel(month: number, year: number) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter><ProfitabilityReportPanel month={month} year={year} /></MemoryRouter>
    </QueryClientProvider>,
  );
  return {
    ...view,
    rerenderPanel(nextMonth: number, nextYear: number) {
      view.rerender(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter><ProfitabilityReportPanel month={nextMonth} year={nextYear} /></MemoryRouter>
        </QueryClientProvider>,
      );
    },
  };
}

describe('ProfitabilityReportPanel low-margin policy', () => {
  beforeEach(() => {
    getProfitabilityMock.mockReset();
    exportProfitabilityMock.mockReset();
    getProfitabilityMock.mockResolvedValue({
      requestedPeriod: { month: 8, year: 2026 },
      asOf: '2026-08-03T00:00:00.000Z',
      definitionVersion: 'profitability-v4',
      dimension: 'CUSTOMER', page: 1, limit: 50, totalGroups: 1, totalPages: 1,
      items: [{
        key: '1', label: 'Khách hàng A', attributionStatus: 'ATTRIBUTED',
        revenue: 1_000_000, directCost: 830_000, sharedOverhead: 20_000,
        allocatedFleetFixedCost: 20_000, profit: 150_000,
        tripCount: 2, sourceTripIds: [101, 102], sourceTripReferences: [
          { tripId: 101, reference: 'BL-2026-101' },
          { tripId: 102, reference: 'BOOK-2026-102' },
        ], marginRatio: 0.15, alertState: 'LOW_MARGIN',
        attributionNote: 'Biên lợi nhuận gồm chi phí đội xe được phân bổ.',
      }],
      totals: { revenue: 1_000_000, directCost: 830_000, sharedOverhead: 20_000, profit: 150_000 },
      lowMarginPolicy: {
        status: 'CONFIGURED', source: 'APPROVED_GOVERNANCE', policyVersionId: 9,
        publicVersion: 'policy-9', effectiveFrom: '2026-08-01', thresholdRatio: 0.2,
        thresholdPercent: 20, filter: 'ALL', totals: { marginRatio: 0.15, alertState: 'LOW_MARGIN' },
        note: 'Cảnh báo chỉ phân loại báo cáo.',
      },
      sourceCoverage: { snapshottedTrips: 2, pnlTrips: 2, missingAttribution: 0 },
      reconciliation: { difference: 0, status: 'RECONCILED', note: '' },
    });
  });

  it('shows the configured threshold and requests the bounded low-margin filter', async () => {
    renderPanel(8, 2026);
    expect(await screen.findByText(/Ngưỡng cảnh báo kỳ này: 20%/)).toBeTruthy();
    expect(screen.getByText('Biên lợi nhuận thấp')).toBeTruthy();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Chỉ hiện nhóm biên lợi nhuận thấp' }));
    await waitFor(() => expect(getProfitabilityMock).toHaveBeenLastCalledWith({
      month: 8, year: 2026, dimension: 'CUSTOMER', page: 1, lowMarginOnly: true,
    }));
    expect(await screen.findByText('20.000 ₫')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'BL-2026-101' }).getAttribute('href')).toBe('/trips/101');
    expect(screen.queryByText('Chuyến #101')).toBeNull();
    expect(screen.queryByText('Biên lợi nhuận gồm chi phí đội xe được phân bổ.')).toBeNull();
  });

  it('explains empty low-margin results and restores all groups without losing the period', async () => {
    const configured = await getProfitabilityMock();
    getProfitabilityMock.mockImplementation(async ({ lowMarginOnly }) => ({
      ...configured, items: lowMarginOnly ? [] : configured.items,
      totalGroups: lowMarginOnly ? 0 : 1,
    }));
    renderPanel(8, 2026);
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Chỉ hiện nhóm biên lợi nhuận thấp' }));
    expect(await screen.findByText('Không có nhóm biên lợi nhuận thấp trong kỳ này.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Xem tất cả nhóm' }));
    expect(await screen.findByText('Khách hàng A')).toBeInTheDocument();
    expect(getProfitabilityMock).toHaveBeenLastCalledWith(expect.objectContaining({ month: 8, year: 2026, lowMarginOnly: false, page: 1 }));
    await waitFor(() => expect(screen.getByRole('region', { name: 'Tóm tắt lợi nhuận vận hành' })).toHaveTextContent('1.000.000 ₫'));
  });

  it('clears an impossible low-margin filter when navigating to an unconfigured period', async () => {
    const configured = await getProfitabilityMock();
    getProfitabilityMock.mockResolvedValueOnce(configured);
    const view = renderPanel(8, 2026);
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Chỉ hiện nhóm biên lợi nhuận thấp' }));
    await waitFor(() => expect(getProfitabilityMock).toHaveBeenLastCalledWith(expect.objectContaining({ lowMarginOnly: true })));

    getProfitabilityMock.mockResolvedValue({
      ...configured,
      requestedPeriod: { month: 9, year: 2026 },
      items: [],
      lowMarginPolicy: {
        ...configured.lowMarginPolicy,
        status: 'UNCONFIGURED', source: 'UNCONFIGURED', policyVersionId: null,
        publicVersion: null, effectiveFrom: null, thresholdRatio: null, thresholdPercent: null,
        note: 'Chưa cấu hình ngưỡng cảnh báo biên lợi nhuận cho kỳ báo cáo.',
      },
    });
    view.rerenderPanel(9, 2026);
    await waitFor(() => expect(getProfitabilityMock).toHaveBeenLastCalledWith(expect.objectContaining({
      month: 9, lowMarginOnly: false,
    })));
    const checkbox = await screen.findByRole('checkbox', { name: 'Chỉ hiện nhóm biên lợi nhuận thấp' });
    expect((checkbox as HTMLInputElement).checked).toBe(false);
  });

  it('keeps a non-comparable margin compact while retaining its full accessible meaning', async () => {
    const configured = await getProfitabilityMock();
    getProfitabilityMock.mockResolvedValue({
      ...configured,
      items: [{ ...configured.items[0], marginRatio: null, alertState: 'NORMAL' }],
    });

    renderPanel(8, 2026);

    expect(await screen.findByLabelText('Không thể so sánh')).toHaveTextContent('—');
    expect(screen.queryByText('Không thể so sánh')).toBeNull();
  });
});
