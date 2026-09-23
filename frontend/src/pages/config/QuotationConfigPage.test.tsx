import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QUOTATION_GRID_COLUMNS } from '@tingting/shared';
import QuotationConfigPage from './QuotationConfigPage';

const { apiGet, apiPut } = vi.hoisted(() => ({ apiGet: vi.fn(), apiPut: vi.fn() }));
vi.mock('../../lib/api', () => ({
  api: { get: apiGet, post: vi.fn(), put: apiPut },
  ApiError: class ApiError extends Error {},
}));

function makeWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

const frames = [
  { id: 1, customerId: 7, customerName: 'Công ty A', templateName: 'Mẫu 1', effectiveDate: '2026-09-01', note: null },
  { id: 2, customerId: 9, customerName: 'Công ty B', templateName: 'LOG COM', effectiveDate: '2026-09-15', note: 'Hiệu lực sau' },
];

function cell(overrides: Partial<Record<string, unknown>>): Record<string, unknown> {
  return {
    routeId: 3, routeName: 'KCN Quế Võ – ASKEY', vehicleSizeClassCode: '1.25T', heSo: 1,
    giaCos: 1248000, missingPrice: false, liters: 20, surcharge: 241948, total: 1489948,
    baseFuelPrice: 17842.593, fuelLagDays: 1, formula: '…', ...overrides,
  } as Record<string, unknown>;
}

const gridCells = QUOTATION_GRID_COLUMNS.map((column, index) => cell({
  vehicleSizeClassCode: column.vehicleSizeClassCode,
  missingPrice: index >= 7,           // last three heavy cells miss prices
  giaCos: index >= 7 ? null : 1248000,
  liters: index >= 7 ? 64 : 20 + index,
  surcharge: index >= 7 ? 774234 : 241948,
  total: index >= 7 ? null : 1489948,
}));

beforeEach(() => {
  apiGet.mockImplementation((path: string) => {
    if (path === '/quotations') return Promise.resolve(frames);
    if (path === '/quotations/1') return Promise.resolve({
      id: 1, customerId: 7, customerName: 'Công ty A', templateName: 'Mẫu 1', effectiveDate: '2026-09-01', note: null,
      cells: gridCells,
    });
    return Promise.reject(new Error(`unexpected ${path}`));
  });
});

describe('QuotationConfigPage (card 20260922_56)', () => {
  it('lists frames, filters by customer and date window, and opens the grid', async () => {
    render(<QuotationConfigPage />, { wrapper: makeWrapper() });
    const framesRegion = document.querySelector('.quotation-frames') as HTMLElement;
    expect(await within(framesRegion).findByText('Công ty A')).toBeTruthy();
    expect(within(framesRegion).getByText('Công ty B')).toBeTruthy();

    // TC-BG-09: customer filter narrows the frame list (react-aria select).
    fireEvent.click(screen.getByRole('button', { name: /Khách hàng/i }));
    fireEvent.click(screen.getByRole('option', { name: 'Công ty B' }));
    await waitFor(() => expect(within(framesRegion).queryByText('Công ty A')).toBeNull());
    expect(within(framesRegion).getByText('Công ty B')).toBeTruthy();

    // Date window filter on effectiveDate.
    fireEvent.change(screen.getByLabelText('Từ ngày'), { target: { value: '15/09/2026' } });
    expect(within(framesRegion).queryByText('Công ty A')).toBeNull();
    expect(within(framesRegion).getByText('Công ty B')).toBeTruthy();
  });

  it('opens the grid with the two group headers and all ten class columns in file order', async () => {
    render(<QuotationConfigPage />, { wrapper: makeWrapper() });
    const framesRegion = document.querySelector('.quotation-frames') as HTMLElement;
    fireEvent.click(await within(framesRegion).findByText('Công ty A'));
    expect(await screen.findByRole('heading', { name: 'KCN Quế Võ – ASKEY' })).toBeTruthy();
    expect(screen.getByText('HÀNG LẺ')).toBeInTheDocument();
    expect(screen.getByText('HÀNG CONTAINER')).toBeInTheDocument();
    expect(screen.getByText(/Giá dầu tham chiếu/)).toBeTruthy();
    expect(screen.getByText(/Lag 1 ngày/)).toBeTruthy();
    // Ten class columns, file order.
    for (const label of QUOTATION_GRID_COLUMNS.map((c) => c.label)) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
    for (const label of ['Hệ số', 'Tổng lít dầu/chuyến', 'Giá cos', 'Phụ phí', 'Tổng']) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    expect(screen.getAllByText('Thiếu giá')).toHaveLength(3);
  });

  it('renders missing-price cells per ruling 2 and persists heSo edits through PUT /quotations/:id', async () => {
    render(<QuotationConfigPage />, { wrapper: makeWrapper() });
    const framesRegion = document.querySelector('.quotation-frames') as HTMLElement;
    fireEvent.click(await within(framesRegion).findByText('Công ty A'));
    await screen.findByRole('heading', { name: 'KCN Quế Võ – ASKEY' });

    // Ruling 2: missing prices render "Thiếu giá" — never a light fallback.
    expect(screen.getAllByText('Thiếu giá')).toHaveLength(3);

    // heSo edit commits on blur: PUT carries the full cells array with the
    // edited multiplier (the quotation's own datum).
    const input = screen.getByLabelText('Hệ số KCN Quế Võ – ASKEY 1.25T');
    fireEvent.change(input, { target: { value: '1.5' } });
    fireEvent.blur(input);
    await waitFor(() => expect(apiPut).toHaveBeenCalledTimes(1));
    const [path, body] = apiPut.mock.calls[0];
    expect(path).toBe('/quotations/1');
    expect(body.cells[0]).toEqual({ routeId: 3, vehicleSizeClassCode: '1.25T', heSo: 1.5 });
    expect(body.templateName).toBe('Mẫu 1');
    expect(body.effectiveDate).toBe('2026-09-01');
  });
});
