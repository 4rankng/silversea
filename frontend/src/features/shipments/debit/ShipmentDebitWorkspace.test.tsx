import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { shipmentDebitEditPayloadSchema } from '@tingting/shared';
import { Role } from '@tingting/shared';

const { getDetail, saveEdits, lockCost, adjustCost, listAdjustments, useAuthMock } = vi.hoisted(() => ({
  getDetail: vi.fn(),
  saveEdits: vi.fn(),
  lockCost: vi.fn(),
  adjustCost: vi.fn(),
  listAdjustments: vi.fn(),
  useAuthMock: vi.fn(),
}));

vi.mock('../../../api/shipmentClient', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../api/shipmentClient')>(),
  getShipmentDebitDetail: getDetail,
  saveShipmentDebitEdits: saveEdits,
  lockShipmentCost: lockCost,
  adjustShipmentCost: adjustCost,
  listShipmentCostAdjustments: listAdjustments,
}));

vi.mock('../../../hooks/useAuth', () => ({ useAuth: useAuthMock }));

import { ShipmentDebitWorkspace } from './ShipmentDebitWorkspace';
import type { ShipmentDebitDetail } from '../../../api/shipmentClient';

const detail = (over: Partial<ShipmentDebitDetail> = {}): ShipmentDebitDetail => ({
  freightRows: [{
    containerNumber: 'CONT-001',
    containerTypeLabel: '20DC',
    freightCharge: 4500000,
    fuelSurcharge: 300000,
    lachHuyenFee: null,
    customsFee: 250000,
    psActual: null,
    psNotes: null,
  }],
  chiHoRows: [{
    tripId: 601,
    containerNumber: 'CONT-001',
    items: [{ id: 9001, expenseType: 'PS', feeName: 'PS thực tế', amount: 180000, thuKhach: null, note: null }],
    otherFees: [{ id: 9002, name: 'Phí đăng kiểm', amount: 200000 }],
    carrierDetention: 0,
    repairAdvance: null,
    opsDocsStatus: 'READY',
  }],
  payables: { chiHoTotal: 380000 },
  thuKhachTotal: null,
  ...over,
});

function renderWorkspace(props: Partial<{ shipmentId: number; locked: boolean; onSaved: () => void }> = {}) {
  const onSaved = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
      <ShipmentDebitWorkspace shipmentId={101} locked={false} onSaved={onSaved} {...props} />
    </QueryClientProvider>,
  );
  return { onSaved };
}

beforeEach(() => {
  getDetail.mockReset();
  saveEdits.mockReset();
  lockCost.mockReset();
  adjustCost.mockReset();
  listAdjustments.mockReset();
  saveEdits.mockResolvedValue(undefined);
  lockCost.mockResolvedValue(undefined);
  adjustCost.mockResolvedValue(undefined);
  listAdjustments.mockResolvedValue({ items: [] });
  useAuthMock.mockReturnValue({ user: { userId: 3, role: Role.CUS } });
});

describe('Chi phí - Quyết toán L2 workspace (20260918_18/19)', () => {
  it('renders Bảng 2.1 with the full seven-column spec keyed by container', async () => {
    getDetail.mockResolvedValue(detail());
    renderWorkspace();
    expect(await screen.findByText('Bảng 2.1 — Cước vận tải')).toBeTruthy();
    const head = screen.getByText('Số Container').closest('tr')!;
    for (const label of ['Số Container', 'Cước thu', 'Phụ phí xăng dầu', 'Lạch Huyện', 'Phí Hải Quan', 'PS thực tế', 'Tổng', 'Ghi chú']) {
      expect(Array.from(head.querySelectorAll('th')).some((th) => th.textContent === label)).toBe(true);
    }
    // Rows label by container + type, never a synthetic trip ordinal.
    expect(screen.getAllByText('CONT-001').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('20DC')).toBeTruthy();
    expect(screen.queryByText(/^Chuyến #/)).toBeNull();
    expect(screen.getByText('4.500.000')).toBeTruthy();
  });

  it('leaves an unlocked lot with trips fully editable', async () => {
    getDetail.mockResolvedValue(detail());
    renderWorkspace();
    await screen.findByText('Bảng 2.1 — Cước vận tải');
    const ps = screen.getByLabelText('PS thực tế CONT-001') as HTMLInputElement;
    expect(ps.disabled).toBe(false);
    expect((screen.getByLabelText('Ghi chú PS CONT-001') as HTMLInputElement).disabled).toBe(false);
    expect((screen.getByRole('button', { name: 'Lưu điều chỉnh' }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole('button', { name: 'Khóa lô hàng' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('keeps Ops amounts read-only and the CUS cells editable', async () => {
    getDetail.mockResolvedValue(detail());
    renderWorkspace();
    await screen.findByText('Bảng 2.1 — Cước vận tải');
    // The Ops amount renders as text, never an input.
    const amount = screen.getByText('180.000');
    expect(amount.tagName).toBe('SPAN');
    expect(screen.getByLabelText(/Thu khách PS thực tế/)).toBeTruthy();
    expect(screen.getByLabelText(/Ghi chú PS thực tế/)).toBeTruthy();
    const payables = screen.getByText('Bảng 2.3 — Phí Phải trả (chỉ xem)').closest('table')!;
    expect(payables.querySelector('input, textarea, select')).toBeNull();
  });

  it('arms the orange warning on detention or repair amounts above zero', async () => {
    getDetail.mockResolvedValue(detail({ chiHoRows: [detail().chiHoRows[0]!.carrierDetention === 0 ? {
      ...detail().chiHoRows[0]!,
      carrierDetention: 350000,
    } : detail().chiHoRows[0]!] }));
    renderWorkspace();
    await screen.findByText('Bảng 2.1 — Cước vận tải');
    expect(document.querySelector('.csc-debit-row--warn')).toBeTruthy();
  });

  it('sends the strict delta and validates it against the shared schema', async () => {
    getDetail.mockResolvedValue(detail());
    const { onSaved } = renderWorkspace();
    await screen.findByText('Bảng 2.1 — Cước vận tải');
    fireEvent.change(screen.getByLabelText(/Thu khách PS thực tế/), { target: { value: '9000000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu điều chỉnh' }));
    await waitFor(() => expect(saveEdits).toHaveBeenCalled());
    const body = saveEdits.mock.calls[0][1];
    // The wire format is the shared delta schema — never a re-declared twin.
    expect(() => shipmentDebitEditPayloadSchema.parse(body)).not.toThrow();
    expect(body).toEqual({
      edits: [{ expenseId: 9001, sellAmount: 9000000, note: undefined }],
      addOtherFees: [],
      removeExpenseIds: [],
    });
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  it('carries Phí khác adds and removals in the delta', async () => {
    getDetail.mockResolvedValue(detail());
    renderWorkspace();
    await screen.findByText('Bảng 2.1 — Cước vận tải');
    fireEvent.click(screen.getByRole('button', { name: '+ Thêm chi phí' }));
    fireEvent.change(screen.getByLabelText('Tên phí mới CONT-001'), { target: { value: 'Phí rửa container' } });
    fireEvent.change(screen.getByLabelText('Số tiền phí mới CONT-001'), { target: { value: '150000' } });
    fireEvent.change(screen.getByLabelText('Số tiền phí khác Phí đăng kiểm CONT-001'), { target: { value: '250000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu điều chỉnh' }));
    await waitFor(() => expect(saveEdits).toHaveBeenCalled());
    const body = saveEdits.mock.calls[0][1];
    expect(() => shipmentDebitEditPayloadSchema.parse(body)).not.toThrow();
    expect(body).toMatchObject({
      edits: [{ expenseId: 9002, buyAmount: 250000 }],
      addOtherFees: [{ tripId: 601, name: 'Phí rửa container', amount: 150000 }],
    });
    // A removed fee travels as an id, never as an amount edit.
    fireEvent.click(screen.getByRole('button', { name: 'Xóa phí khác Phí đăng kiểm' }));
    fireEvent.click(screen.getByRole('button', { name: 'Lưu điều chỉnh' }));
    await waitFor(() => expect(saveEdits.mock.calls.length).toBeGreaterThanOrEqual(2));
    const second = saveEdits.mock.calls[saveEdits.mock.calls.length - 1][1];
    expect(second.removeExpenseIds).toEqual([9002]);
    expect(second.edits ?? []).toEqual([]);
  });

  it('freezes every input when the lot is already locked', async () => {
    getDetail.mockResolvedValue(detail());
    renderWorkspace({ locked: true });
    await screen.findByText('Bảng 2.1 — Cước vận tải');
    const inputs = Array.from(document.querySelectorAll<HTMLInputElement>('.csc-debit-workspace input'));
    expect(inputs.length).toBeGreaterThan(0);
    for (const input of inputs) expect(input.disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Lưu điều chỉnh' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
