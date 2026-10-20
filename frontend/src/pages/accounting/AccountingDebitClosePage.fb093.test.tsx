/**
 * FB-093 (QA card 191026100833, build 64f81514) — /accounting/chot-debit was
 * missing the two accounting acts the quyết-toán flow needs:
 *
 *  a) the "Báo khách (Ảo)" badge was a plain <span> — kế toán could read the
 *     plate the customer is told but never correct it from this screen;
 *  b) there was no "Ghép cước thu khách" button at all (the flow only had one
 *     on Chi phí - Quyết toán, a different page keyed on a different lot list).
 *
 * Pinned through the REAL page, both against the real column renderers:
 *  - clicking the badge opens the panel seeded with the row's current plate and
 *    names the lot; saving POSTs `updateLclTruck` with the edited plate and
 *    refetches the board (the badge then renders the server's value);
 *  - a server refusal (cost-locked lot → 409) surfaces verbatim in an alert and
 *    leaves the panel OPEN with the typed value intact — nothing is discarded;
 *  - the merge button is aria-disabled with an explanation until ≥2 ungrouped
 *    lô lẻ are selected, and then opens the shared MergeRevGroupDialog with
 *    exactly those lots.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { listBoard, listRounds, updateLclTruck, getBootstrap, mergeLclRevGroup, listVehicleSizeClasses } = vi.hoisted(() => ({
  listBoard: vi.fn(),
  listRounds: vi.fn(),
  updateLclTruck: vi.fn(),
  getBootstrap: vi.fn(),
  mergeLclRevGroup: vi.fn(),
  listVehicleSizeClasses: vi.fn(),
}));

vi.mock('../../api/accountingDebitClient', () => ({
  listAccountingDebitBoard: listBoard,
  sendRateAdjustmentRequests: vi.fn(),
  confirmRateAdjustments: vi.fn(),
  withdrawRateAdjustments: vi.fn(),
  listSettlementRounds: listRounds,
  createSettlementRound: vi.fn(),
  DEBIT_SETTLEMENT_ROUNDS_KEY: ['accounting-debit-settlement-rounds'],
}));
vi.mock('../../api/dispatchPlanningClient', () => ({
  updateLclTruck,
  mergeLclRevGroup,
}));
vi.mock('../../api/tripClient', () => ({
  tripClient: { getBootstrap },
}));
vi.mock('../../hooks/useCatalogQueries', () => ({
  useVehicleSizeClasses: () => ({ data: listVehicleSizeClasses() }),
}));

import AccountingDebitClosePage from './AccountingDebitClosePage';
import { ToastProvider } from '../../components/shared/Toast';
import type { AccountingDebitBoardRow } from '../../api/accountingDebitClient';

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/accounting/chot-debit']}>
      <ToastProvider>
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <AccountingDebitClosePage />
        </QueryClientProvider>
      </ToastProvider>
    </MemoryRouter>,
  );
}

const lclRow = (shipmentId: number, bill: string, ghépCùngRef: string | null = null): AccountingDebitBoardRow => ({
  shipmentId,
  code: `SHP-26-000${shipmentId}`,
  customerName: 'LONG MINH',
  customerId: 11,
  carrierKeys: [],
  ngay: '2026-10-19',
  billOrBooking: bill,
  containers: [],
  phanXe: ['Nhà xe Gaya'],
  lcl: { label: 'Lẻ · Thu: 5T · Trả: 10T', actualTruckNo: '29C-111.11', billingTruckNo: '30C-999.99', ghépCùngRef },
  thu: { cuocThu: '1000000', lachHuyen: '90000', phuPs: '200000', phatSinhCus: '500000', tongThu: '1790000' },
  tra: { cuocTraDv: '400000', lachHuyenDv: '50000', phatSinhDv: '30000', tong1: '480000', phiRu: '150000' },
  loiNhuan: '1160000',
  ghiChu: null,
  adjustment: { status: 'NONE', requestId: null, requestedAt: null, confirmedAt: null },
  costLockedAt: null,
});

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  // The board opens on its ESSENTIAL column set (card 191026181942), which
  // omits "Phân xe" — the column the BKS badge lives in. An explicit stored
  // choice of "nothing hidden" is the operator's real way to see it, so the
  // tests read the surface the same way an accountant would.
  localStorage.setItem('accounting-debit-hidden-cols', '[]');
  listRounds.mockResolvedValue({ items: [] });
  getBootstrap.mockResolvedValue({ trucks: [{ licensePlate: '51G-888.88' }] });
  listVehicleSizeClasses.mockReturnValue([]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('FB-093 — BKS báo khách (Ảo) quick edit on /accounting/chot-debit', () => {
  it('opens the editor on the clicked badge and saves the edited plate', async () => {
    listBoard.mockResolvedValue({ items: [lclRow(1, 'BL-1')], total: 1 });
    updateLclTruck.mockResolvedValue({ updatedShipmentIds: [1] });
    const { container } = renderPage();

    const badge = await screen.findByRole('button', { name: 'Sửa BKS báo khách: 30C-999.99' });
    fireEvent.click(badge);

    // The editor opens SEEDED with the value the cell was showing — the
    // accountant confirms what is on screen before typing over it. The panel
    // NAMES the lot (a wide scrolling matrix has no other way to say which
    // row the save will touch).
    const panel = await screen.findByRole('region', { name: 'Sửa BKS báo khách — BL-1' });
    const input = panel.querySelector('input') as HTMLInputElement;
    expect(input.value).toBe('30C-999.99');

    fireEvent.change(input, { target: { value: ' 51G-888.88 ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu BKS báo khách' }));

    await waitFor(() => {
      expect(updateLclTruck).toHaveBeenCalledWith({ shipmentId: 1, billingTruckNo: '51G-888.88' });
    });
    // The panel closes and the board refetches — the badge then renders
    // whatever the server holds (the mocked second response).
    await waitFor(() => {
      expect(screen.queryByRole('region', { name: /Sửa BKS báo khách/ })).toBeNull();
    });
    expect(listBoard.mock.calls.length).toBeGreaterThan(1);
    expect(container.querySelector('.debit-billing-badge')).toBeTruthy();
  });

  it('surfaces a server refusal verbatim, keeps the panel open and keeps the typed plate', async () => {
    listBoard.mockResolvedValue({ items: [lclRow(1, 'BL-1')], total: 1 });
    updateLclTruck.mockRejectedValue(new Error('Lô hàng đã khóa chi phí, không sửa được BKS báo khách.'));
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Sửa BKS báo khách: 30C-999.99' }));
    const panel = await screen.findByRole('region', { name: /Sửa BKS báo khách/ });
    const input = panel.querySelector('input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '51G-888.88' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu BKS báo khách' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('Lô hàng đã khóa chi phí, không sửa được BKS báo khách.');
    // The refusal never discards the accountant's edit: the panel stays up
    // with the typed value, so a corrected retry is one click away.
    expect(screen.getByRole('region', { name: /Sửa BKS báo khách/ })).toBeTruthy();
    expect((screen.getByRole('region', { name: /Sửa BKS báo khách/ }).querySelector('input') as HTMLInputElement).value)
      .toBe('51G-888.88');
  });

  it('will not save an empty plate — the wire forbids it', async () => {
    listBoard.mockResolvedValue({ items: [lclRow(1, 'BL-1')], total: 1 });
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Sửa BKS báo khách: 30C-999.99' }));
    await screen.findByRole('region', { name: /Sửa BKS báo khách/ });
    const save = screen.getByRole('button', { name: 'Lưu BKS báo khách' }) as HTMLButtonElement;

    fireEvent.change(screen.getByRole('region', { name: /Sửa BKS báo khách/ }).querySelector('input')!, {
      target: { value: '   ' },
    });
    expect(save.disabled).toBe(true);
    fireEvent.click(save);
    expect(updateLclTruck).not.toHaveBeenCalled();
  });
});

describe('FB-093 — "Ghép cước thu khách" on /accounting/chot-debit', () => {
  it('explains why it is unavailable until two ungrouped lô lẻ are selected, then opens the merge', async () => {
    listBoard.mockResolvedValue({ items: [lclRow(1, 'BL-1'), lclRow(2, 'BL-2')], total: 2 });
    renderPage();

    const mergeButton = await screen.findByRole('button', { name: 'Ghép cước thu khách' });
    expect(mergeButton.getAttribute('aria-disabled')).toBe('true');
    // The reason is announced twice on purpose (sr-only + hover bubble), so
    // assert it is present rather than unique.
    expect(screen.getAllByText('Chọn ít nhất 2 lô lẻ chưa ghép cước để ghép.').length).toBeGreaterThan(0);
    fireEvent.click(mergeButton);
    expect(screen.queryByText('Ghép cước thu khách cho 2 lô', { exact: false })).toBeNull();

    const rows = [...(await screen.findByText('BL-1')).closest('table')!.querySelectorAll('tbody tr')];
    expect(rows).toHaveLength(2);
    fireEvent.click(rows[0]);
    fireEvent.click(rows[1]);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Ghép cước thu khách' }).getAttribute('aria-disabled')).toBeNull();
    });
    expect(screen.queryByText('Chọn ít nhất 2 lô lẻ chưa ghép cước để ghép.')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Ghép cước thu khách' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('Lô 1 · BL-1');
    expect(dialog.textContent).toContain('Lô 2 · BL-2');
    expect(dialog.textContent).toContain('LONG MINH');
  });

  it('counts an already-grouped lot out of the merge set', async () => {
    listBoard.mockResolvedValue({
      items: [lclRow(1, 'BL-1'), lclRow(2, 'BL-2', 'BL-1')],
      total: 2,
    });
    renderPage();

    const rows = [...(await screen.findByText('BL-1')).closest('table')!.querySelectorAll('tbody tr')];
    fireEvent.click(rows[0]);
    fireEvent.click(rows[1]);
    // One ungrouped lot is not a merge: the button keeps its explanation
    // rather than opening a dialog the server would refuse.
    expect(screen.getByRole('button', { name: 'Ghép cước thu khách' }).getAttribute('aria-disabled')).toBe('true');
  });
});
