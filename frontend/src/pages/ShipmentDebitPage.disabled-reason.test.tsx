/**
 * Card 20261008_1 sweep — /shipments-debit action buttons that disabled
 * silently must explain themselves through the aria-described + aria-disabled
 * pattern (see components/shared/DisabledActionTip.tsx, landed by card
 * 081026093510). "Xuất Debit Note" used to sit disabled with only a wrapper
 * `title` when no customer was picked — and no word at all for the other
 * two disable causes.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ShipmentClientModule from '../api/shipmentClient';

const { getBootstrap, listSummary, getDetail, createBatch, exportFile } = vi.hoisted(() => ({ getBootstrap: vi.fn(), listSummary: vi.fn(), getDetail: vi.fn(), createBatch: vi.fn(), exportFile: vi.fn() }));
const { authRole } = vi.hoisted(() => ({ authRole: { value: 'CUS' } }));
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: { role: authRole.value } }) }));
vi.mock('../api/tripClient', () => ({ tripClient: { getBootstrap } }));
vi.mock('../api/shipmentClient', async (importOriginal) => ({
  ...await importOriginal<typeof ShipmentClientModule>(),
  listShipmentDebitSummary: listSummary,
  getShipmentDebitDetail: getDetail,
  createDebitNoteBatch: createBatch,
  exportDebitNoteFile: exportFile,
}));

vi.mock('../api/shipmentDebit', () => ({
  createDebitNoteBatch: createBatch,
  exportDebitNoteFile: exportFile,
}));

import { ToastProvider } from '../components/shared/Toast';
import { ShipmentDebitPage } from './ShipmentDebitPage';
import { ShipmentDebitRibbon } from '../features/shipments/ShipmentDebitRibbon';
import type { ShipmentDebitLotRow } from '../api/shipmentClient';

function renderPage(initialEntry = '/shipments-debit') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]} initialIndex={0}>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ToastProvider>
          <ShipmentDebitPage />
        </ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

const row = (over: Partial<ShipmentDebitLotRow> = {}): ShipmentDebitLotRow => ({
  shipmentId: 101,
  code: 'SHP-26-0001',
  customerName: 'KH A',
  factoryName: 'NM A',
  factoryAddress: 'Bình Dương',
  billOrBookNumber: 'BL-1',
  customsNumber: 'TK-1',
  documentsSummary: '5/6',
  freightAuto: 4_500_000,
  chiHoTotal: 2_000_000,
  receivableTotal: 9_000_000,
  payableTotal: null,
  profit: 2_500_000,
  lockStatus: 'OPEN',
  lockedAt: null,
  ...over,
  customerId: over.customerId ?? 1,
} as ShipmentDebitLotRow);

function reasonOf(button: HTMLElement): string {
  const reasonId = button.getAttribute('aria-describedby');
  expect(reasonId).toBeTruthy();
  return document.getElementById(reasonId!)?.textContent ?? '';
}

beforeEach(() => {
  authRole.value = 'CUS';
  sessionStorage.clear();
  getBootstrap.mockReset();
  listSummary.mockReset();
  getBootstrap.mockResolvedValue({ customers: [{ id: 1, name: 'KH A' }] });
  listSummary.mockResolvedValue({ items: [], total: 0 });
  getDetail.mockReset();
  createBatch.mockReset();
  exportFile.mockReset();
  createBatch.mockResolvedValue({ id: 777 });
  exportFile.mockResolvedValue(new Blob(['x']));
});

describe('ShipmentDebitPage disabled reasons (card 20261008_1 sweep)', () => {
  it('without a customer the export explains the missing customer and stays inert', async () => {
    listSummary.mockResolvedValue({ items: [row({ lockStatus: 'LOCKED' })], total: 1 });
    renderPage();
    await screen.findAllByText('BL-1');

    const button = screen.getByRole('button', { name: 'Xuất Debit Note' });
    expect(button).toHaveAttribute('aria-disabled', 'true');
    // Never the `disabled` attribute: hover + keyboard focus must reach the reason.
    expect(button).not.toBeDisabled();
    expect(reasonOf(button)).toBe('Chọn khách hàng để xuất Debit Note.');
    fireEvent.click(button);
    expect(createBatch).not.toHaveBeenCalled();
  });

  it('with a customer but no locked lot selected it explains the selection prerequisite', async () => {
    listSummary.mockResolvedValue({
      items: [row({ lockStatus: 'OPEN' }), row({ shipmentId: 102, code: 'SHP-26-0002', billOrBookNumber: 'BL-2', lockStatus: 'OPEN' })],
      total: 2,
    });
    renderPage('/shipments-debit?customer=1');
    await screen.findAllByText('BL-1');

    const button = screen.getByRole('button', { name: 'Xuất Debit Note' });
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).not.toBeDisabled();
    expect(reasonOf(button)).toBe('Chọn ít nhất một lô đã khóa để xuất Debit Note.');
    fireEvent.click(button);
    expect(createBatch).not.toHaveBeenCalled();
  });

  it('while an export is in flight the button explains the busy state', async () => {
    // Executor form on purpose: Promise.withResolvers is outside this
    // project's TS lib (TS2550).
    let resolveCreate: (value: { id: number }) => void = () => {};
    createBatch.mockReturnValue(new Promise((resolve) => { resolveCreate = resolve; }));
    listSummary.mockResolvedValue({ items: [row({ lockStatus: 'LOCKED' })], total: 1 });
    renderPage('/shipments-debit?customer=1');
    await screen.findAllByText('BL-1');
    fireEvent.click(screen.getAllByText('BL-1')[0].closest('tr')!);

    const button = screen.getByRole('button', { name: 'Xuất Debit Note' });
    fireEvent.click(button);
    await waitFor(() => expect(createBatch).toHaveBeenCalledTimes(1));

    // The busy reason mounts the DisabledActionTip wrapper, which remounts
    // the button — re-query instead of holding the stale node.
    const busy = screen.getByRole('button', { name: 'Xuất Debit Note' });
    expect(busy).toHaveAttribute('aria-disabled', 'true');
    expect(busy).not.toBeDisabled();
    expect(reasonOf(busy)).toBe('Đang xuất Debit Note…');

    resolveCreate({ id: 777 });
    await waitFor(() => expect(exportFile).toHaveBeenCalledTimes(1));
  });

  it('with a locked lot selected the export is armed (no reason) and fires the batched issue', async () => {
    listSummary.mockResolvedValue({ items: [row({ lockStatus: 'LOCKED' })], total: 1 });
    renderPage('/shipments-debit?customer=1');
    await screen.findAllByText('BL-1');
    fireEvent.click(screen.getAllByText('BL-1')[0].closest('tr')!);

    const button = screen.getByRole('button', { name: 'Xuất Debit Note' });
    expect(button).not.toHaveAttribute('aria-disabled');
    expect(button).not.toHaveAttribute('aria-describedby');
    fireEvent.click(button);
    await waitFor(() => expect(createBatch).toHaveBeenCalledTimes(1));
    expect(createBatch).toHaveBeenCalledWith([101], 'debit-note-101');
  });

  it('Xóa lọc explains the empty-filters disable and clears when a filter is active', () => {
    const onClear = vi.fn();
    const base = {
      onLockChange: vi.fn(),
      onDeliveryRangeChange: vi.fn(),
      onResetSecondary: vi.fn(),
      onClear,
    };
    const wrap = (deliveryFrom: string) => (
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ToastProvider>
          <ShipmentDebitRibbon deliveryFrom={deliveryFrom} deliveryTo="" lockStatus="ALL" {...base} />
        </ToastProvider>
      </QueryClientProvider>
    );
    const view = render(wrap(''));
    const button = screen.getByRole('button', { name: 'Xóa lọc' });
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getAllByText('Chưa có bộ lọc nào để xóa.').length).toBeGreaterThan(0);
    fireEvent.click(button);
    expect(onClear).not.toHaveBeenCalled();

    view.rerender(wrap('2026-10-01'));
    const armed = screen.getByRole('button', { name: 'Xóa lọc' });
    expect(armed).not.toHaveAttribute('aria-disabled');
    fireEvent.click(armed);
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});
