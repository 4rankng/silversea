/**
 * SIL-1073 (K3.104, Layer 2) — the "Nợ chứng từ" screen. Pins: each row
 * carries the business key (Bill/Booking first), the KB status label, the
 * MISSING-document NAMES (the screen's substance — nêu tên tài liệu thiếu),
 * the receiver + actual received date, and the honest empty state.
 */
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ShipmentDocumentSetStatus, type ShipmentDocumentDebtItem } from '@tingting/shared';

const { getShipmentDocumentDebt } = vi.hoisted(() => ({ getShipmentDocumentDebt: vi.fn() }));

vi.mock('../api/shipmentClient', () => ({
  getShipmentDocumentDebt,
}));

import DocumentDebtPage from './DocumentDebtPage';

function makeRow(overrides: Partial<ShipmentDocumentDebtItem>): ShipmentDocumentDebtItem {
  return {
    shipmentId: 1301,
    shipmentCode: null,
    billOrBookNumber: null,
    customerName: null,
    status: ShipmentDocumentSetStatus.MISSING,
    label: 'Còn thiếu',
    missingDocuments: [],
    receiverName: null,
    receivedOn: null,
    changedAt: null,
    changedByName: null,
    ...overrides,
  };
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <DocumentDebtPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  getShipmentDocumentDebt.mockReset();
});

describe('SIL-1073 — màn Nợ chứng từ', () => {
  it('renders the debt rows: business key, status, missing-doc names, receiver + actual date', async () => {
    getShipmentDocumentDebt.mockResolvedValue([
      makeRow({
        shipmentId: 1301,
        billOrBookNumber: 'W5C-K3105-A',
        customerName: 'Long Minh',
        status: ShipmentDocumentSetStatus.MISSING,
        label: 'Còn thiếu',
        missingDocuments: ['Phí nâng/hạ theo vùng — biên lai', 'Biên bản giao nhận (bản gốc)'],
      }),
      makeRow({
        shipmentId: 1221,
        billOrBookNumber: 'QBDP-2511-01',
        customerName: 'Long Minh',
        status: ShipmentDocumentSetStatus.COMPLETE,
        label: 'Đã đủ',
        receiverName: 'chị Lan',
        receivedOn: '2026-11-25',
      }),
    ]);
    renderPage();

    expect(await screen.findByText('W5C-K3105-A')).toBeTruthy();
    expect(screen.getByText('QBDP-2511-01')).toBeTruthy();
    // The missing-document NAMES are on the row — the KB's debt substance.
    expect(screen.getByText('Phí nâng/hạ theo vùng — biên lai, Biên bản giao nhận (bản gốc)')).toBeTruthy();
    expect(screen.getByText('chị Lan')).toBeTruthy();
    expect(screen.getByText('25/11/2026')).toBeTruthy();
    // Both rows link to the lot's review page (where the write lives).
    expect(screen.getAllByRole('link', { name: 'Mở lô' }).length).toBe(2);
  });

  it('a MISSING row with no recorded names says so instead of fabricating a list', async () => {
    getShipmentDocumentDebt.mockResolvedValue([
      makeRow({ shipmentId: 1301, billOrBookNumber: 'W5C-K3105-A', status: ShipmentDocumentSetStatus.MISSING, label: 'Còn thiếu', missingDocuments: [] }),
    ]);
    renderPage();
    expect(await screen.findByText('Chưa ghi nhận danh mục')).toBeTruthy();
  });

  it('an empty debt board reads clean — no rows, no debt', async () => {
    getShipmentDocumentDebt.mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText('Không có lô nào nợ chứng từ.')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });
});
