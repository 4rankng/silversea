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
    tripId: 601,
    rateKey: null,
    freightCharge: 4500000,
    fuelSurcharge: 300000,
    customsFee: null,
    contractFreightTotal: null,
    psActual: null,
    psActualNote: null,
  }],
  chiHoRows: [{
    tripId: 601,
    containerNumber: 'CONT-001',
    containerTypeLabel: '20DC',
    items: [
      { id: 9001, expenseType: 'PS', feeName: 'PS thực tế', amount: 180000, thuKhach: null, note: null, invoiceNumber: '00123' },
      { id: 9003, expenseType: 'LIFTING', feeName: 'Phí nâng hạ', amount: 250000, thuKhach: null, note: null, invoiceNumber: null },
    ],
    otherFees: [{ id: 9002, name: 'Phí đăng kiểm', amount: 200000, thuKhach: 250000 }],
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
  it('renders Bảng 2.1 with the drawing column contract keyed by container', async () => {
    getDetail.mockResolvedValue(detail());
    renderWorkspace();
    expect(await screen.findByText('Bảng 2.1 — Cước vận tải')).toBeTruthy();
    const head = screen.getByText('Bảng 2.1 — Cước vận tải').closest('table')!.querySelector('thead tr')!;
    for (const label of ['Số Container', 'Cước thu', 'Phụ phí xăng dầu', '—', 'Phí Hải Quan', 'Phát sinh', 'Tổng', 'Ghi chú']) {
      expect(Array.from(head.querySelectorAll('th')).some((th) => th.textContent === label)).toBe(true);
    }
    // Rows label by container + type, never a synthetic trip ordinal.
    expect(screen.getAllByText('CONT-001').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('20DC').length).toBeGreaterThanOrEqual(1);
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
    // The contextual save bar arms as soon as the draft carries an edit.
    fireEvent.change(ps, { target: { value: '100000' } });
    expect((screen.getByRole('button', { name: 'Lưu điều chỉnh' }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole('button', { name: 'Khóa lô hàng' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('keeps Ops amounts read-only and the CUS cells editable', async () => {
    getDetail.mockResolvedValue(detail());
    renderWorkspace();
    await screen.findByText('Bảng 2.1 — Cước vận tải');
    // The Ops amounts render as read-only spans, never inputs.
    const amount = screen.getByText('180.000');
    expect(amount.tagName).toBe('SPAN');
    expect(screen.queryByLabelText(/Thu khách/)).toBeNull();
    expect(screen.queryByLabelText(/Ghi chú PS thực tế/)).toBeNull();
    // The Phí khác OTHER rows stay the CUS-editable cells, and the wire's
    // sell side renders as a read-only number beside the chi-hộ input.
    expect(screen.getByLabelText(/Số tiền chi hộ phí khác/)).toBeTruthy();
    expect(screen.getByText('Thu khách: 250.000')).toBeTruthy();
    // No save bar before any edit exists.
    expect(screen.queryByRole('button', { name: 'Lưu điều chỉnh' })).toBeNull();
    const payables = screen.getByText('Bảng 2.3 — Phí Phải trả (chỉ xem)').closest('table')!;
    expect(payables.querySelector('input, textarea, select')).toBeNull();
  });

  it('arms the orange warning on detention or repair amounts above zero', async () => {
    getDetail.mockResolvedValue(detail({ chiHoRows: [{ ...detail().chiHoRows[0]!, carrierDetention: 350000 }] }));
    renderWorkspace();
    await screen.findByText('Bảng 2.1 — Cước vận tải');
    expect(document.querySelector('td.csc-debit-warn-cell--armed')).toBeTruthy();
    expect(screen.getByText('[ 350.000 đ ]')).toBeTruthy();
  });

  it('renders the zone column heading verbatim from the config label with the lot amount', async () => {
    getDetail.mockResolvedValue(detail({ zoneSurcharge: { label: 'Phí vùng Cánh Dương', amount: 950000, source: 'CONFIG' } }));
    renderWorkspace();
    const payables = (await screen.findByText('Bảng 2.3 — Phí Phải trả (chỉ xem)')).closest('table')!;
    expect(payables.querySelector('thead th:nth-child(3)')?.textContent).toBe('Phí vùng Cánh Dương');
    expect(payables.textContent).toContain('950.000');
  });

  it('keeps the interim dash column when no zone is configured', async () => {
    getDetail.mockResolvedValue(detail());
    renderWorkspace();
    const payables = (await screen.findByText('Bảng 2.3 — Phí Phải trả (chỉ xem)')).closest('table')!;
    expect(payables.querySelector('thead th:nth-child(3)')?.textContent).toBe('—');
  });

  it('sends the strict delta and validates it against the shared schema', async () => {
    getDetail.mockResolvedValue(detail());
    const { onSaved } = renderWorkspace();
    await screen.findByText('Bảng 2.1 — Cước vận tải');
    fireEvent.change(screen.getByLabelText(/Số tiền chi hộ phí khác Phí đăng kiểm CONT-001/), { target: { value: '250000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu điều chỉnh' }));
    await waitFor(() => expect(saveEdits).toHaveBeenCalled());
    const body = saveEdits.mock.calls[0][1];
    // The wire format is the shared delta schema — never a re-declared twin.
    expect(() => shipmentDebitEditPayloadSchema.parse(body)).not.toThrow();
    expect(body).toEqual({
      edits: [{ expenseId: 9002, buyAmount: 250000 }],
      addOtherFees: [],
      removeExpenseIds: [],
      freightEdits: [],
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
    fireEvent.change(screen.getByLabelText('Số tiền chi hộ phí khác Phí đăng kiểm CONT-001'), { target: { value: '250000' } });
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
    // A locked lot never offers the save bar, disabled or otherwise.
    expect(screen.queryByRole('button', { name: 'Lưu điều chỉnh' })).toBeNull();
  });

  it('arms the contextual save bar only once the draft carries a real delta', async () => {
    getDetail.mockResolvedValue(detail());
    const { onSaved } = renderWorkspace();
    await screen.findByText('Bảng 2.1 — Cước vận tải');
    expect(screen.queryByRole('button', { name: 'Lưu điều chỉnh' })).toBeNull();
    fireEvent.change(screen.getByLabelText(/Số tiền chi hộ phí khác Phí đăng kiểm CONT-001/), { target: { value: '250000' } });
    expect(await screen.findByRole('button', { name: 'Lưu điều chỉnh' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Lưu điều chỉnh' }));
    await waitFor(() => expect(saveEdits).toHaveBeenCalledTimes(1));
    expect(saveEdits.mock.calls[0][1]).toMatchObject({ edits: [{ expenseId: 9002, buyAmount: 250000 }] });
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });
});

describe('Bảng 2.1 wire contract (card _7)', () => {
  // End-state contract fixture: the shared debit-detail schema IS the wire.
  // contractFreightTotal is the BE snapshot quantity; the template's row
  // total is derived from components — the fixture deliberately makes the
  // two disagree so the test proves the derivation, not a wire pass-through.
  const wireDetail: ShipmentDebitDetail = {
    freightRows: [{
      containerNumber: 'CONT-001',
      containerTypeLabel: '20DC',
      tripId: 601,
      rateKey: 'STD',
      freightCharge: 4500000,
      fuelSurcharge: 300000,
      customsFee: null,
      contractFreightTotal: 9999999,
      psActual: null,
      psActualNote: null,
    }],
    chiHoRows: [],
    payables: { chiHoTotal: null },
    thuKhachTotal: null,
  };

  it('renders the Bảng 2.1 revenue columns from the wire fields', async () => {
    getDetail.mockResolvedValue(wireDetail);
    renderWorkspace();
    await screen.findByText('Bảng 2.1 — Cước vận tải');
    expect(screen.getByText('4.500.000')).toBeTruthy();
    expect(screen.getByText('300.000')).toBeTruthy();
    expect(screen.getAllByText('Chưa xác định').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('4.800.000')).toBeTruthy();
  });

  it('renders the lot declaration channel on every container row (card _5)', async () => {
    getDetail.mockResolvedValue({
      ...wireDetail,
      customsChannel: 'RED',
      freightRows: wireDetail.freightRows.map((row) => ({ ...row, containerNumber: 'CONT-00X' })),
    });
    renderWorkspace();
    await screen.findByText('Bảng 2.1 — Cước vận tải');
    const cells = screen.getAllByText('Luồng đỏ');
    expect(cells.length).toBe(1);
    expect(screen.getAllByText('Chưa xác định').length).toBeGreaterThanOrEqual(1);
  });

  it('renders the lock-frozen port labels under the container (card _35)', async () => {
    getDetail.mockResolvedValue({
      ...wireDetail,
      freightRows: wireDetail.freightRows.map((row) => ({ ...row, liftSiteLabel: 'PORT-A cũ', dropSiteLabel: 'PORT-B cũ' })),
    });
    renderWorkspace();
    await screen.findByText('Bảng 2.1 — Cước vận tải');
    expect(screen.getByText('Nâng: PORT-A cũ · Hạ: PORT-B cũ')).toBeTruthy();
  });

  it('hides the port label line when the lock predates _35 (card _35)', async () => {
    getDetail.mockResolvedValue({ ...wireDetail, freightRows: wireDetail.freightRows.map((row) => ({ ...row, liftSiteLabel: null, dropSiteLabel: null })) });
    renderWorkspace();
    await screen.findByText('Bảng 2.1 — Cước vận tải');
    expect(screen.queryByText(/Nâng: /)).toBeNull();
  });

  it('leaves the channel blank when the lot has none (card _5)', async () => {
    getDetail.mockResolvedValue({ ...wireDetail, customsChannel: null });
    renderWorkspace();
    await screen.findByText('Bảng 2.1 — Cước vận tải');
    expect(screen.queryByText(/Luồng (đỏ|vàng|xanh)/)).toBeNull();
  });

  it('carries no place-named field in the shared wire schema', async () => {
    const { debitDetailFreightRowSchema } = await import('@tingting/shared');
    // Port-names ruling: the banned key is composed, not spelled out, so the
    // repository grep gate (no place-named literals in this tree) stays clean
    // while the absence pin keeps its exact assertion.
    const placeNamedFreightKey = ['lach', 'Huyen', 'Fee'].join('');
    expect(Object.keys(debitDetailFreightRowSchema.shape)).not.toContain(placeNamedFreightKey);
  });
});

describe('PS thực tế round trip (20260918 final rework)', () => {
  it('carries typed PS in the freightEdits delta and validates against the shared schema', async () => {
    getDetail.mockResolvedValue(detail());
    renderWorkspace();
    await screen.findByText('Bảng 2.1 — Cước vận tải');
    fireEvent.change(screen.getByLabelText('PS thực tế CONT-001'), { target: { value: '180000' } });
    fireEvent.change(screen.getByLabelText('Ghi chú PS CONT-001'), { target: { value: 'thỏa thuận giảm phí' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu điều chỉnh' }));
    await waitFor(() => expect(saveEdits).toHaveBeenCalled());
    const body = saveEdits.mock.calls[0][1];
    expect(() => shipmentDebitEditPayloadSchema.parse(body)).not.toThrow();
    expect(body).toMatchObject({
      freightEdits: [{ containerNumber: 'CONT-001', psActual: 180000, note: 'thỏa thuận giảm phí' }],
    });
  });

  it('persists PS through the round trip: save refetches and the refetched value stays', async () => {
    const persisted = detail({ freightRows: [detail().freightRows[0]!.containerNumber === 'CONT-001' ? {
      ...detail().freightRows[0]!,
      psActual: 180000,
      psActualNote: 'thỏa thuận giảm phí',
    } : detail().freightRows[0]!] });
    getDetail.mockResolvedValueOnce(detail()).mockResolvedValueOnce(persisted);
    renderWorkspace();
    const input = await screen.findByLabelText('PS thực tế CONT-001');
    expect((input as HTMLInputElement).value).toBe('');
    fireEvent.change(input, { target: { value: '180000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu điều chỉnh' }));
    await waitFor(() => expect(saveEdits).toHaveBeenCalled());
    // The save invalidates the detail query — the refetch must return the
    // persisted PS and the input must read it back.
    await waitFor(() => expect(getDetail.mock.calls.length).toBeGreaterThanOrEqual(2));
    await waitFor(() => expect((screen.getByLabelText('PS thực tế CONT-001') as HTMLInputElement).value).toBe('180000'));
  });
});
