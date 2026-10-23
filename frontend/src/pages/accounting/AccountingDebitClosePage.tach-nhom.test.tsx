/**
 * Card 211026024348 (FB-093 follow-up) — the SAME "Tách nhóm" affordance on
 * Kế toán /accounting/chot-debit, which shows merged rev groups
 * ("Ghép cùng Bill X") and had no path back either. One shared
 * `UnmergeRevGroupAction` (and one existing unmerge endpoint) for both
 * settlement boards — no duplicate dialog, no second unmerge path.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { listBoard, listRounds, getBootstrap, mergeLclRevGroup, unmergeLclGroup, listVehicleSizeClasses } = vi.hoisted(() => ({
  listBoard: vi.fn(),
  listRounds: vi.fn(),
  getBootstrap: vi.fn(),
  mergeLclRevGroup: vi.fn(),
  unmergeLclGroup: vi.fn(),
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
  updateLclTruck: vi.fn(),
  mergeLclRevGroup,
  unmergeLclGroup,
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

type RowLcl = NonNullable<AccountingDebitBoardRow['lcl']>;

const defaultLcl: RowLcl = {
  label: 'Lẻ · Thu: 5T',
  actualTruckNo: '29C-111.11',
  billingTruckNo: '30C-999.99',
  ghépCùngRef: null,
  revGroupId: 'g-rev-1',
};

const lclRow = (
  over: Partial<Omit<AccountingDebitBoardRow, 'lcl'>> & { lcl?: Partial<RowLcl> | null } = {},
): AccountingDebitBoardRow => {
  const { lcl, ...rest } = over;
  return {
    shipmentId: 1,
    code: 'SHP-26-0001',
    customerName: 'LONG MINH',
    customerId: 11,
    carrierKeys: [],
    ngay: '2026-10-19',
    billOrBooking: 'BL-1',
    containers: [],
    phanXe: ['Nhà xe Gaya'],
    thu: { cuocThu: '3150000', lachHuyen: '90000', phuPs: '200000', phatSinhCus: '500000', tongThu: '3890000' },
    tra: { cuocTraDv: '400000', lachHuyenDv: '50000', phatSinhDv: '30000', tong1: '480000', phiRu: '150000' },
    loiNhuan: '3260000',
    ghiChu: null,
    adjustment: { status: 'NONE', requestId: null, requestedAt: null, confirmedAt: null },
    costLockedAt: null,
    ...rest,
    lcl: lcl === null ? null : { ...defaultLcl, ...(lcl ?? {}) },
  };
};

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  localStorage.setItem('accounting-debit-hidden-cols', '[]');
  listRounds.mockResolvedValue({ items: [] });
  getBootstrap.mockResolvedValue({ trucks: [{ licensePlate: '51G-888.88' }] });
  listVehicleSizeClasses.mockReturnValue([]);
  listBoard.mockResolvedValue({ items: [lclRow()], total: 1 });
});

describe('card 211026024348 — "Tách nhóm" trên /accounting/chot-debit', () => {
  it('máy trạm MỚI (chưa có choice trong localStorage): cột Thông số container tự hiện khi có dữ liệu lcl → nút "Tách nhóm" vẫn thấy (FB-093 re-verify)', async () => {
    // Simulate a FRESH workstation: no stored column choice — the KT4
    // essential default applies. The container column carries the required
    // action, so it must show itself once lcl data exists (essentialWhenHasData).
    localStorage.removeItem('accounting-debit-hidden-cols');
    listBoard.mockResolvedValue({
      items: [lclRow({ lcl: { ghépCùngRef: 'BL-1', revGroupId: 'g-rev-1' } })],
      total: 1,
    });
    renderPage();
    await screen.findAllByText('BL-1');

    expect(screen.getByRole('button', { name: 'Tách nhóm ghép cước thu khách — lô BL-1' })).toBeTruthy();
    // the money-breakdown columns stay hidden on the essential default
    expect(screen.queryByText('Cước thu (tự động)')).toBeNull();
  });

  it('máy trạm CŨ (localStorage cũ chứa cột action): load tự sanitize → nút "Tách nhóm" vẫn thấy, cột thường vẫn theo saved (FB-093 lan 3)', async () => {
    // The reported defect: the workstation's `accounting-debit-hidden-cols`
    // was written BEFORE the container column became essentialWhenHasData, so
    // build 6110af65 still buried the "Tách nhóm" button (the fresh-machine
    // fix above never got a say — a stored choice won wholesale). The read now
    // repairs the payload: required keys drop, ordinary choices still govern,
    // and the sanitized list is written back to storage.
    localStorage.setItem('accounting-debit-hidden-cols', JSON.stringify(['container', 'phanXe']));
    listBoard.mockResolvedValue({
      items: [lclRow({ lcl: { ghépCùngRef: 'BL-1', revGroupId: 'g-rev-1' } })],
      total: 1,
    });
    renderPage();
    await screen.findAllByText('BL-1');

    // the action column is visible again — the button is reachable
    expect(screen.getByRole('button', { name: 'Tách nhóm ghép cước thu khách — lô BL-1' })).toBeTruthy();
    // the ordinary saved choice is still honored — Phân xe stays hidden
    const headers = screen.getAllByRole('columnheader').map((th) => th.textContent ?? '');
    expect(headers).toContain('Thông số container');
    expect(headers).not.toContain('Phân xe');
    // and the stored payload is sanitized on disk, not just in memory
    expect(JSON.parse(localStorage.getItem('accounting-debit-hidden-cols') ?? '[]')).toEqual(['phanXe']);
  });

  it('dòng nhóm ghép mang <button> thật "Tách nhóm" (aria nêu lô); dòng chưa ghép thì không', async () => {
    listBoard.mockResolvedValue({
      items: [
        lclRow({ lcl: { ghépCùngRef: 'BL-1', revGroupId: 'g-rev-1' } }),
        lclRow({ shipmentId: 2, billOrBooking: 'BL-9', lcl: { revGroupId: null } }),
      ],
      total: 2,
    });
    renderPage();
    await screen.findAllByText('BL-1');

    const button = screen.getByRole('button', { name: 'Tách nhóm ghép cước thu khách — lô BL-1' });
    expect(button.tagName).toBe('BUTTON');
    expect(button.getAttribute('aria-disabled')).toBeNull();
    expect(screen.queryByRole('button', { name: /lô BL-9/ })).toBeNull();
  });

  it('lô đã chốt (costLockedAt): aria-disabled + lý do qua aria-describedby, click bị guard', async () => {
    listBoard.mockResolvedValue({
      items: [lclRow({ costLockedAt: '2026-10-20T10:00:00.000Z' })],
      total: 1,
    });
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

  it('click → dialog chung → unmergeLclGroup(REV) và bảng được tải lại', async () => {
    renderPage();
    await screen.findAllByText('BL-1');

    fireEvent.click(screen.getByRole('button', { name: 'Tách nhóm ghép cước thu khách — lô BL-1' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('cước thu của từng lô trở về giá trước khi ghép');

    unmergeLclGroup.mockResolvedValue({
      dimension: 'REV',
      groupId: 'g-rev-1',
      memberCount: 2,
      members: [
        { shipmentId: 1, order: 1, reference: 'BL-1' },
        { shipmentId: 2, order: 2, reference: 'BL-2' },
      ],
      dissolved: true,
    });
    fireEvent.click(screen.getAllByRole('button', { name: 'Tách nhóm' }).at(-1)!);

    await waitFor(() => expect(unmergeLclGroup).toHaveBeenCalledWith({ groupId: 'g-rev-1', dimension: 'REV' }));
    await waitFor(() => expect(listBoard.mock.calls.length).toBeGreaterThanOrEqual(2));
  });
});
