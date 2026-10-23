/**
 * GP-04 (testplan/2026-10-23-gomhang-polish.md) — the "Gộp xe thu khách"
 * server-error path must never be silent: a BE 400 (cross-customer merge, or
 * any refusal) surfaces BOTH inline (`role="alert"`) and as an error toast,
 * the dialog stays open for a retry, and the client-side same-customer gate
 * covers the wire's null-customer lots BEFORE any request leaves (the BE law
 * `findRevCustomerConflict` treats "Chưa có khách hàng" as a conflict).
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mergeRevMock = vi.hoisted(() => vi.fn());
const toastMock = vi.hoisted(() => vi.fn());
vi.mock('../../../api/dispatchPlanningClient', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  mergeLclRevGroup: mergeRevMock,
}));
vi.mock('../../../components/shared/Toast', () => ({
  useToast: () => ({ toast: toastMock, dismiss: vi.fn() }),
}));
const truckClasses = [
  { id: 7, code: '3.5T', name: 'Xe 3.5 tấn', isContainer: false, sortOrder: 2, deletedAt: null },
];
vi.mock('../../../hooks/useCatalogQueries', () => ({
  useVehicleSizeClasses: () => ({ data: truckClasses, isLoading: false }),
}));

import { MergeRevGroupDialog, type MergeRevGroupLot } from './MergeRevGroupDialog';
import { ApiError } from '../../../lib/api';

const lot = (over: Partial<MergeRevGroupLot> = {}): MergeRevGroupLot => ({
  shipmentId: 101,
  customerId: 1,
  customerName: 'KH A',
  code: 'SHP-26-0001',
  billOrBookNumber: 'BL-1',
  customsNumber: null,
  ...over,
});

function renderDialog(rows: MergeRevGroupLot[]) {
  const onClose = vi.fn();
  const onMerged = vi.fn();
  render(
    <MergeRevGroupDialog rows={rows} plateOptions={[]} onClose={onClose} onMerged={onMerged} />,
  );
  return { onClose, onMerged };
}

async function pickClassAndSubmit() {
  const dialog = await screen.findByRole('dialog');
  const combo = within(dialog).getAllByRole('combobox')[0]!;
  fireEvent.focusIn(combo);
  fireEvent.click(combo);
  fireEvent.change(combo, { target: { value: '3.5' } });
  const option = await screen.findByRole('option', {}, { timeout: 3000 });
  fireEvent.click(option);
  fireEvent.click(within(dialog).getByRole('button', { name: 'Gộp xe thu khách' }));
}

describe('GP-04 — merge server-error path is never silent', () => {
  beforeEach(() => {
    mergeRevMock.mockReset();
    toastMock.mockReset();
  });

  it('BE 400 (khác KH) → inline alert + error toast, dialog stays open for a retry', async () => {
    const serverMessage = 'Chỉ cho phép ghép các lô của cùng một khách hàng (CÙNG 1 KHÁCH HÀNG) — phát hiện xung đột: Lô BL-1 (Khách hàng: KH A), Lô BL-2 (Khách hàng: KH B)';
    // The wire carried stale customerIds (gate passed), the server refused.
    mergeRevMock.mockRejectedValue(new ApiError(400, { error: serverMessage }, serverMessage));
    const { onClose, onMerged } = renderDialog([lot(), lot({ shipmentId: 102, billOrBookNumber: 'BL-2', code: 'SHP-26-0002' })]);

    await pickClassAndSubmit();

    await waitFor(() => expect(mergeRevMock).toHaveBeenCalledTimes(1));
    // BOTH surfaces: the inline alert and the error toast — never silence.
    expect(await screen.findByRole('alert')).toHaveTextContent(serverMessage);
    expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'error',
      message: expect.stringContaining('cùng một khách hàng'),
    }));
    expect(onMerged).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();

    // The dialog is still usable: a corrected retry goes through and closes it.
    mergeRevMock.mockResolvedValue({ groupId: 'g', memberCount: 2, members: [] });
    fireEvent.click(screen.getByRole('button', { name: 'Gộp xe thu khách' }));
    await waitFor(() => expect(onMerged).toHaveBeenCalledTimes(1));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('khách hàng null (wire thiếu customerId) bị gate chặn TRƯỚC khi gọi API', async () => {
    const { onMerged } = renderDialog([
      lot({ customerId: null }),
      lot({ shipmentId: 102, billOrBookNumber: 'BL-2', code: 'SHP-26-0002', customerId: null }),
    ]);

    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/cùng một khách hàng/);
    // The submit refuses locally — no request may leave for a merge the
    // server would 400 (BE law: a lot with no customer is a conflict).
    fireEvent.click(within(dialog).getByRole('button', { name: 'Gộp xe thu khách' }));
    expect(mergeRevMock).not.toHaveBeenCalled();
    expect(onMerged).not.toHaveBeenCalled();
  });

  it('hai khách hàng khác nhau bị gate chặn trước khi gọi API', async () => {
    const { onMerged } = renderDialog([
      lot(),
      lot({ shipmentId: 103, billOrBookNumber: 'BL-3', code: 'SHP-26-0003', customerId: 2 }),
    ]);
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('thuộc 2 khách hàng khác nhau');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Gộp xe thu khách' }));
    expect(mergeRevMock).not.toHaveBeenCalled();
    expect(onMerged).not.toHaveBeenCalled();
  });

  it('lộn lô customerId null vào chọn lọc (kể cả lô null) bị gate chặn với đúng thông báo thiếu KH', async () => {
    const { onMerged } = renderDialog([
      lot(),
      lot({ shipmentId: 104, billOrBookNumber: 'BL-4', code: 'SHP-26-0004', customerId: null }),
    ]);
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('có lô chưa xác định khách hàng');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Gộp xe thu khách' }));
    expect(mergeRevMock).not.toHaveBeenCalled();
    expect(onMerged).not.toHaveBeenCalled();
  });
});
