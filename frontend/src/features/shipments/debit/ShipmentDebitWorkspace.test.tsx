import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

import { Role } from '@tingting/shared';
import { ShipmentDebitWorkspace } from './ShipmentDebitWorkspace';
import type { ShipmentDebitDetail } from '../../../api/shipmentClient';

const detail = (over: Partial<ShipmentDebitDetail> = {}): ShipmentDebitDetail => ({
  shipmentId: 101,
  freightRows: [{
    containerNumber: 'CONT-001',
    containerTypeLabel: '20DC',
    freightCharge: '4500000',
    fuelSurcharge: '300000',
    lachHuyenFee: null,
    customsFee: '250000',
    psActual: null,
    psNotes: null,
  }],
  chiHoRows: [{
    containerNumber: 'CONT-001',
    liftFee: '500000',
    lowerFee: '500000',
    cshtFee: '200000',
    cshtInvoiceNumber: 'HD-9',
    otherFees: [],
    carrierDetention: '0',
    repairAdvance: null,
    opsDocsStatus: 'READY',
    opsPaidTotal: '150000',
  }],
  payables: { freightReturn: '4200000', lachHuyenReturn: null, customsFee: '250000', psOps: null },
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

describe('Chi phí - Quyết toán L2 workspace (20260918_18)', () => {
  it('shows the three settlement tables with auto numbers and unknown-money placeholders', async () => {
    getDetail.mockResolvedValue(detail());
    renderWorkspace();
    expect(await screen.findByText('Bảng 2.1 — Cước vận tải')).toBeTruthy();
    expect(screen.getByText('Bảng 2.2 — Phí Chi Hộ & Tiền Treo')).toBeTruthy();
    expect(screen.getByText('Bảng 2.3 — Phí Phải trả (chỉ xem)')).toBeTruthy();
    // Auto cells come from the payload verbatim (formatted); unknowns never render as 0.
    expect(screen.getByText('4.500.000')).toBeTruthy();
    expect(screen.getAllByText('Chưa xác định')).toHaveLength(3);
  });

  it('keeps Ops invoiced fees and the payables table truly read-only', async () => {
    getDetail.mockResolvedValue(detail());
    renderWorkspace();
    await screen.findByText('Bảng 2.1 — Cước vận tải');
    // 2.3 is a definition table — no editable control may exist inside it.
    const payables = screen.getByText('Bảng 2.3 — Phí Phải trả (chỉ xem)').closest('table')!;
    expect(payables.querySelector('input, textarea, select')).toBeNull();
    // Ops invoiced fee is text in 2.2, not an input.
    expect(screen.queryByLabelText(/Chi phí Ops/)).toBeNull();
  });

  it('arms the orange warning on detention or repair amounts above zero', async () => {
    getDetail.mockResolvedValue(detail({ chiHoRows: [detail().chiHoRows[0]!.containerNumber === 'CONT-001' ? {
      ...detail().chiHoRows[0]!,
      carrierDetention: '350000',
    } : detail().chiHoRows[0]!] }));
    renderWorkspace();
    await screen.findByText('Bảng 2.1 — Cước vận tải');
    expect(document.querySelector('.csc-debit-row--warn')).toBeTruthy();
  });

  it('saves the CUS-entered PS and thu khách and signals the parent to refetch', async () => {
    getDetail.mockResolvedValue(detail());
    const { onSaved } = renderWorkspace();
    await screen.findByText('Bảng 2.1 — Cước vận tải');
    fireEvent.change(screen.getByLabelText('PS thực tế CONT-001'), { target: { value: '180000' } });
    fireEvent.change(screen.getByLabelText('Thu khách'), { target: { value: '9000000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu điều chỉnh' }));
    await waitFor(() => expect(saveEdits).toHaveBeenCalledWith(101, expect.objectContaining({
      freightRows: [expect.objectContaining({ containerNumber: 'CONT-001', psActual: '180000' })],
      thuKhachTotal: '9000000',
    }), expect.any(String)));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  it('freezes every input when the lot is already locked', async () => {
    getDetail.mockResolvedValue(detail());
    renderWorkspace({ locked: true });
    await screen.findByText('Bảng 2.1 — Cước vận tải');
    const inputs = Array.from(document.querySelectorAll<HTMLInputElement>('.csc-debit-workspace input'));
    expect(inputs.length).toBeGreaterThan(0);
    for (const input of inputs) expect(input.disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Lưu điều chỉnh' }).hasAttribute('disabled')).toBe(true);
  });
});

describe('Chi phí - Quyết toán lock + adjust (20260918_19)', () => {
  it('the CUS lock posts once and freezes the workspace with a refetch', async () => {
    getDetail.mockResolvedValue(detail());
    const { onSaved } = renderWorkspace();
    await screen.findByText('Bảng 2.1 — Cước vận tải');
    const lockButton = screen.getByRole('button', { name: 'Khóa lô hàng' });
    expect(lockButton.hasAttribute('disabled')).toBe(false);
    fireEvent.click(lockButton);
    await waitFor(() => expect(lockCost).toHaveBeenCalledWith(101, expect.any(String)));
    // The workspace freezes immediately and the parent refetches.
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    await waitFor(() => {
      const inputs = Array.from(document.querySelectorAll<HTMLInputElement>('.csc-debit-workspace input'));
      expect(inputs.length).toBeGreaterThan(0);
      for (const input of inputs) expect(input.disabled).toBe(true);
    });
  });

  it('surfaces the server message when the lock conflicts', async () => {
    getDetail.mockResolvedValue(detail());
    renderWorkspace();
    await screen.findByText('Bảng 2.1 — Cước vận tải');
    lockCost.mockRejectedValueOnce(new Error('Lô này đã khóa'));
    fireEvent.click(screen.getByRole('button', { name: 'Khóa lô hàng' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Lô này đã khóa');
  });

  it('gates adjust by role and demands a reason before submitting', async () => {
    getDetail.mockResolvedValue(detail());
    useAuthMock.mockReturnValue({ user: { userId: 3, role: Role.ACCOUNTANT } });
    renderWorkspace({ locked: true });
    // Accountant on a locked lot: the adjust form opens, but submission is
    // blocked until the reason has content.
    await screen.findByText('Bảng 2.1 — Cước vận tải');
    fireEvent.click(screen.getByRole('button', { name: 'Điều chỉnh cước' }));
    expect(await screen.findByText(/cước hợp đồng giữ lại để đối chiếu/)).toBeTruthy();
    expect(screen.getByText('Cước hợp đồng: 4.500.000')).toBeTruthy();
    const submit = screen.getByRole('button', { name: 'Gửi điều chỉnh' }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Lý do (bắt buộc)'), { target: { value: 'Khách yêu cầu giảm 200k theo thỏa thuận' } });
    expect((screen.getByRole('button', { name: 'Gửi điều chỉnh' }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Gửi điều chỉnh' }));
    await waitFor(() => expect(adjustCost).toHaveBeenCalledWith(101, expect.objectContaining({ reason: 'Khách yêu cầu giảm 200k theo thỏa thuận' }), expect.any(String)));
  });

  it('keeps the adjust affordance out of reach for the CUS role', async () => {
    getDetail.mockResolvedValue(detail());
    renderWorkspace({ locked: true });
    await screen.findByText('Bảng 2.1 — Cước vận tải');
    expect((screen.getByRole('button', { name: 'Điều chỉnh cước' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Khóa lô hàng' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
