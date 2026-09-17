import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, render as renderView, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ShipmentStatus } from '@tingting/shared';

const { apiGet, apiPost, apiGetBlob, apiGetForText } = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiGetBlob: vi.fn(),
  apiGetForText: vi.fn(),
}));

vi.mock('../../lib/api', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../lib/api')>(),
  api: { get: apiGet, post: apiPost, getBlob: apiGetBlob, getForText: apiGetForText },
}));

import PortalShipmentsPage from './PortalShipmentsPage';
import PortalShipmentDetailPage from './PortalShipmentDetailPage';
import PortalDebitNotesPage from './PortalDebitNotesPage';
import PortalStatementPage from './PortalStatementPage';
import { CustomerPortalScopeProvider } from './CustomerPortalScope';

const portalPagesCss = readFileSync(resolve(process.cwd(), 'src/pages/portal/PortalPages.css'), 'utf8');
const portalStatementSource = readFileSync(resolve(process.cwd(), 'src/pages/portal/PortalStatementPage.tsx'), 'utf8');
const portalShipmentDetailSource = readFileSync(resolve(process.cwd(), 'src/pages/portal/PortalShipmentDetailPage.tsx'), 'utf8');

function render(ui: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return renderView(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

function portalInbox(items: Array<Record<string, unknown>>) {
  return {
    asOf: new Date().toISOString(),
    timezone: 'Asia/Ho_Chi_Minh',
    counts: { action: items.filter((item) => item.state === 'ACTION').length, waiting: items.filter((item) => item.state === 'WAITING').length, done: items.filter((item) => item.state === 'DONE').length },
    page: 1,
    limit: 100,
    total: items.length,
    totalPages: items.length ? 1 : 0,
    items,
  };
}

describe('customer portal pages', () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiPost.mockReset();
    apiGetBlob.mockReset();
    apiGetForText.mockReset();
  });

  it('conforms portal tables to the shared record-table base instead of a portal-private skin', () => {
    // The thead/td geometry, hover and card collapse are owned by
    // frontend/src/styles/record-table.css — no portal-private copy may
    // re-declare them (which previously leaked between ledger and detail).
    expect(portalPagesCss).not.toMatch(/\.portal-table\s+(thead|tbody|tr\b|td\b|th\b)/);
    expect(portalPagesCss).not.toMatch(/(^|\n)\s*\.portal-table thead\s*\{\s*display:\s*none/m);
    expect(portalStatementSource).toContain('record-table ops-table portal-table');
    expect(portalShipmentDetailSource).toContain('record-table ops-table portal-table');
  });

  it('collapses numeric pagination controls at customer-portal mobile widths', () => {
    expect(portalPagesCss).toContain(
      '.portal-pagination .ds-pagination__controls > .ds-pagination__btn:not(:first-child):not(:last-child)',
    );
    expect(portalPagesCss).toMatch(/\.portal-pagination \.ds-pagination__ellipsis\s*\{\s*display:\s*none;/);
  });

  it('PortalShipmentsPage calls the role-scoped customer inbox endpoint', async () => {
    apiGet.mockResolvedValue(portalInbox([{
      id: 'shipment:42', entityType: 'shipment', entityId: 42, title: 'SHP-2607-00042', subtitle: 'Đang theo dõi', state: 'WAITING', priority: 30, dueAt: '2026-07-31T00:00:00.000Z', freshnessAt: new Date().toISOString(), blockers: [], advisories: [], nextAction: null, targetRoute: '/portal/shipments/42', shipmentId: 42, containerSummary: 'MSBU1234567', deliveryTruth: 'IN_TRANSIT', deliveryResponseRequired: false, deliveryEventId: null, deliveryEventVersion: null,
    }]));

    render(
      <MemoryRouter>
        <PortalShipmentsPage />
      </MemoryRouter>,
    );

    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/portal/work-inbox?view=ACTION&page=1&limit=100'));
    fireEvent.click(screen.getByRole('tab', { name: /Đang xử lý/ }));
    expect(await screen.findByText('SHP-2607-00042')).toBeTruthy();
    expect(screen.getByText('MSBU1234567')).toBeTruthy();
    // The in-transit row's delivery-truth fact keeps the transport claim —
    // only the bucket label went neutral.
    expect(screen.getAllByText('Đang vận chuyển').length).toBeGreaterThan(0);
  });

  it('shows the authoritative shipment identity once in the customer inbox', async () => {
    apiGet.mockResolvedValue(portalInbox([{
      id: 'shipment:43', entityType: 'shipment', entityId: 43, title: 'SHP-2607-00043', subtitle: 'Đang theo dõi', state: 'ACTION', priority: 100, dueAt: null, freshnessAt: new Date().toISOString(), blockers: [], advisories: [], nextAction: { label: 'Phản hồi giao hàng', targetRoute: '/portal/shipments/43' }, targetRoute: '/portal/shipments/43', shipmentId: 43, containerSummary: null, deliveryTruth: 'DRIVER_REPORTED', deliveryResponseRequired: true, deliveryEventId: 91, deliveryEventVersion: 2,
    }]));

    render(<MemoryRouter><PortalShipmentsPage /></MemoryRouter>);

    expect(await screen.findByText('SHP-2607-00043')).toBeTruthy();
    expect(screen.getAllByText('SHP-2607-00043')).toHaveLength(1);
    expect(screen.getByText('Tài xế báo đã giao')).toBeTruthy();
  });

  it('keeps a multi-customer portal list separated by the selected legal entity', async () => {
    apiGet.mockImplementation(async (path: string) => {
      if (path === '/portal/customer-scope') {
        return {
          primaryCustomerId: 9,
          customers: [
            { id: 7, name: 'SilverSea Miền Nam' },
            { id: 9, name: 'SilverSea Miền Bắc' },
          ],
        };
      }
      return portalInbox([]);
    });

    render(
      <MemoryRouter>
        <CustomerPortalScopeProvider>
          <PortalShipmentsPage />
        </CustomerPortalScopeProvider>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(apiGet).toHaveBeenCalledWith('/portal/work-inbox?view=ACTION&page=1&limit=100&customerId=9');
    });
  });

  it('PortalShipmentDetailPage calls the row-scoped portal shipment detail endpoint', async () => {
    apiGet.mockImplementation(async (path: string) => path.includes('/customer-events') ? { items: [] } : ({
      shipment: {
        id: 42,
        shipmentCode: 'SHP-2607-00042',
        status: ShipmentStatus.IN_TRANSIT,
        bookingRef: 'BK-42',
        blNumber: 'BL-42',
        expectedDeliveryDate: '2026-07-31',
        pickupLocation: 'Hải Phòng',
        deliveryLocation: 'Hà Nội',
      },
      containers: [],
      documents: [],
      declarations: [],
      statusHistory: [],
    }));

    render(
      <MemoryRouter initialEntries={['/portal/shipments/42']}>
        <Routes>
          <Route path="/portal/shipments/:id" element={<PortalShipmentDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/portal/shipments/42'));
    expect(screen.getByRole('heading', { name: 'BL-42' })).toBeTruthy();
    expect(screen.queryByText('SHP-2607-00042')).toBeNull();
  });

  it('keeps shipment detail usable when customer-event loading fails', async () => {
    apiGet.mockImplementation(async (path: string) => {
      if (path.includes('/customer-events')) throw new Error('event service unavailable');
      return {
        shipment: {
          id: 42,
          shipmentCode: 'SHP-2607-00042',
          status: ShipmentStatus.IN_TRANSIT,
          bookingRef: 'BK-42',
          blNumber: 'BL-42',
          expectedDeliveryDate: '2026-07-31',
          pickupLocation: 'Hải Phòng',
          deliveryLocation: 'Hà Nội',
        },
        containers: [], documents: [], declarations: [], statusHistory: [],
      };
    });

    render(
      <MemoryRouter initialEntries={['/portal/shipments/42']}>
        <Routes>
          <Route path="/portal/shipments/:id" element={<PortalShipmentDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: 'BL-42' })).toBeTruthy();
    expect(screen.queryByText('SHP-2607-00042')).toBeNull();
    expect(screen.getByText('BK-42')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('Tạm thời chưa tải được');
  });

  it('binds shipment detail loading to the selected legal entity', async () => {
    apiGet.mockImplementation(async (path: string) => {
      if (path === '/portal/customer-scope') {
        return {
          primaryCustomerId: 9,
          customers: [
            { id: 7, name: 'SilverSea Miền Nam' },
            { id: 9, name: 'SilverSea Miền Bắc' },
          ],
        };
      }
      if (path.includes('/customer-events')) return { items: [] };
      return {
        shipment: {
          id: 42,
          shipmentCode: 'SHP-2607-00042',
          status: ShipmentStatus.IN_TRANSIT,
          bookingRef: null,
          blNumber: null,
          expectedDeliveryDate: null,
          pickupLocation: null,
          deliveryLocation: null,
        },
        containers: [],
        documents: [],
        declarations: [],
        statusHistory: [],
      };
    });

    render(
      <MemoryRouter initialEntries={['/portal/shipments/42']}>
        <CustomerPortalScopeProvider>
          <Routes>
            <Route path="/portal/shipments/:id" element={<PortalShipmentDetailPage />} />
          </Routes>
        </CustomerPortalScopeProvider>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(apiGet).toHaveBeenCalledWith('/portal/shipments/42?customerId=9');
    });
  });

  it('uses a declaration instead of an internal shipment code when Bill/Book is unavailable', async () => {
    apiGet.mockImplementation(async (path: string) => path.includes('/customer-events') ? { items: [] } : ({
      shipment: {
        id: 42,
        shipmentCode: 'SHP-2607-00042',
        status: ShipmentStatus.DISPATCHED,
        bookingRef: '   ',
        blNumber: '\t',
        expectedDeliveryDate: null,
        pickupLocation: null,
        deliveryLocation: null,
      },
      containers: [],
      documents: [],
      declarations: [{ id: 8, declarationNumber: '  TK-778899  ', issuedAt: null, scope: 'SHIPMENT', createdAt: '2026-08-12T00:00:00.000Z' }],
      statusHistory: [],
    }));

    render(
      <MemoryRouter initialEntries={['/portal/shipments/42']}>
        <Routes>
          <Route path="/portal/shipments/:id" element={<PortalShipmentDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: 'TK-778899' })).toBeTruthy();
    expect(screen.queryByText('SHP-2607-00042')).toBeNull();
  });

  it('PortalDebitNotesPage calls the row-scoped portal debit-note endpoint', async () => {
    apiGet.mockResolvedValue({
      items: [
        {
          id: 9,
          entityName: 'Công ty CP Vận tải Biển Bạc',
          rangeFrom: '2026-07-01',
          rangeTo: '2026-07-31',
          totalInclVat: '1500000',
          debitNoteStatus: 'SENT',
          originalDueDate: '2026-08-02',
          processingDueDate: '2026-08-03',
        },
      ],
    });

    render(
      <MemoryRouter>
        <PortalDebitNotesPage />
      </MemoryRouter>,
    );

    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/portal/debit-notes?page=1&limit=20'));
    expect(screen.getByText(/Kỳ 1\/7\/2026/)).toBeTruthy();
    expect(screen.getByText('Hạn hợp đồng')).toBeTruthy();
    expect(screen.getByText('02/08/2026')).toBeTruthy();
    expect(screen.getByText('Ngày xử lý')).toBeTruthy();
    expect(screen.getByText('03/08/2026')).toBeTruthy();
    expect(screen.getByText('Giá trị trong trang')).toBeTruthy();
  });

  it('confirms only through the row-scoped portal action', async () => {
    apiGet.mockResolvedValue({
      items: [{
        id: 9,
        version: 1,
        entityName: 'Khách hàng A',
        rangeFrom: '2026-07-01',
        rangeTo: '2026-07-31',
        totalInclVat: 1500000,
        debitNoteStatus: 'PENDING_CONFIRM',
      }],
    });
    apiPost.mockResolvedValue({
      id: 9,
      rangeFrom: '2026-07-01',
      rangeTo: '2026-07-31',
      totalInclVat: 1500000,
      debitNoteStatus: 'CONFIRMED',
    });
    render(<MemoryRouter><PortalDebitNotesPage /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: /Xác nhận/ }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(dialog.querySelector('.btn--primary')!);

    await waitFor(() => expect(apiPost).toHaveBeenCalledWith(
      '/portal/debit-notes/9/confirm',
      { expectedVersion: 1 },
      { headers: { 'Idempotency-Key': expect.any(String) } },
    ));
    expect(await screen.findByText('Đã xác nhận')).toBeTruthy();
  });

  it('binds debit-note actions to the selected legal entity', async () => {
    apiGet.mockImplementation(async (path: string) => {
      if (path === '/portal/customer-scope') {
        return {
          primaryCustomerId: 9,
          customers: [
            { id: 7, name: 'SilverSea Miền Nam' },
            { id: 9, name: 'SilverSea Miền Bắc' },
          ],
        };
      }
      return {
        items: [{
          id: 19,
          version: 1,
          entityName: 'SilverSea Miền Bắc',
          rangeFrom: '2026-07-01',
          rangeTo: '2026-07-31',
          totalInclVat: 1500000,
          debitNoteStatus: 'PENDING_CONFIRM',
        }],
        total: 1,
      };
    });
    apiPost.mockResolvedValue({
      id: 19,
      rangeFrom: '2026-07-01',
      rangeTo: '2026-07-31',
      totalInclVat: 1500000,
      debitNoteStatus: 'CONFIRMED',
    });
    render(
      <MemoryRouter>
        <CustomerPortalScopeProvider>
          <PortalDebitNotesPage />
        </CustomerPortalScopeProvider>
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByRole('button', { name: /Xác nhận/ }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(dialog.querySelector('.btn--primary')!);

    await waitFor(() => {
      expect(apiPost).toHaveBeenCalledWith(
        '/portal/debit-notes/19/confirm?customerId=9',
        { expectedVersion: 1 },
        { headers: { 'Idempotency-Key': expect.any(String) } },
      );
    });
  });

  it('loads the customer statement without accepting a customer id from the browser', async () => {
    apiGet.mockResolvedValue({
      customer: { id: 3, name: 'Khách hàng A', contactInfo: null },
      ledgerRows: [],
      agingBuckets: [],
      totalOutstanding: 1250000,
      unpaidTrips: [{
        tripId: 41,
        date: '2026-07-03',
        outstanding: 1250000,
        note: 'Doanh thu chuyến TT-0041',
        originalDueDate: '2026-08-02',
        processingDueDate: '2026-08-03',
        dueDateAdjusted: true,
      }],
    });

    render(<MemoryRouter><PortalStatementPage /></MemoryRouter>);

    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/portal/statement'));
    expect(screen.getAllByText('1.250.000 ₫')).toHaveLength(3);
    const equation = screen.getByLabelText(/Số dư đầu kỳ 0 đồng/);
    expect(equation.textContent).toContain('Số dư đầu kỳ');
    expect(equation.textContent).toContain('Số dư cuối kỳ');
    expect(screen.getByText('Ngày theo hợp đồng')).toBeTruthy();
    expect(screen.getByText('02/08/2026')).toBeTruthy();
    expect(screen.getByText('03/08/2026')).toBeTruthy();
    expect(screen.getByText('Đã chuyển sang ngày làm việc tiếp theo')).toBeTruthy();
  });

  it('downloads statement PDF bytes and shows a visible export error on failure', async () => {
    apiGet.mockResolvedValue({
      customer: { id: 3, name: 'Khách hàng A', contactInfo: null },
      ledgerRows: [],
      agingBuckets: [],
      totalOutstanding: 0,
      unpaidTrips: [],
    });
    apiGetBlob.mockRejectedValue(new Error('network'));

    render(<MemoryRouter><PortalStatementPage /></MemoryRouter>);
    const pdfButton = await screen.findByRole('button', { name: 'PDF' });
    await waitFor(() => expect((pdfButton as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(pdfButton);

    await waitFor(() => expect(apiGetBlob).toHaveBeenCalledWith('/portal/statement/export?format=pdf'));
    expect(await screen.findByText('Không thể xuất sao kê. Vui lòng thử lại.')).toBeTruthy();
    expect(screen.getByLabelText(/Số dư đầu kỳ 0 đồng/)).toBeTruthy();
  });
  it('does not present failed statement reads as zero debt and provides an explicit retry', async () => {
    apiGet.mockRejectedValueOnce(new Error('Unavailable'));
    render(<MemoryRouter><PortalStatementPage /></MemoryRouter>);
    await screen.findByRole('alert');
    expect(screen.getByLabelText('Số dư công nợ hiện tại').textContent).toContain('—');
    expect(screen.getByRole('button', { name: 'XLSX' })).toBeDisabled();
    apiGet.mockResolvedValue({ customer: { id: 3, name: 'Khách A' }, totalOutstanding: 1250000, ledgerRows: [], unpaidTrips: [], agingBuckets: [] });
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại sao kê' }));
    await waitFor(() => expect(screen.getByLabelText('Số dư công nợ hiện tại').textContent).toContain('1.250.000'));
    expect(apiGet).toHaveBeenLastCalledWith('/portal/statement');
  });

  it('disables export while a new applied statement period is still loading', async () => {
    apiGet.mockResolvedValueOnce({ customer: { id: 3, name: 'Khách A' }, totalOutstanding: 1250000, ledgerRows: [], unpaidTrips: [], agingBuckets: [] });
    render(<MemoryRouter><PortalStatementPage /></MemoryRouter>);
    await waitFor(() => expect(screen.getByRole('button', { name: 'XLSX' })).toBeEnabled());
    apiGet.mockReturnValue(new Promise(() => undefined));
    fireEvent.click(screen.getByRole('button', { name: 'Áp dụng kỳ' }));
    await screen.findByText('Đang tải sao kê…');
    expect(screen.getByRole('button', { name: 'XLSX' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'PDF' })).toBeDisabled();
    expect(screen.getByLabelText('Số dư công nợ hiện tại').textContent).toContain('—');
  });

  it('clears a canceled debit dispute before opening another document', async () => {
    apiGet.mockResolvedValue({ items: [1, 2].map(id => ({ id, version: 1, entityName: 'Khách A', rangeFrom: '2026-09-01', rangeTo: '2026-09-30', totalInclVat: 1500000, debitNoteStatus: 'PENDING_CONFIRM' })), total: 2 });
    render(<MemoryRouter><PortalDebitNotesPage /></MemoryRouter>);
    const actions = await screen.findAllByRole('button', { name: 'Phản hồi' });
    fireEvent.click(actions[0]);
    fireEvent.change(screen.getByLabelText('Lý do phản hồi'), { target: { value: 'Dành riêng cho tài liệu đầu tiên' } });
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Hủy' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    fireEvent.click(actions[1]);
    expect(screen.getByLabelText('Lý do phản hồi')).toHaveValue('');
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Gửi phản hồi' })).toBeDisabled();
  });

  it('shows a debit mutation failure inside the active dialog while retaining its reason', async () => {
    apiGet.mockResolvedValue({ items: [{ id: 1, version: 1, entityName: 'Khách A', rangeFrom: '2026-09-01', rangeTo: '2026-09-30', totalInclVat: 1500000, debitNoteStatus: 'PENDING_CONFIRM' }], total: 1 });
    apiPost.mockRejectedValue(new Error('Máy chủ không nhận được phản hồi'));
    render(<MemoryRouter><PortalDebitNotesPage /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: 'Phản hồi' }));
    fireEvent.change(screen.getByLabelText('Lý do phản hồi'), { target: { value: 'Kiểm tra lại số tiền' } });
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Gửi phản hồi' }));
    expect(await within(screen.getByRole('dialog')).findByRole('alert')).toHaveTextContent('Máy chủ không nhận được phản hồi');
    expect(screen.getByLabelText('Lý do phản hồi')).toHaveValue('Kiểm tra lại số tiền');
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Gửi phản hồi' })).toBeEnabled();
  });

});
