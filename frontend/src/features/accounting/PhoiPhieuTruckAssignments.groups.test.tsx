// SIL-1043 (KB K6.2) — "Phân công xe cho kế toán phơi phiếu" must READ as the
// rule's groups, not as a bare title: the assigned trucks sit under their
// CURRENT responsible accountant (one group per person, each row swappable),
// and the 'Chưa phân công' group owns its working set with the batch assign.
// The panel is OPEN on load — the staging repro saw "mục chỉ có tiêu đề rồi
// hết" while the API returned 47 unassigned trucks.
//
// Pin: 2 nhóm render + flow gán.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as PhoiPhieuClientModule from '../../api/phoiPhieuClient';

const { listMock, assignBatchMock, assignOneMock } = vi.hoisted(() => ({
  listMock: vi.fn(),
  assignBatchMock: vi.fn(),
  assignOneMock: vi.fn(),
}));

vi.mock('../../api/phoiPhieuClient', async (original) => ({
  ...await original<typeof PhoiPhieuClientModule>(),
  listPhoiPhieuRows: vi.fn(),
  listPhoiPhieuStk: vi.fn(() => Promise.resolve({ items: [] })),
  listPhoiPhieuTruckAssignments: listMock,
  assignPhoiPhieuTruckAccountantsBatch: assignBatchMock,
  assignPhoiPhieuTruckAccountant: assignOneMock,
}));

import { PhoiPhieuTruckAssignments } from './PhoiPhieuTruckAssignments';

const BOARD = {
  assignments: [
    { truckId: 1, plate: '15C-167.31', accountantId: 3, accountantName: 'Nguyễn Thị Mai', version: 2 },
    { truckId: 2, plate: '15H-104.03', accountantId: 4, accountantName: 'Trần Văn Hùng', version: 1 },
    { truckId: 3, plate: '15E-019.80', accountantId: 3, accountantName: 'Nguyễn Thị Mai', version: 5 },
  ],
  unassignedTrucks: [
    { truckId: 11, plate: '29H-209.51' },
    { truckId: 12, plate: '29H-209.49' },
  ],
  accountants: [
    { id: 3, fullName: 'Nguyễn Thị Mai' },
    { id: 4, fullName: 'Trần Văn Hùng' },
  ],
};

function renderBoard() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <PhoiPhieuTruckAssignments />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  listMock.mockResolvedValue(BOARD);
  assignBatchMock.mockResolvedValue({ items: [] });
  assignOneMock.mockResolvedValue({});
});

describe('SIL-1043 — phân công xe cho kế toán phơi phiếu hiện đủ 2 nhóm (KB K6.2)', () => {
  it('the panel is open on load and renders both groups from the wire', async () => {
    renderBoard();
    await screen.findByText('Chưa phân công (2 xe)');
    const details = screen.getByText(/Phân công xe cho kế toán phơi phiếu/).closest('details')!;
    expect(details).toHaveAttribute('open');

    // Nhóm 1 — xe đã phân công, grouped by the CURRENT responsible person.
    const assigned = screen.getByRole('region', { name: 'Xe đã phân công' });
    expect(within(assigned).getByText('Nguyễn Thị Mai (2 xe)')).toBeInTheDocument();
    expect(within(assigned).getByText('Trần Văn Hùng (1 xe)')).toBeInTheDocument();
    expect(within(assigned).getByText('15C-167.31')).toBeInTheDocument();
    expect(within(assigned).getByText('15H-104.03')).toBeInTheDocument();

    // Nhóm 2 — 'Chưa phân công' is its own group with the pickable trucks.
    const unassigned = screen.getByRole('region', { name: 'Chưa phân công' });
    expect(within(unassigned).getByRole('checkbox', { name: 'Chọn xe 29H-209.51' })).toBeInTheDocument();
    expect(within(unassigned).getByRole('checkbox', { name: 'Chọn xe 29H-209.49' })).toBeInTheDocument();
    expect(within(assigned).queryByText('29H-209.51')).not.toBeInTheDocument();
  });

  it('flow gán — a picked unassigned truck goes to the chosen accountant in one call', async () => {
    renderBoard();
    await screen.findByText('Chưa phân công (2 xe)');
    const unassigned = screen.getByRole('region', { name: 'Chưa phân công' });
    fireEvent.click(within(unassigned).getByRole('checkbox', { name: 'Chọn xe 29H-209.51' }));
    fireEvent.click(within(unassigned).getByRole('button', { name: /Kế toán phụ trách cho xe đã chọn/ }));
    fireEvent.click(await screen.findByRole('option', { name: 'Nguyễn Thị Mai' }));
    fireEvent.click(within(unassigned).getByRole('button', { name: 'Phân công 1 xe' }));
    await waitFor(() => expect(assignBatchMock).toHaveBeenCalledTimes(1));
    expect(assignBatchMock.mock.calls[0][0]).toEqual({ accountantId: 3, truckIds: [11] });
  });

  it('flow gán/đổi — an assigned truck swaps to another accountant version-guarded', async () => {
    renderBoard();
    await screen.findByText('Trần Văn Hùng (1 xe)');
    const assigned = screen.getByRole('region', { name: 'Xe đã phân công' });
    const row = within(assigned).getByText('15H-104.03').closest('tr')!;
    fireEvent.click(within(row).getByRole('button', { name: /Kế toán phụ trách 15H-104.03/ }));
    fireEvent.click(await screen.findByRole('option', { name: 'Nguyễn Thị Mai' }));
    fireEvent.click(within(row).getByRole('button', { name: 'Lưu' }));
    await waitFor(() => expect(assignOneMock).toHaveBeenCalledTimes(1));
    expect(assignOneMock.mock.calls[0]).toEqual([2, { accountantId: 3, expectedVersion: 1 }]);
  });
});
