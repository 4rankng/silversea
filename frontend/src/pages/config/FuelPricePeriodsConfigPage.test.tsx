import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi, beforeEach } from 'vitest';

const { listFuelApprovalsMock, decideFuelApprovalsMock } = vi.hoisted(() => ({
  listFuelApprovalsMock: vi.fn(),
  decideFuelApprovalsMock: vi.fn(),
}));

vi.mock('../../api/quotationClient', () => ({
  quotationClient: {
    listFuelApprovals: listFuelApprovalsMock,
    decideFuelApprovals: decideFuelApprovalsMock,
  },
}));

let lastRenderForm: ((p: Record<string, unknown>) => ReactNode) | null = null;

vi.mock('../../components/config/CrudTable', async () => {
  const React = await import('react');
  return {
    CrudTable: (props: { renderForm: (p: Record<string, unknown>) => ReactNode }) => {
      lastRenderForm = props.renderForm;
      return React.createElement('div', { 'data-testid': 'crud-table' });
    },
  };
});

vi.mock('../../hooks/animations', () => ({
  usePageAnimations: () => ({ rootRef: { current: null } }),
}));

import FuelPricePeriodsConfigPage from './FuelPricePeriodsConfigPage';

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <FuelPricePeriodsConfigPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function renderForm(props: Record<string, unknown> = {}) {
  if (!lastRenderForm) throw new Error('renderForm not captured');
  return render(
    <div data-testid="form-host">
      {lastRenderForm({ saving: false, onSave: vi.fn(), onCancel: vi.fn(), ...props }) as ReactNode}
    </div>,
  );
}

const SAVE = 'Thêm';

function fillFuelForm(host: HTMLElement, date: string, price: string, note: string) {
  fireEvent.change(within(host).getByLabelText('Ngày hiệu lực'), { target: { value: date } });
  fireEvent.change(within(host).getByLabelText('Giá dầu mới (đ/lít)'), { target: { value: price } });
  fireEvent.change(within(host).getByLabelText('Ghi chú (tùy chọn)'), { target: { value: note } });
}

describe('FuelPricePeriodsConfigPage — TC-CUOC-002 fuel price entry', () => {
  beforeEach(() => {
    listFuelApprovalsMock.mockReset();
    decideFuelApprovalsMock.mockReset();
    listFuelApprovalsMock.mockResolvedValue({ items: [], total: 0 });
    decideFuelApprovalsMock.mockResolvedValue({ updated: [] });
  });

  it('renders the CrudTable surface', () => {
    renderPage();
    expect(screen.getByTestId('crud-table')).toBeTruthy();
  });

  it('blocks save when date/price empty or price is not positive', () => {
    renderPage();
    const onSave = vi.fn();
    const host = renderForm({ onSave });

    fireEvent.click(screen.getByText(SAVE));
    expect(onSave).not.toHaveBeenCalled();

    fillFuelForm(host.container as HTMLElement, '', '0', '');
    fireEvent.click(screen.getByText(SAVE));
    expect(onSave).not.toHaveBeenCalled();
  });

  it('sends { effectiveFrom, unitPrice number, sourceNote } on save', () => {
    renderPage();
    const onSave = vi.fn();
    const host = renderForm({ onSave });

    fillFuelForm(host.container as HTMLElement, '10/09/2026', '21740', 'Petrolimex 18/7');
    fireEvent.click(screen.getByText(SAVE));

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith({
      effectiveFrom: '2026-09-10',
      unitPrice: 21740,
      sourceNote: 'Petrolimex 18/7',
    });
  });

  it('card 20260922_61: pending banner surfaces the count and the drawer batch-list decides', async () => {
    listFuelApprovalsMock.mockResolvedValue({
      items: [
        { id: 11, fuelPricePeriodId: 3, customerId: 1, quotationId: 1, status: 'PENDING',
          customerName: 'LONG MINH', quotationName: 'Mẫu báo giá 1', quotationEffectiveDate: '2026-01-01',
          periodUnitPrice: '30000.00', periodEffectiveFrom: '2026-09-03', decidedAt: null },
        { id: 12, fuelPricePeriodId: 3, customerId: 2, quotationId: 2, status: 'PENDING',
          customerName: 'LOGCOM', quotationName: 'Mẫu báo giá 2', quotationEffectiveDate: '2026-02-01',
          periodUnitPrice: '30000.00', periodEffectiveFrom: '2026-09-03', decidedAt: null },
      ],
      total: 2,
    });
    renderPage();

    const banner = await screen.findByRole('alert');
    expect(banner.textContent).toContain('ĐỒNG Ý CẬP NHẬT BÁO GIÁ');
    expect(banner.textContent).toContain('2');
    fireEvent.click(within(banner).getByRole('button', { name: 'Xem danh sách chờ' }));

    const drawer = await screen.findByRole('dialog', { name: 'Đồng ý cập nhật báo giá' });
    fireEvent.click(within(drawer).getByLabelText('Chọn tất cả'));
    await waitFor(() => expect(within(drawer).getByRole('button', { name: 'Đồng ý (2)' })).toBeEnabled());
    fireEvent.click(within(drawer).getByRole('button', { name: 'Đồng ý (2)' }));
    await waitFor(() => expect(decideFuelApprovalsMock).toHaveBeenCalledWith([11, 12], 'AGREED'));

    // Per-row path: a single row decides with only its own id.
    fireEvent.click(within(drawer).getAllByRole('button', { name: 'Không' })[0]);
    await waitFor(() => expect(decideFuelApprovalsMock).toHaveBeenCalledWith([11], 'DECLINED'));
  });

  it('card 20260922_61: no pending rows — no banner', async () => {
    listFuelApprovalsMock.mockResolvedValue({ items: [], total: 0 });
    renderPage();
    await waitFor(() => expect(listFuelApprovalsMock).toHaveBeenCalled());
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
