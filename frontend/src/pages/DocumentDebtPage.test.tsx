/**
 * SIL-1073 (K3.104, Layer 2) + SIL-1107 (KB §3.5.4, three layers) — the
 * "Nợ chứng từ" screen. Pins: each row carries the business key
 * (Bill/Booking first), the KB status label, the MISSING-document NAMES (the
 * screen's substance — nêu tên tài liệu thiếu), the receiver + actual received
 * date, and the honest empty state.
 *
 * SIL-1107 adds the THREE independent layers: e-POD (Lớp 1) · bộ hồ sơ chứng
 * từ gốc (Lớp 2) · phiếu phơi (Lớp 3) each in its own column, each naming
 * the documents it still owes, never merged into one state.
 */
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SHIPMENT_DOCUMENT_SET_STATUS_LABELS,
  ShipmentDocumentDebtLayer,
  ShipmentDocumentSetStatus,
  type ShipmentDocumentDebtItem,
  type ShipmentDocumentDebtLayerItem,
} from '@tingting/shared';

const { getShipmentDocumentDebt } = vi.hoisted(() => ({ getShipmentDocumentDebt: vi.fn() }));

vi.mock('../api/shipmentClient', () => ({
  getShipmentDocumentDebt,
}));

import DocumentDebtPage from './DocumentDebtPage';

function layer(over: Partial<ShipmentDocumentDebtLayerItem>): ShipmentDocumentDebtLayerItem {
  return {
    layer: ShipmentDocumentDebtLayer.DOCUMENT_SET,
    label: 'Bộ hồ sơ chứng từ gốc',
    status: 'Còn thiếu',
    ok: false,
    applicable: true,
    missingDocuments: [],
    detail: null,
    ...over,
  };
}

function makeRow(overrides: Partial<ShipmentDocumentDebtItem>): ShipmentDocumentDebtItem {
  const status = overrides.status ?? ShipmentDocumentSetStatus.MISSING;
  const missingDocuments = overrides.missingDocuments ?? [];
  return {
    shipmentId: 1301,
    shipmentCode: null,
    billOrBookNumber: null,
    customerName: null,
    status,
    label: SHIPMENT_DOCUMENT_SET_STATUS_LABELS[status],
    missingDocuments,
    receiverName: null,
    receivedOn: null,
    changedAt: null,
    changedByName: null,
    layers: [
      layer({
        layer: ShipmentDocumentDebtLayer.EPOD,
        label: 'e-POD',
        status: 'Đã lưu',
        ok: true,
      }),
      layer({
        status: SHIPMENT_DOCUMENT_SET_STATUS_LABELS[status],
        ok: status === ShipmentDocumentSetStatus.COMPLETE,
        missingDocuments: missingDocuments.length > 0
          ? missingDocuments
          : (status === ShipmentDocumentSetStatus.COMPLETE ? [] : ['Chưa ghi nhận danh mục']),
      }),
      layer({
        layer: ShipmentDocumentDebtLayer.PHOI,
        label: 'Phiếu phơi',
        status: 'Đã nhận phơi',
        ok: true,
      }),
    ],
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

describe('SIL-1107 — ba lớp trạng thái chứng từ trên màn Nợ chứng từ', () => {
  it('renders the three KB layers in their own columns, each naming what it still owes', async () => {
    getShipmentDocumentDebt.mockResolvedValue([
      makeRow({
        shipmentId: 1301,
        billOrBookNumber: 'W5C-K3105-A',
        layers: [
          layer({
            layer: ShipmentDocumentDebtLayer.EPOD,
            label: 'e-POD',
            status: 'Chưa có',
            missingDocuments: ['Phiếu bãi / phiếu hạ', 'Biên bản giao nhận có ký nhận'],
            detail: '2 tài liệu e-POD chưa lưu trên 1 chuyến',
          }),
          layer({
            status: 'Còn thiếu',
            missingDocuments: ['Biên bản giao nhận (bản gốc)'],
          }),
          layer({
            layer: ShipmentDocumentDebtLayer.PHOI,
            label: 'Phiếu phơi',
            status: 'Chưa nhận phơi',
            missingDocuments: ['Phiếu phơi chuyến TRP-9'],
            detail: 'Chưa nhận phơi 1/1 chuyến',
          }),
        ],
      }),
    ]);
    renderPage();

    expect(await screen.findByText('Lớp 1 · e-POD')).toBeTruthy();
    expect(screen.getByText('Lớp 2 · Bộ hồ sơ chứng từ gốc')).toBeTruthy();
    expect(screen.getByText('Lớp 3 · Phiếu phơi')).toBeTruthy();
    // Each layer names ITS OWN missing documents — never one merged list.
    expect(screen.getByText('Phiếu bãi / phiếu hạ, Biên bản giao nhận có ký nhận')).toBeTruthy();
    expect(screen.getByText('Biên bản giao nhận (bản gốc)')).toBeTruthy();
    expect(screen.getByText('Phiếu phơi chuyến TRP-9')).toBeTruthy();
    expect(screen.getByText('Chưa nhận phơi 1/1 chuyến')).toBeTruthy();
  });

  it('a wire without the breakdown renders each layer as "—" instead of failing', async () => {
    // SIL-1107 — a backend that predates the layers sends no breakdown; the
    // screen must still render (the same law the lot-status block keeps).
    getShipmentDocumentDebt.mockResolvedValue([
      { ...makeRow({ shipmentId: 1301, billOrBookNumber: 'W5C-K3105-A' }), layers: undefined },
    ]);
    renderPage();

    expect(await screen.findByText('W5C-K3105-A')).toBeTruthy();
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
    expect(screen.getAllByRole('link', { name: 'Mở lô' }).length).toBe(1);
  });

  it('a layer that owes nothing ticks; a layer that does not apply to the lot shows no tick', async () => {
    getShipmentDocumentDebt.mockResolvedValue([
      makeRow({
        shipmentId: 1301,
        billOrBookNumber: 'W5C-K3105-A',
        layers: [
          layer({ layer: ShipmentDocumentDebtLayer.EPOD, label: 'e-POD', status: 'Đã lưu', ok: true }),
          layer({ status: 'Đã đủ', ok: true }),
          layer({
            layer: ShipmentDocumentDebtLayer.PHOI,
            label: 'Phiếu phơi',
            status: 'Không có chuyến đi lấy phơi',
            ok: true,
            applicable: false,
          }),
        ],
      }),
    ]);
    renderPage();

    expect(await screen.findByText('Đã lưu')).toBeTruthy();
    expect(screen.getByText('Đã đủ')).toBeTruthy();
    // Two applicable layers owe nothing → two ticks; the phơi layer does not
    // apply to a lot without a trip, so it never claims a false "Đủ".
    expect(screen.getAllByRole('img', { name: 'Đủ' }).length).toBe(2);
    expect(screen.getByText('Không có chuyến đi lấy phơi')).toBeTruthy();
  });
});

// SIL-1264 — below 999px the CSS card band renders each row as a card whose
// every fact is announced by its data-label eyebrow (content: attr(data-label)),
// so the markup law is: every body cell carries a NON-EMPTY data-label key, and
// the row's first cell is the business key (Số Bill/Booking) — the line that
// leads the card. A td that lost its key would render an empty eyebrow on the
// phone card.
describe('SIL-1264 — mobile card band markup keys', () => {
  it('every body cell carries a non-empty data-label, and the bill cell leads each row', async () => {
    getShipmentDocumentDebt.mockResolvedValue([
      makeRow({ shipmentId: 1301, billOrBookNumber: 'W5C-K3105-A', customerName: 'Công ty A' }),
    ]);
    renderPage();

    await screen.findByText('W5C-K3105-A');

    const rows = document.querySelectorAll('tbody tr');
    expect(rows.length).toBe(1);
    const cells = rows[0].querySelectorAll('td');
    expect(cells.length).toBeGreaterThan(0);
    for (const cell of cells) {
      expect(cell.getAttribute('data-label'), 'card eyebrow key').toBeTruthy();
      expect(cell.getAttribute('data-label')!.length).toBeGreaterThan(0);
    }
    expect(cells[0].getAttribute('data-label')).toBe('Số Bill/Booking');
    expect(cells[cells.length - 1].getAttribute('data-label')).toBe('Thao tác');
  });
});
