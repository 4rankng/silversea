import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QUOTATION_GRID_COLUMNS } from '@tingting/shared';
import QuotationConfigPage from './QuotationConfigPage';

// Card 20260923_10 — the two display defects QA found on the quotation screen
// (staging rung 6c8b162e):
//   D3  the frames-table header "NGÀY HIỆU LỰC" painted over "GHI CHÚ". The
//       shared .tt-table header contract is `white-space: nowrap` under
//       `table-layout: fixed`, so a long header overflows visibly into the
//       neighbour column instead of wrapping.
//   D5  the "Tổng lít dầu/chuyến" row reused the đồng formatter ("20 ₫").
//       Liters are a count, not money — the row label already names the unit,
//       so the cell must render the bare number.
// Both regressions are pinned below: the header wrap contract, and the liters
// row carrying no currency suffix.

const { apiGet, apiPut, apiGetBlob } = vi.hoisted(() => ({ apiGet: vi.fn(), apiPut: vi.fn(), apiGetBlob: vi.fn() }));
vi.mock('../../lib/api', () => ({
  api: { get: apiGet, post: vi.fn(), put: apiPut, getBlob: apiGetBlob },
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
];

function cell(overrides: Record<string, unknown>) {
  return {
    routeId: 3, routeName: 'KCN Quế Võ – ASKEY', vehicleSizeClassCode: '1.25T', heSo: 1,
    giaCos: 1248000, missingPrice: false, liters: 20, surcharge: 241948, total: 1489948,
    baseFuelPrice: 17842.593, fuelLagDays: 1, formula: '…', ...overrides,
  };
}

const gridCells = QUOTATION_GRID_COLUMNS.map((column, index) => cell({
  vehicleSizeClassCode: column.vehicleSizeClassCode,
  missingPrice: index >= 7,
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
      cells: gridCells, fees: [],
    });
    if (path.startsWith('/quotations/1/versions')) return Promise.resolve({ items: [], total: 0 });
    return Promise.reject(new Error(`unexpected ${path}`));
  });
});

describe('QuotationConfigPage display fixes (card 20260923_10)', () => {
  it('D3: quotation table headers wrap, so no header paints over its neighbour column', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/pages/config/QuotationConfigPage.css'), 'utf8');
    // UI35 preserves the original overlap gate with intrinsic matrix tracks
    // and the shared labelled-record frame recipe instead of equal columns.
    const source = readFileSync(resolve(process.cwd(), 'src/pages/config/QuotationConfigPage.tsx'), 'utf8');
    expect(css).toMatch(/\.quotation-grid\s*\{[^}]*table-layout:\s*auto;[^}]*min-width:\s*max-content/);
    expect(css).toMatch(/\.quotation-grid thead th\s*\{[^}]*white-space:\s*normal;[^}]*overflow-wrap:\s*normal/);
    expect(source).toContain('quotation-frames__table record-table ops-table');
    expect(source).toContain('data-label="Ngày hiệu lực"><span className="data-token">{frame.effectiveDate}');
    expect(css).toMatch(/\.quotation-frames__table tbody td\s*\{[^}]*overflow-wrap:\s*normal/);
  });

  it('D5: the liters row renders a bare count, never a currency suffix', async () => {
    render(<QuotationConfigPage />, { wrapper: makeWrapper() });
    const framesRegion = document.querySelector('.quotation-frames') as HTMLElement;
    fireEvent.click(await within(framesRegion).findByText('Công ty A'));
    await screen.findByRole('heading', { name: 'KCN Quế Võ – ASKEY' });

    const table = document.querySelector('.quotation-grid') as HTMLElement;
    const headers = within(table).getAllByRole('columnheader');
    const litersIndex = headers.findIndex((header) => header.textContent === 'Tổng lít dầu/chuyến');
    expect(litersIndex).toBe(2);
    const classRows = within(table).getAllByRole('row').slice(1);
    expect(classRows).toHaveLength(10);
    const liters = classRows.map((row) => within(row).getAllByRole('cell')[litersIndex - 1].textContent);
    expect(liters[0]).toBe('20');
    expect(liters[liters.length - 1]).toBe('64');
    expect(liters.join(' ')).not.toMatch(/[₫đ]/);
  });
});
