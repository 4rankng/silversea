import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QUOTATION_GRID_COLUMNS } from '@tingting/shared';
import QuotationConfigPage from './QuotationConfigPage';

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
      fees: [],
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

describe('QuotationConfigPage version history (card 20260922_62)', () => {
  const versionItems = [
    { version: 2, triggerKind: 'FUEL_APPROVED', releasedBy: 3, releasedAt: '2026-09-20T10:00:00.000Z' },
    { version: 1, triggerKind: 'MANUAL_EDIT', releasedBy: 3, releasedAt: '2026-09-10T10:00:00.000Z' },
  ];
  const versionPayload = {
    id: 1, customerId: 7, customerName: 'Công ty A', templateName: 'Mẫu 1', effectiveDate: '2026-09-01',
    surchargeRoundingMode: 'NONE', note: null,
    cells: [{
      routeId: 3, routeName: 'HN — ASKEY', vehicleSizeClassCode: 'CONT20.LIGHT', heSo: 1,
      liters: 64, giaCos: 3978000, surcharge: 241948, total: 4219948, missingPrice: false,
      surchargeRaw: 241948, baseFuelPrice: 17842.5926, fuelLagDays: 2, formula: 'f',
    }],
  };

  beforeEach(() => {
    apiGet.mockReset();
    apiGetBlob.mockReset();
  });

  it('renders the newest-first history with business VN trigger labels and passes the date filter', async () => {
    apiGet.mockImplementation((path: string) => {
      if (path === '/quotations') return Promise.resolve(frames);
      if (path === '/quotations/1') return Promise.resolve({
        id: 1, customerId: 7, customerName: 'Công ty A', templateName: 'Mẫu 1', effectiveDate: '2026-09-01', note: null,
        cells: gridCells,
        fees: [],
      });
      // Order matters: the frozen-payload route must win over the list prefix.
      if (path === '/quotations/1/versions/2') return Promise.resolve(versionPayload);
      if (path.startsWith('/quotations/1/versions')) return Promise.resolve({ items: versionItems, total: 2 });
      return Promise.reject(new Error(`unexpected ${path}`));
    });
    render(<QuotationConfigPage />, { wrapper: makeWrapper() });
    const framesRegion = document.querySelector('.quotation-frames') as HTMLElement;
    fireEvent.click(await within(framesRegion).findByText('Công ty A'));

    const history = await screen.findByRole('region', { name: 'Lịch sử phiên bản báo giá' });
    expect(await within(history).findByText('Phiên bản 2')).toBeTruthy();
    expect(await within(history).findByText('Duyệt cập nhật giá dầu')).toBeTruthy();
    expect(await within(history).findByText('Chỉnh sửa tay')).toBeTruthy();

    // The date filter rides the request as from/to.
    fireEvent.change(within(history).getByLabelText('Từ ngày (phiên bản)'), { target: { value: '15/09/2026' } });
    await waitFor(() => expect(
      apiGet.mock.calls.some(([path]) => String(path).includes('/versions?from=15%2F09%2F2026') || String(path).includes('from=')),
    ).toBe(true));

    // Xem renders the FROZEN payload read-only; export rides the version param.
    fireEvent.click((await within(history).findAllByRole('button', { name: 'Xem' }))[0]);
    await waitFor(() => expect(
      apiGet.mock.calls.some(([path]) => String(path) === '/quotations/1/versions/2'),
    ).toBe(true));
    expect(await screen.findByRole('group', { name: 'Phiên bản 2 (chỉ đọc)' })).toBeTruthy();
    expect(screen.getByText('HN — ASKEY')).toBeTruthy();
    expect(screen.getByText('CONT20.LIGHT')).toBeTruthy();
    fireEvent.click(within(history).getAllByRole('button', { name: 'Xuất xlsx' })[0]);
    await waitFor(() => expect(apiGetBlob).toHaveBeenCalledWith('/quotations/1/export?version=2'));
  });
});
describe('QuotationConfigPage fee catalog (card 20260922_64)', () => {
  const feeCatalog = [
    { id: 91, feeName: 'Phí mở tờ khai', subType: 'Hàng thông thường', defaultAmount: 500000, routing: 'OTHER_COSTS', note: null, sortOrder: 0 },
    { id: 92, feeName: 'Hải quan giám sát', subType: 'Luồng xanh/vàng', defaultAmount: 150000, routing: 'DEDICATED_CUSTOMS', note: null, sortOrder: 1 },
    { id: 93, feeName: 'Nâng/Hạ Lạch Huyện', subType: null, defaultAmount: 500000, routing: 'DEDICATED_LACH_HUYEN', note: null, sortOrder: 2 },
    { id: 94, feeName: 'Kiểm hóa', subType: null, defaultAmount: null, routing: 'OTHER_COSTS', note: null, sortOrder: 3 },
  ];

  function mockView(fees: unknown[]) {
    apiGet.mockReset();
    apiGetBlob.mockReset();
    apiPut.mockClear();
    apiGet.mockImplementation((path: string) => {
      if (path === '/quotations') return Promise.resolve(frames);
      if (path === '/quotations/1') return Promise.resolve({
        id: 1, customerId: 7, customerName: 'Công ty A', templateName: 'Mẫu 1', effectiveDate: '2026-09-01', note: null,
        cells: gridCells,
        fees,
      });
      if (path === '/quotations/1/versions') return Promise.resolve({ items: [], total: 0 });
      return Promise.reject(new Error(`unexpected ${path}`));
    });
  }

  it('renders the catalog verbatim with TẠM amounts, routing labels, and pending-empty rows', async () => {
    mockView(feeCatalog);
    render(<QuotationConfigPage />, { wrapper: makeWrapper() });
    fireEvent.click(await within(document.querySelector('.quotation-frames') as HTMLElement).findByText('Công ty A'));  // open frame 1
    const feesRegion = await screen.findByRole('region', { name: 'Danh mục chi phí khác' });

    expect(await within(feesRegion).findByText('Phí mở tờ khai')).toBeTruthy();
    expect(within(feesRegion).getByText('Hàng thông thường')).toBeTruthy();
    expect(within(feesRegion).getAllByText('Cột riêng — Hải quan giám sát').length).toBeGreaterThan(0);
    expect(within(feesRegion).getAllByText('Cột riêng — Nâng/Hạ Lạch Huyện').length).toBeGreaterThan(0);
    // TẠM defaults render in the inputs; pending-empty rows show no autofill.
    expect(within(feesRegion).getByLabelText('Số tiền mặc định Phí mở tờ khai · Hàng thông thường')).toHaveValue('500000');
    expect(within(feesRegion).getByLabelText('Số tiền mặc định Kiểm hóa')).toHaveValue('');
    expect(within(feesRegion).getAllByText('Cột chi phí khác').length).toBeGreaterThan(0);
  });

  it('saves the catalog through the frame PUT with schema-clean fees and the FULL cells list', async () => {
    mockView(feeCatalog);
    render(<QuotationConfigPage />, { wrapper: makeWrapper() });
    fireEvent.click(await within(document.querySelector('.quotation-frames') as HTMLElement).findByText('Công ty A'));  // open frame 1
    await screen.findByRole('region', { name: 'Danh mục chi phí khác' });

    fireEvent.change(screen.getByLabelText('Số tiền mặc định Kiểm hóa'), { target: { value: '250000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu danh mục' }));
    await waitFor(() => expect(apiPut).toHaveBeenCalledTimes(1));
    const [path, body] = apiPut.mock.calls[0];
    expect(path).toBe('/quotations/1');
    expect(body.fees).toHaveLength(4);
    expect(body.fees[0]).toEqual({ feeName: 'Phí mở tờ khai', subType: 'Hàng thông thường', defaultAmount: 500000, routing: 'OTHER_COSTS', note: null, sortOrder: 0 });
    expect(body.fees[3]).toEqual({ feeName: 'Kiểm hóa', subType: null, defaultAmount: 250000, routing: 'OTHER_COSTS', note: null, sortOrder: 3 });
    // Replace-all: the PUT carries the full cells list untouched.
    expect(body.cells).toHaveLength(QUOTATION_GRID_COLUMNS.length);
    // No view-only ids ride the payload.
    expect(body.fees.some((f: { id?: number }) => 'id' in f)).toBe(false);
  });

  it('heSo edit with fees present: PUT stays schema-clean (regression for the id-carrying 400)', async () => {
    mockView(feeCatalog);
    render(<QuotationConfigPage />, { wrapper: makeWrapper() });
    fireEvent.click(await within(document.querySelector('.quotation-frames') as HTMLElement).findByText('Công ty A'));  // open frame 1
    await screen.findByRole('region', { name: 'Danh mục chi phí khác' });

    fireEvent.change(screen.getByLabelText('Hệ số KCN Quế Võ – ASKEY 1.25T'), { target: { value: '1.5' } });
    fireEvent.blur(screen.getByLabelText('Hệ số KCN Quế Võ – ASKEY 1.25T'));
    await waitFor(() => expect(apiPut).toHaveBeenCalledTimes(1));
    const [path, body] = apiPut.mock.calls[0];
    expect(path).toBe('/quotations/1');
    expect(body.cells[0]).toEqual({ routeId: 3, vehicleSizeClassCode: '1.25T', heSo: 1.5 });
    expect(body.fees).toHaveLength(4);
    expect(body.fees.some((f: { id?: number }) => 'id' in f)).toBe(false);
  });

  it('add-row appends an unsaved draft row and Lưu persists it with derived routing', async () => {
    mockView([]);
    render(<QuotationConfigPage />, { wrapper: makeWrapper() });
    fireEvent.click(await within(document.querySelector('.quotation-frames') as HTMLElement).findByText('Công ty A'));  // open frame 1
    await screen.findByRole('region', { name: 'Danh mục chi phí khác' });

    fireEvent.click(screen.getByRole('button', { name: 'Thêm dòng' }));
    fireEvent.change(screen.getByLabelText('Nội dung'), { target: { value: 'Lưu ca xe' } });
    fireEvent.change(screen.getByLabelText('Số tiền mặc định Lưu ca xe'), { target: { value: '1000000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu danh mục' }));
    await waitFor(() => expect(apiPut).toHaveBeenCalledTimes(1));
    const [path, body] = apiPut.mock.calls[0];
    expect(body.fees[0]).toEqual({ feeName: 'Lưu ca xe', subType: null, defaultAmount: 1000000, routing: 'OTHER_COSTS', note: null, sortOrder: 0 });
  });
});
