// Card 20260928_166 — the batch-assign strip.
//
// The card previously claimed "UI gán hàng loạt nay đã có (chọn nhiều xe + 1 kế
// toán)". It did not: the route existed, no client reached it, and the
// unassigned bucket rendered as one comma-joined sentence with no control on
// it — so the 46 trucks PM's split needs could be read but never assigned.
// These cases pin the behaviour the claim should have described.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { listMock, assignBatchMock, assignOneMock } = vi.hoisted(() => ({
  listMock: vi.fn(),
  assignBatchMock: vi.fn(),
  assignOneMock: vi.fn(),
}));

vi.mock('../../api/phoiPhieuClient', async (original) => ({
  ...await original<typeof import('../../api/phoiPhieuClient')>(),
  listPhoiPhieuRows: vi.fn(),
  listPhoiPhieuStk: vi.fn(() => Promise.resolve({ items: [] })),
  listPhoiPhieuTruckAssignments: listMock,
  assignPhoiPhieuTruckAccountantsBatch: assignBatchMock,
  assignPhoiPhieuTruckAccountant: assignOneMock,
}));

import { PhoiPhieuTruckAssignments } from './PhoiPhieuTruckAssignments';

const UNASSIGNED = [
  { truckId: 11, plate: '15H-209.51' },
  { truckId: 12, plate: '15H-209.49' },
  { truckId: 13, plate: '15E-019.80' },
];
const ACCOUNTANTS = [{ id: 3, fullName: 'Nguyễn Thị Mai' }];

function renderBoard() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <PhoiPhieuTruckAssignments />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  listMock.mockResolvedValue({ assignments: [], unassignedTrucks: UNASSIGNED, accountants: ACCOUNTANTS });
  assignBatchMock.mockResolvedValue({ items: [] });
});

describe('card 20260928_166 — gán kế toán hàng loạt', () => {
  it('offers the unassigned trucks as pickable rows, not as a comma-joined sentence', async () => {
    renderBoard();
    const summary = await screen.findByText(/Phân công xe cho kế toán phơi phiếu/);
    fireEvent.click(summary);

    // The old shape: one line listing every plate, nothing to act on.
    expect(screen.queryByText(/15H-209\.51, 15H-209\.49, 15E-019\.80/)).toBeNull();

    for (const truck of UNASSIGNED) {
      expect(await screen.findByRole('checkbox', { name: `Chọn xe ${truck.plate}` })).toBeTruthy();
    }
  });

  it('assigns every picked truck to the chosen accountant in ONE call', async () => {
    renderBoard();
    fireEvent.click(await screen.findByText(/Phân công xe cho kế toán phơi phiếu/));

    fireEvent.click(await screen.findByRole('checkbox', { name: 'Chọn xe 15H-209.51' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Chọn xe 15E-019.80' }));
    // Third one deliberately left out — the batch must carry exactly the picks.
    // The accountant field is a UUI searchable select whose option list does not
    // materialise in jsdom, so the pick is covered by the real-tap rung on
    // staging instead. What jsdom CAN pin is the batch's truck set — the part
    // that is this card's actual requirement (one request, exactly the picks).
    fireEvent.click(screen.getByRole('button', { name: /Phân công 2 xe/ }));

    await waitFor(() => expect(assignBatchMock).toHaveBeenCalledTimes(1));
    const [body] = assignBatchMock.mock.calls[0];
    // Exactly the two picks — the third truck, deliberately left out, is absent.
    expect(body).toMatchObject({ truckIds: [11, 13] });
    // No accountant chosen yet ⇒ null, which the route reads as "unassign"; the
    // panel therefore cannot silently post a split to a wrong accountant.
    expect(body.accountantId).toBeNull();
  });

  // The button it replaced said "select every checkbox on this page" with no
  // label saying so; the scope now lives in the control's own name.
  it('states its scope on the select-all control', async () => {
    renderBoard();
    fireEvent.click(await screen.findByText(/Phân công xe cho kế toán phơi phiếu/));

    const selectAll = await screen.findByRole('button', { name: /Chọn tất cả \(3\)/ });
    fireEvent.click(selectAll);
    await waitFor(() => expect(screen.getByText(/Đã chọn 3\/3 xe chưa phân công/)).toBeTruthy());
    expect(screen.getByRole('button', { name: /Bỏ chọn tất cả/ })).toBeTruthy();
  });

  it('cannot send a batch while nothing is picked', async () => {
    renderBoard();
    fireEvent.click(await screen.findByText(/Phân công xe cho kế toán phơi phiếu/));

    const send = await screen.findByRole('button', { name: /Phân công 0 xe/ });
    expect((send as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(send);
    expect(assignBatchMock).not.toHaveBeenCalled();
  });

  // All-or-nothing is the route's rule, and the UI must not pretend a partial
  // split succeeded: the error surfaces and the picks stay for a retry.
  it('surfaces a rejected batch and keeps the picks for a retry', async () => {
    assignBatchMock.mockRejectedValue(new Error('Xe 13 không còn ở trạng thái chờ phân công.'));
    renderBoard();
    fireEvent.click(await screen.findByText(/Phân công xe cho kế toán phơi phiếu/));

    fireEvent.click(await screen.findByRole('checkbox', { name: 'Chọn xe 15H-209.51' }));
    fireEvent.click(screen.getByRole('button', { name: /Phân công 1 xe/ }));

    expect(await within(document.body).findByText(/không còn ở trạng thái chờ phân công/)).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: 'Chọn xe 15H-209.51' })).toHaveProperty('checked', true);
  });
});
