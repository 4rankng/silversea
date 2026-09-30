import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../components/shared/Toast';
import type { OpsOrderItem } from '../../api/opsClient';
import { UuiSelectField } from '../../design-system/forms/UuiSelectField';
import { OpsExpenseFormModal, opsContainerId } from './OpsExpenseFormModal';

// Audit c12 cluster A (Kế hoạch làm hàng → Khai báo chi phí): the Số Cont
// choice must survive Loại phí / Nhóm chi phí edits, a no-container submit
// must never serialize container 0, and suggestion chips fill Tên khoản chi —
// not the expense-type field.
const api = vi.hoisted(() => ({ getExpenseTypes: vi.fn(), getExpensePhotos: vi.fn(), createExpense: vi.fn(), updateExpense: vi.fn() }));
vi.mock('../../api/opsClient', () => ({ opsClient: api }));

const types = { items: [
  { id: 1, code: 'SOI_CHIEU', name: 'Phí soi chiếu', requiresInvoice: true },
  { id: 2, code: 'KIEM_HOA', name: 'Phí kiểm hóa', requiresInvoice: true },
  { id: 3, code: 'BOC_XEP', name: 'Bốc xếp hàng', requiresInvoice: true },
  { id: 4, code: 'CONG_NHAN', name: 'Chi công nhân', requiresInvoice: false },
  { id: 5, code: 'SUA_TO_KHAI', name: 'Sửa tờ khai', requiresInvoice: false },
] };

const order: OpsOrderItem = {
  id: 8, shipmentCode: 'SHP-20260923-0028', status: 'IN_PROGRESS', tradeDirection: 'IMPORT',
  billRef: 'YMLU8923410', customerName: 'Khách hàng', routeName: 'Hải Phòng', pinned: false, pinnedAt: null,
  containerCount: 2, containerNumbers: ['TGHU1234567', 'TGHU7654321'], containerIds: [33, 44],
};

const entry = { id: 7, shipmentId: 8, shipmentCode: order.shipmentCode, containerNumber: null, expenseTypeCode: 'SOI_CHIEU', expenseTypeName: 'Phí soi chiếu', requiresInvoice: true, amount: '450000', paidAt: '2026-09-23', note: null as string | null, approvalStatus: 'RECORDED', rejectionReason: null as string | null, opsSettlementId: null as number | null, hasPhoto: false, paidById: 12, paidByName: 'Ops', createdAt: '2026-09-23T00:00:00Z', version: 1 };

function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const close = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ToastProvider>
          <OpsExpenseFormModal order={order} onClose={close} />
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { client, close };
}

function soContTrigger() {
  return screen.getByRole('button', { name: /Số Cont/ });
}

async function openMenu(trigger: HTMLElement) {
  await act(async () => { fireEvent.click(trigger); });
}

async function chooseType(name: string) {
  const input = await screen.findByRole('combobox', { name: /Loại phí/ });
  await act(async () => { input.focus(); fireEvent.click(input); });
  fireEvent.change(input, { target: { value: name } });
  fireEvent.click(await screen.findByRole('option', { name }));
}

beforeEach(() => {
  vi.resetAllMocks();
  api.getExpenseTypes.mockResolvedValue(types);
  api.getExpensePhotos.mockResolvedValue({ items: [] });
  api.createExpense.mockResolvedValue(entry);
});

// Every case here drives a long interaction chain (open catalog menu, choose a
// type, open a second combobox, submit) through the real modal, and the module's
// import alone costs ~11s. Measured on a loaded dev machine the file's first
// case sits at ~5.4s pristine / ~6.4s with the grouped money field — i.e. over
// vitest's 5s default before any change, so the cluster carries an explicit
// deadline like the other interaction-chain suites in this repo.
describe('ops expense form — Số Cont persistence (audit c12 cluster A)', { timeout: 20_000 }, () => {
  it('A1: keeps the Số Cont selection through Loại phí and Nhóm chi phí changes', async () => {
    show();
    expect(soContTrigger().textContent).toContain('Phí chung lô');

    await openMenu(soContTrigger());
    fireEvent.click(await screen.findByRole('option', { name: 'TGHU1234567' }));
    expect(soContTrigger().textContent).toContain('TGHU1234567');

    await chooseType('Phí soi chiếu');
    expect(soContTrigger().textContent).toContain('TGHU1234567');

    const group = screen.getByRole('combobox', { name: 'Nhóm chi phí' });
    await act(async () => { group.focus(); fireEvent.click(group); });
    fireEvent.click(await screen.findByRole('option', { name: 'Không hóa đơn · Giao nhận' }));
    expect(soContTrigger().textContent).toContain('TGHU1234567');
  });

  it('A2: a shared-lot submit serializes container null — never Number("") = 0', async () => {
    show();
    await chooseType('Phí soi chiếu');
    fireEvent.change(screen.getByLabelText(/Thực chi/), { target: { value: '450000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    await waitFor(() => expect(api.createExpense).toHaveBeenCalledTimes(1));
    const payload = api.createExpense.mock.calls[0][0];
    expect(payload.amount).toBe('450000');
    expect(payload.shipmentContainerId).toBeNull();
  });

  it('A2: an empty Số Cont choice is shared-lot, not container 0', () => {
    expect(opsContainerId('LOT')).toBeNull();
    expect(opsContainerId('')).toBeNull();
    expect(opsContainerId('33')).toBe(33);
  });

  it('A1: an empty plain select shows a Vietnamese placeholder, never the English "Select"', () => {
    render(
      <UuiSelectField
        label="Số Cont"
        value=""
        onChange={vi.fn()}
        options={[{ value: 'LOT', label: 'Phí chung lô' }, { value: '33', label: 'TGHU1234567' }]}
      />,
    );
    const trigger = screen.getByRole('button', { name: /Số Cont/ });
    expect(trigger.textContent).not.toContain('Select');
    expect(trigger.textContent).toContain('— Chọn —');
  });

  it('A3: a suggestion chip fills Tên khoản chi and never rewrites Loại phí', async () => {
    show();
    await chooseType('Phí soi chiếu');
    fireEvent.click(screen.getByText('Gợi ý khoản chi'));
    fireEvent.click(screen.getByRole('button', { name: 'Soi chiếu' }));
    expect(screen.getByLabelText('Tên khoản chi')).toHaveValue('Soi chiếu');
    expect(screen.getByRole('combobox', { name: 'Loại phí' })).toHaveValue('Phí soi chiếu');
  });

  // Card 20260928_197: every cost-entry screen takes a positive AND a negative
  // amount and groups thousands — the driver's form did, this one did not.
  it('A4: the money field groups thousands and keeps a typed negative', async () => {
    show();
    const money = screen.getByLabelText(/Thực chi/);
    expect(money).toHaveAttribute('type', 'text');
    fireEvent.change(money, { target: { value: '250000' } });
    expect(money).toHaveValue('250.000');
    fireEvent.change(money, { target: { value: '-250000' } });
    expect(money).toHaveValue('-250.000');
  });

  it('A5: a row that charges no customer cannot be saved without a note', async () => {
    show();
    // "Chi công nhân" carries no invoice, so its charge is only the operator's
    // "Thực thu (thu khách)" override — blank means the server refuses the row.
    await chooseType('Chi công nhân');
    fireEvent.change(screen.getByLabelText(/Thực chi/), { target: { value: '250000' } });
    const save = screen.getByRole('button', { name: 'Lưu' });
    expect(save).toBeDisabled();
    expect(screen.getByText(/ghi chú bắt buộc/i)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Ghi chú'), { target: { value: 'Nhà xe tự chịu' } });
    expect(save).toBeEnabled();
    // Charging the customer lifts the requirement on its own, with no note.
    fireEvent.change(screen.getByLabelText('Ghi chú'), { target: { value: '' } });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Thực thu (thu khách)'), { target: { value: '250000' } });
    expect(save).toBeEnabled();
    expect(api.createExpense).not.toHaveBeenCalled();
  });
});
