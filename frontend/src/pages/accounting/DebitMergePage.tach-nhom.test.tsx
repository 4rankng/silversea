/**
 * SIL-1142 (QA R4, 8 places × 3 roles) — the Ghép bộ Debit screen
 * (/accounting/ghep-bo-debit) had NO Tách nhóm / Hủy ghép entry anywhere:
 * the QA ticked a merged (ghép TRẢ ĐV) lot and the toolbar offered only
 * Khóa lô / Chọn Debit / Xuất Debit Note, even though previously closed
 * tickets SIL-191/SIL-407 claimed the affordance existed.
 *
 * Fix: the toolbar carries the SAME shared UnmergeRevGroupAction the
 * chot-debit strip runs (same confirm copy, same POST
 * /shipments/lcl/unmerge-group, same Hoàn tác toast — never a second unmerge
 * path), keyed on the chot-debit single-distinct-group law. A cost-merged
 * lot keys on the wire's costGroupId (its revGroupId is null), which the
 * debit-merge board now emits.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DebitMergeItem } from '@tingting/shared';

const { listMergeBoard, getBootstrap, mergeLclRevGroup, unmergeLclGroup } = vi.hoisted(() => ({
  listMergeBoard: vi.fn(),
  getBootstrap: vi.fn(),
  mergeLclRevGroup: vi.fn(),
  unmergeLclGroup: vi.fn(),
}));

vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({ user: { userId: 9, role: 'ACCOUNTANT' } }),
}));

vi.mock('../../api/accountingDebitClient', () => ({
  listSettlementRounds: vi.fn().mockResolvedValue({ items: [] }),
  createSettlementRound: vi.fn(),
  getDebitNoteRoundPreview: vi.fn(),
  DEBIT_SETTLEMENT_ROUNDS_KEY: ['accounting-debit-settlement-rounds'],
}));
vi.mock('../../api/shipmentDebit', () => ({
  listDebitMergeBoard: listMergeBoard,
  debitMergeKeys: {
    all: ['accounting-debit-merge'] as const,
    board: (team: boolean) => ['accounting-debit-merge', 'board', team] as const,
  },
  createDebitNoteBatch: vi.fn(),
  lockShipmentCost: vi.fn(),
  unlockShipmentCost: vi.fn(),
}));
vi.mock('../../api/tripClient', () => ({
  tripClient: { getBootstrap },
}));
vi.mock('../../api/dispatchPlanningClient', () => ({
  updateLclTruck: vi.fn(),
  mergeLclRevGroup,
  unmergeLclGroup,
}));

import DebitMergePage from './DebitMergePage';
import { ToastProvider } from '../../components/shared/Toast';

const row = (over: Partial<DebitMergeItem> & Pick<DebitMergeItem, 'shipmentId'>): DebitMergeItem => ({
  code: null,
  customerId: 11,
  customerName: 'Long Minh',
  factoryName: null,
  routeName: null,
  deliveryDate: null,
  billOrBookNumber: null,
  creatorName: null,
  creatorCode: null,
  containers: [],
  revenue: { cuoc: null, lachHuyen: null, phuPhi: null, phatSinh: null, tong: null },
  chiHo: { csht: [], lift: [], drop: [], other: [] },
  noInvoice: { gnFee: null, gnPaid: null, psFee: null, psPaid: null, fees: [] },
  control: { tongTc: null, lockStatus: 'OPEN', lockedAt: null },
  ...over,
});

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/accounting/ghep-bo-debit']}>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ToastProvider>
          <DebitMergePage />
        </ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

const tickLot = (bill: string) => {
  fireEvent.click(screen.getByRole('checkbox', { name: `Chọn lô ${bill}` }));
};

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  getBootstrap.mockResolvedValue({ customers: [], trucks: [] });
  unmergeLclGroup.mockResolvedValue({ dimension: 'COST', groupId: 'g-cost-1', memberCount: 2, members: [], dissolved: true });
});

describe('SIL-1142 — Tách nhóm / Hủy ghép trên Ghép bộ Debit', () => {
  it('QA repro: tick một lô ghép TRẢ ĐV → toolbar có nút "Tách nhóm" armed, đúng nhóm COST', async () => {
    listMergeBoard.mockResolvedValue({
      items: [row({ shipmentId: 629, billOrBookNumber: 'QBOBD39C', cargoMode: 'LCL', costGroupId: 'g-cost-1' })],
      total: 1,
    });
    renderPage();
    await screen.findByText('QBOBD39C');
    tickLot('QBOBD39C');

    const button = screen.getByRole('button', { name: 'Tách nhóm ghép trả ĐV — lô QBOBD39C' });
    expect(button.tagName).toBe('BUTTON');
    expect(button.getAttribute('aria-disabled')).toBeNull();
    expect(button.hasAttribute('disabled')).toBe(false);
  });

  it('click → dialog confirm chung → unmergeLclGroup({groupId, dimension: COST}) và bảng tải lại', async () => {
    listMergeBoard.mockResolvedValue({
      items: [row({ shipmentId: 629, billOrBookNumber: 'QBOBD39C', cargoMode: 'LCL', costGroupId: 'g-cost-1' })],
      total: 1,
    });
    renderPage();
    await screen.findByText('QBOBD39C');
    tickLot('QBOBD39C');

    fireEvent.click(screen.getByRole('button', { name: 'Tách nhóm ghép trả ĐV — lô QBOBD39C' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('Mỗi lô trở về cước trả ĐV độc lập');

    fireEvent.click(screen.getAllByRole('button', { name: 'Tách nhóm' }).at(-1)!);
    await waitFor(() => expect(unmergeLclGroup).toHaveBeenCalledWith({ groupId: 'g-cost-1', dimension: 'COST' }));
    // Same ONE endpoint the chot-debit strip calls — never a second path.
    expect(mergeLclRevGroup).not.toHaveBeenCalled();
    await waitFor(() => expect(listMergeBoard.mock.calls.length).toBeGreaterThanOrEqual(2));
  });

  it('lô ghép cước thu khách (REV) → cùng nút, đúng copy REV', async () => {
    listMergeBoard.mockResolvedValue({
      items: [row({ shipmentId: 2, billOrBookNumber: 'BL-REV-1', cargoMode: 'LCL', revGroupId: 'g-rev-1' })],
      total: 1,
    });
    renderPage();
    await screen.findByText('BL-REV-1');
    tickLot('BL-REV-1');

    const button = screen.getByRole('button', { name: 'Tách nhóm ghép cước thu khách — lô BL-REV-1' });
    expect(button.getAttribute('aria-disabled')).toBeNull();
    fireEvent.click(button);
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('cước thu của từng lô trở về giá trước khi ghép');
  });

  it('chọn lô chưa ghép → nút hiện ở trạng thái từ chối với lý do chọn lô đã ghép', async () => {
    listMergeBoard.mockResolvedValue({
      items: [row({ shipmentId: 3, billOrBookNumber: 'BL-PLAIN' })],
      total: 1,
    });
    renderPage();
    await screen.findByText('BL-PLAIN');
    tickLot('BL-PLAIN');

    const button = screen.getByRole('button', { name: /Tách nhóm/ });
    expect(button.getAttribute('aria-disabled')).toBe('true');
    const describedBy = button.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)?.textContent)
      .toContain('Chọn một lô đã ghép (Ghép cước thu khách hoặc Ghép trả ĐV) để tách nhóm.');
    fireEvent.click(button);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('lựa chọn trải trên HAI nhóm ghép khác nhau → từ chối, không đoán nhóm', async () => {
    listMergeBoard.mockResolvedValue({
      items: [
        row({ shipmentId: 1, billOrBookNumber: 'BL-A', deliveryDate: '2026-11-02', cargoMode: 'LCL', costGroupId: 'g-cost-1' }),
        row({ shipmentId: 2, billOrBookNumber: 'BL-B', deliveryDate: '2026-11-01', cargoMode: 'LCL', costGroupId: 'g-cost-2' }),
      ],
      total: 2,
    });
    renderPage();
    await screen.findByText('BL-A');
    tickLot('BL-A');
    tickLot('BL-B');

    const button = screen.getByRole('button', { name: 'Tách nhóm ghép trả ĐV — lô BL-A, BL-B' });
    expect(button.getAttribute('aria-disabled')).toBe('true');
    const describedBy = button.getAttribute('aria-describedby');
    expect(document.getElementById(describedBy!)?.textContent)
      .toContain('Các lô đang chọn thuộc nhóm ghép khác nhau — bỏ bớt lựa chọn để tách từng nhóm.');
  });

  it('nhóm đã khóa chi phí (Khóa lô) → từ chối tách với đúng lý do', async () => {
    listMergeBoard.mockResolvedValue({
      items: [row({
        shipmentId: 4,
        billOrBookNumber: 'BL-LOCKED',
        cargoMode: 'LCL',
        costGroupId: 'g-cost-1',
        control: { tongTc: '1000', lockStatus: 'LOCKED', lockedAt: '2026-11-20T10:00:00.000Z' },
      })],
      total: 1,
    });
    renderPage();
    await screen.findByText('BL-LOCKED');
    tickLot('BL-LOCKED');

    const button = screen.getByRole('button', { name: 'Tách nhóm ghép trả ĐV — lô BL-LOCKED' });
    expect(button.getAttribute('aria-disabled')).toBe('true');
    const describedBy = button.getAttribute('aria-describedby');
    expect(document.getElementById(describedBy!)?.textContent)
      .toContain('Nhóm ghép đã chốt kế toán — không thể tách nhóm.');
  });
});
