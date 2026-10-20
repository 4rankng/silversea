/**
 * Card 211026024348 (FB-093 follow-up) — "Tách nhóm" for a merged rev group
 * (Ghép cước thu khách) on Chi phí - Quyết toán. QA: after the merge
 * (Lô 1 = 100% CƯỚC VẬN TẢI AUTO, Lô 2..N = 0₫ + "Ghép xe cùng Bill [Lô 1]")
 * there was NO path to split the group again.
 *
 * Pinned through the REAL page:
 *  - every merged row (principal + members) carries a real <button> named
 *    after its lot — aria-disabled + aria-describedby reason when the group
 *    is settled (the DisabledActionTip law; NEVER the `disabled` attribute),
 *    and the handler guards the click;
 *  - the click flow "2 lô merge → tách → tiền về": confirm on the SHARED
 *    dialog fires the EXISTING `unmergeLclGroup({ dimension: 'REV' })` and the
 *    refetched rows show each lot's pre-merge cước with the "Ghép cước cùng
 *    Bill" note shed;
 *  - promote-on-unmerge (FB-095) stays covered on the same surface: "Hủy ghép"
 *    of the principal names the Bill that inherits 100% of the cước thu.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getBootstrap, listSummary, unmergeGroup, unmergeLot } = vi.hoisted(() => ({
  getBootstrap: vi.fn(),
  listSummary: vi.fn(),
  unmergeGroup: vi.fn(),
  unmergeLot: vi.fn(),
}));
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: { role: 'CUS' } }) }));
vi.mock('../api/tripClient', () => ({ tripClient: { getBootstrap } }));
vi.mock('../api/shipmentClient', async (importOriginal) => ({
  ...await importOriginal<typeof import('../api/shipmentClient')>(),
  listShipmentDebitSummary: listSummary,
  getShipmentDebitDetail: vi.fn(),
}));
vi.mock('../api/shipmentDebit', () => ({
  createDebitNoteBatch: vi.fn(),
  exportDebitNoteFile: vi.fn(),
}));
vi.mock('../api/dispatchPlanningClient', async (importOriginal) => ({
  ...await importOriginal<typeof import('../api/dispatchPlanningClient')>(),
  unmergeLclGroup: unmergeGroup,
  unmergeLclLot: unmergeLot,
}));
const truckClasses = [
  { id: 5, code: '3.5T', name: 'Xe 3.5 tấn', isContainer: false, sortOrder: 1, deletedAt: null },
];
vi.mock('../hooks/useCatalogQueries', () => ({
  useVehicleSizeClasses: () => ({ data: truckClasses, isLoading: false }),
  useTrucksAndDrivers: () => ({ data: { trucks: [], drivers: [] }, isLoading: false }),
}));

import { ToastProvider } from '../components/shared/Toast';
import { ShipmentDebitPage } from './ShipmentDebitPage';
import { formatMoney } from '../lib/format';
import type { ShipmentDebitLotRow } from '../api/shipmentClient';

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/shipments-debit?customer=1']} initialIndex={0}>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ToastProvider>
          <ShipmentDebitPage />
        </ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

const lclRow = (over: Partial<ShipmentDebitLotRow> = {}): ShipmentDebitLotRow => ({
  shipmentId: 101,
  code: 'SHP-26-0001',
  customerId: over.customerId ?? 1,
  customerName: 'KH A',
  factoryName: null,
  factoryAddress: null,
  billOrBookNumber: 'BL-1',
  customsNumber: null,
  documentsSummary: null,
  freightAuto: null,
  freightOverrideReason: null,
  chiHoTotal: null,
  receivableTotal: null,
  payableTotal: null,
  profit: null,
  lockStatus: 'OPEN',
  lockedAt: null,
  cargoMode: 'LCL',
  costGroupId: null,
  costGroupOrder: null,
  revGroupId: null,
  revGroupOrder: null,
  costGroupMemberCount: null,
  revGroupMemberCount: null,
  actualTruckNo: null,
  billingTruckNo: null,
  costVehicleClassCode: null,
  revVehicleClassCode: null,
  revGroupPrincipalRef: null,
  costGroupPrincipalRef: null,
  ...over,
} as ShipmentDebitLotRow);

const summaryOf = (items: ShipmentDebitLotRow[]) => ({
  items,
  total: items.length,
  excludedCount: 0,
  excludedSum: '0',
  excludedTrips: [],
});

/** The card's own QA state: Lô 1 = 100% CƯỚC VẬN TẢI AUTO, Lô 2 = 0₫ + note. */
const mergedPair = () => summaryOf([
  lclRow({
    billOrBookNumber: 'BL-1',
    freightAuto: 3150000,
    revGroupId: 'g-rev-1',
    revGroupOrder: 1,
    revGroupMemberCount: 2,
  }),
  lclRow({
    shipmentId: 102,
    code: 'SHP-26-0002',
    billOrBookNumber: 'BL-2',
    freightAuto: 0,
    freightOverrideReason: 'Ghép cước cùng Bill BL-1',
    revGroupId: 'g-rev-1',
    revGroupOrder: 2,
    revGroupMemberCount: 2,
    revGroupPrincipalRef: 'BL-1',
  }),
]);

/** Pre-merge face the server restores on tách nhóm (restoreRevPreMergeMoney). */
const unmergedPair = () => summaryOf([
  lclRow({ billOrBookNumber: 'BL-1', freightAuto: 3150000 }),
  lclRow({
    shipmentId: 102,
    code: 'SHP-26-0002',
    billOrBookNumber: 'BL-2',
    freightAuto: 700000,
  }),
]);

beforeEach(() => {
  sessionStorage.clear();
  getBootstrap.mockReset();
  listSummary.mockReset();
  unmergeGroup.mockReset();
  unmergeLot.mockReset();
  getBootstrap.mockResolvedValue({ customers: [{ id: 1, name: 'KH A' }], trucks: [] });
  listSummary.mockResolvedValue(mergedPair());
});

describe('card 211026024348 — nút "Tách nhóm" cho nhóm Ghép cước thu khách', () => {
  it('mỗi dòng trong nhóm mang <button> thật "Tách nhóm", aria nêu lô; dòng thường thì không', async () => {
    listSummary.mockResolvedValue(summaryOf([
      ...mergedPair().items,
      lclRow({ shipmentId: 103, code: 'SHP-26-0003', billOrBookNumber: 'BL-3', freightAuto: 900000 }),
    ]));
    renderPage();
    await screen.findAllByText('BL-1');

    const principal = screen.getByRole('button', { name: 'Tách nhóm ghép cước thu khách — lô BL-1' });
    const member = screen.getByRole('button', { name: 'Tách nhóm ghép cước thu khách — lô BL-2' });
    expect(principal.tagName).toBe('BUTTON');
    expect(member.getAttribute('type')).toBe('button');
    // A lot outside a rev group has no action at all.
    expect(screen.queryByRole('button', { name: 'Tách nhóm ghép cước thu khách — lô BL-3' })).toBeNull();
    // Ungated: no aria-disabled, no description.
    expect(principal.getAttribute('aria-disabled')).toBeNull();
    expect(principal.getAttribute('aria-describedby')).toBeNull();
  });

  it('nhóm đã chốt kế toán: aria-disabled + lý do qua aria-describedby, click bị guard (không mở dialog)', async () => {
    listSummary.mockResolvedValue(summaryOf([lclRow({
      billOrBookNumber: 'BL-1',
      freightAuto: 3150000,
      lockStatus: 'LOCKED',
      lockedAt: '2026-10-20T10:00:00.000Z',
      revGroupId: 'g-rev-1',
      revGroupOrder: 1,
      revGroupMemberCount: 2,
    })]));
    renderPage();
    await screen.findAllByText('BL-1');

    const button = screen.getByRole('button', { name: 'Tách nhóm ghép cước thu khách — lô BL-1' });
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.hasAttribute('disabled')).toBe(false);
    const describedBy = button.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)?.textContent)
      .toContain('Nhóm ghép đã chốt kế toán — không thể tách nhóm.');

    fireEvent.click(button);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('click flow: 2 lô merge → Tách nhóm → tiền về lại từng lô, ghi chú ghép được dọn', async () => {
    listSummary.mockResolvedValueOnce(mergedPair()).mockResolvedValueOnce(unmergedPair());
    renderPage();
    await screen.findAllByText('BL-2');
    // Pre-tách face: Lô 1 = 100% CƯỚC VẬN TẢI (AUTO), Lô 2 = 0₫ + the note QA read.
    expect(screen.getByText('Ghép cước cùng Bill BL-1')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Tách nhóm ghép cước thu khách — lô BL-2' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('trở về đúng trạng thái trước ghép');

    unmergeGroup.mockResolvedValue({
      dimension: 'REV',
      groupId: 'g-rev-1',
      memberCount: 2,
      members: [
        { shipmentId: 101, order: 1, reference: 'BL-1' },
        { shipmentId: 102, order: 2, reference: 'BL-2' },
      ],
      dissolved: true,
    });
    // The strip-less dialog confirm shares the pill's text — the LAST match
    // once the dialog is open is the confirm.
    fireEvent.click(screen.getAllByRole('button', { name: 'Tách nhóm' }).at(-1)!);

    await waitFor(() => expect(unmergeGroup).toHaveBeenCalledWith({ groupId: 'g-rev-1', dimension: 'REV' }));
    // The refetch (onUnmerged) re-reads the board: each lot's own cước is back.
    await waitFor(() => expect(listSummary.mock.calls.length).toBeGreaterThanOrEqual(2));
    expect(await screen.findByText(formatMoney(700000))).toBeTruthy();
    expect(screen.getByText(formatMoney(3150000))).toBeTruthy();
    expect(screen.queryByText(/Ghép cước cùng Bill/)).toBeNull();
  });

  it('cover promote-on-unmerge (FB-095): Hủy ghép Lô 1 → toast nêu Bill kế vị nhận 100% cước thu khách', async () => {
    listSummary.mockResolvedValue(summaryOf([lclRow({
      billOrBookNumber: 'BL-1',
      freightAuto: 3150000,
      revGroupId: 'g-rev-1',
      revGroupOrder: 1,
      revGroupMemberCount: 2,
    })]));
    renderPage();
    await screen.findAllByText('BL-1');

    // The per-lot exit lives on the expanded strip (FB-095 "Hủy ghép").
    fireEvent.click(screen.getByRole('button', { name: /Mở chi tiết lô BL-1/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Hủy ghép' }));
    expect(screen.getByRole('dialog')).toBeTruthy();

    unmergeLot.mockResolvedValue({
      dimension: 'REV',
      groupId: 'g-rev-1',
      leaver: { shipmentId: 101, order: 1, reference: 'BL-1' },
      promoted: { shipmentId: 102, order: 1, reference: 'BL-2' },
      transferredAmount: '3150000',
      remaining: [],
      dissolved: true,
    });
    const confirm = screen.getAllByRole('button', { name: 'Hủy ghép' }).at(-1)!;
    fireEvent.click(confirm);

    await waitFor(() => expect(unmergeLot).toHaveBeenCalledWith({ shipmentId: 101, dimension: 'REV' }));
    expect(await screen.findByText(/Bill BL-2 nhận 100% cước thu khách/)).toBeTruthy();
  });
});
