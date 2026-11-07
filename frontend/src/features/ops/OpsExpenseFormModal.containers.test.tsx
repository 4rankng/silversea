import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../components/shared/Toast';
import type { OpsOrderItem } from '../../api/opsClient';
import { ApiError } from '../../lib/api/errors';
import { OpsExpenseFormModal, opsContainerId } from './OpsExpenseFormModal';

// Card 191026160000 — Số Cont is a MULTI-select with chọn-all and the form is
// the mockup's two fee blocks. This cluster pins: the container choice
// survives type/tab edits, a lot-wide submit serializes container null (never
// Number("") = 0), picking containers declares the fee PER container, and
// "Chọn tất cả" picks every container at once.
const api = vi.hoisted(() => ({ getExpenseTypes: vi.fn(), getExpensePhotos: vi.fn(), getContainerClaimants: vi.fn(), createExpense: vi.fn(), updateExpense: vi.fn() }));
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

const entry = { id: 7, shipmentId: 8, shipmentCode: order.shipmentCode, billRef: order.billRef, containerNumber: null, expenseTypeCode: 'SOI_CHIEU', expenseTypeName: 'Phí soi chiếu', requiresInvoice: true, amount: '450000', paidAt: '2026-09-23', note: null as string | null, approvalStatus: 'RECORDED', rejectionReason: null as string | null, opsSettlementId: null as number | null, hasPhoto: false, paidById: 12, paidByName: 'Ops', createdAt: '2026-09-23T00:00:00Z', version: 1 };

/** The catalog gate (`typesReady`) disables the Loại phí triggers, so every
 *  driver waits for the blocks to render before touching the form. */
async function show() {
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
  await screen.findByText('Phí không hóa đơn');
  return { client, close };
}

function block(name: string): HTMLElement {
  return screen.getByRole('region', { name });
}

async function addInvoiceRow() {
  await act(async () => { fireEvent.click(within(block('Phí có hóa đơn')).getByRole('button', { name: '＋ Thêm chi phí' })); });
}

async function chooseType(blockName: string, name: string) {
  // ≤ SEARCH_THRESHOLD options render the plain click-to-open list (button
  // trigger + listbox), not the type-to-search combobox input.
  const trigger = within(block(blockName)).getByRole('button', { name: /Loại phí/ });
  // The trigger is `disabled={!typesReady}` until the catalog query lands —
  // show()'s heading await resolves before that, so wait for the gate.
  await waitFor(() => expect(trigger).toBeEnabled());
  await act(async () => { fireEvent.click(trigger); });
  fireEvent.click(await screen.findByRole('option', { name }));
}

async function fillAmount(blockName: string, value: string) {
  fireEvent.change(within(block(blockName)).getByLabelText(/Thực chi \(VND\)/), { target: { value } });
}

/** SIL-723 (KB Chương 6): the invoice block requires Số hóa đơn, so any
 *  submit-driving case fills it — the container focus of A2/A3/A5 stays on
 *  the Số Cont payload, never on the invoice law. */
async function fillInvoiceNumber(blockName: string, value: string) {
  fireEvent.change(within(block(blockName)).getByLabelText('Số hóa đơn'), { target: { value } });
}

async function fillNote(blockName: string, value: string) {
  fireEvent.change(within(block(blockName)).getByLabelText('Ghi chú'), { target: { value } });
}

async function pickContainers(...labels: string[]) {
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /số cont/ })); });
  const listbox = await screen.findByRole('listbox');
  for (const label of labels) fireEvent.click(within(listbox).getByRole('option', { name: label }));
  fireEvent.keyDown(listbox, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
}

beforeEach(() => {
  vi.resetAllMocks();
  api.getExpenseTypes.mockResolvedValue(types);
  api.getExpensePhotos.mockResolvedValue({ items: [] });
  api.getContainerClaimants.mockResolvedValue([]);
  api.createExpense.mockResolvedValue(entry);
});

// Every case here drives a long interaction chain (open catalog menu, choose a
// type, open a second combobox, submit) through the real modal, and the module's
// import alone costs ~11s. Measured on a loaded dev machine the file's first
// case sits at ~5.4s pristine / ~6.4s with the grouped money field — i.e. over
// vitest's 5s default before any change, so the cluster carries an explicit
// deadline like the other interaction-chain suites in this repo.
describe('ops expense form — Số Cont multi-select (card 191026160000)', { timeout: 20_000 }, () => {
  it('A1: keeps the Số Cont selection through block/tab edits', async () => {
    await show();
    expect(screen.getByRole('button', { name: 'Đã chọn 1 số cont' }).getAttribute('title')).toContain('Phí chung lô');

    await pickContainers('TGHU1234567');
    expect(screen.getByRole('button', { name: 'Đã chọn 1 số cont' }).getAttribute('title')).toContain('TGHU1234567');

    await addInvoiceRow();
    await chooseType('Phí có hóa đơn', 'Phí soi chiếu');
    expect(screen.getByRole('button', { name: 'Đã chọn 1 số cont' }).getAttribute('title')).toContain('TGHU1234567');
  });

  it('A2: a shared-lot submit serializes container null — never Number("") = 0', async () => {
    await show();
    await addInvoiceRow();
    await chooseType('Phí có hóa đơn', 'Phí soi chiếu');
    await fillAmount('Phí có hóa đơn', '450000');
    await fillInvoiceNumber('Phí có hóa đơn', 'TD-20260923-001');
    const save = screen.getByRole('button', { name: 'Lưu' }) as HTMLButtonElement;
    expect(save).toBeEnabled();
    fireEvent.submit(save.form!);
    await waitFor(() => expect(api.createExpense).toHaveBeenCalledTimes(1));
    expect(api.createExpense.mock.calls[0][0]).toMatchObject({ shipmentContainerId: null, expenseTypeCode: 'SOI_CHIEU' });
    expect(opsContainerId('LOT')).toBeNull();
    expect(opsContainerId('')).toBeNull();
    expect(opsContainerId('33')).toBe(33);
  });

  it('A3: picked containers declare the fee once per container', async () => {
    await show();
    await pickContainers('TGHU1234567', 'TGHU7654321');
    await addInvoiceRow();
    await chooseType('Phí có hóa đơn', 'Phí soi chiếu');
    await fillAmount('Phí có hóa đơn', '450000');
    await fillInvoiceNumber('Phí có hóa đơn', 'TD-20260923-001');
    const save = screen.getByRole('button', { name: 'Lưu' }) as HTMLButtonElement;
    expect(save).toBeEnabled();
    fireEvent.submit(save.form!);
    await waitFor(() => expect(api.createExpense).toHaveBeenCalledTimes(2));
    expect(api.createExpense.mock.calls[0][0]).toMatchObject({ shipmentContainerId: 33 });
    expect(api.createExpense.mock.calls[1][0]).toMatchObject({ shipmentContainerId: 44 });
  });

  it('A4: chọn tất cả picks every container at once (and drops the lot choice)', async () => {
    await show();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Chọn tất cả số cont' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Đã chọn 2 số cont' }).getAttribute('title'))
      .toContain('TGHU1234567, TGHU7654321'));
    // Toggling again empties the per-container picks.
    fireEvent.click(screen.getByRole('checkbox', { name: 'Chọn tất cả số cont' }));
    expect(screen.getByRole('button', { name: 'Chọn số cont…' })).toBeInTheDocument();
  });

  it('A5: duplicate bounce pauses the batch; Tiếp tục lưu re-sends only from the bounced row', async () => {
    api.createExpense.mockRejectedValueOnce(new ApiError(409, { code: 'OPS_EXPENSE_DUPLICATE', duplicates: [
      { id: 91, amount: 1000, paidAt: '2026-10-01', containerNumber: null, paidById: 2, paidByName: 'Ops khác' },
    ] }, 'trùng'));
    await show();
    await pickContainers('TGHU1234567', 'TGHU7654321');
    await addInvoiceRow();
    await chooseType('Phí có hóa đơn', 'Phí soi chiếu');
    await fillAmount('Phí có hóa đơn', '450000');
    await fillInvoiceNumber('Phí có hóa đơn', 'TD-20260923-001');
    const save = screen.getByRole('button', { name: 'Lưu' }) as HTMLButtonElement;
    expect(save).toBeEnabled();
    fireEvent.submit(save.form!);
    expect(await screen.findByRole('alert')).toHaveTextContent('NHẬP TRƯỚC ĐÓ');
    expect(api.createExpense).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Tiếp tục lưu' }));
    // 3 attempts total: the bounced first, then the confirmed re-send (same
    // container) and the untouched second container.
    await waitFor(() => expect(api.createExpense).toHaveBeenCalledTimes(3));
    expect(api.createExpense.mock.calls[1][0]).toMatchObject({ shipmentContainerId: 33, duplicateConfirmed: true });
    expect(api.createExpense.mock.calls[2][0]).toMatchObject({ shipmentContainerId: 44 });
  });
});

// SIL-723 — the Lưu button must obey KB Chương 6 (bắt buộc tối thiểu = Loại +
// Số tiền; Số hóa đơn CHỈ trong block có hóa đơn; ảnh biên lai tùy chọn) and
// never disable in silence: the blocked footer NAMES the missing field.
describe('ops expense form — Lưu law (SIL-723, KB Chương 6)', { timeout: 20_000 }, () => {
  it('B1: Loại + Số tiền + Ghi chú on a no-invoice row saves — no invoice number, no photo required', async () => {
    await show();
    await chooseType('Phí không hóa đơn', 'Chi công nhân');
    await fillAmount('Phí không hóa đơn', '80000');
    await fillNote('Phí không hóa đơn', 'Chi tiền mặt cho 2 công nhân dỡ hàng');
    const save = screen.getByRole('button', { name: 'Lưu' }) as HTMLButtonElement;
    expect(save).toBeEnabled();
    fireEvent.submit(save.form!);
    await waitFor(() => expect(api.createExpense).toHaveBeenCalledTimes(1));
    expect(api.createExpense.mock.calls[0][0]).toMatchObject({
      expenseTypeCode: 'CONG_NHAN',
      amount: '80000',
      note: 'Chi tiền mặt cho 2 công nhân dỡ hàng',
      shipmentContainerId: null,
      invoiceNumber: null,
      photoStorageKeys: [],
    });
  });

  it('B2: a no-charge row without Ghi chú stays blocked and the footer names "Ghi chú"', async () => {
    await show();
    await chooseType('Phí không hóa đơn', 'Chi công nhân');
    await fillAmount('Phí không hóa đơn', '80000');
    const save = screen.getByRole('button', { name: 'Lưu' }) as HTMLButtonElement;
    expect(save).toBeDisabled();
    // The message shows twice: the row hint AND the footer notice beside Lưu
    // (the two surfaces SIL-723 requires; footer read via findAllByText).
    expect((await screen.findAllByText('Dòng không thu khách (Thực thu để trống) — bắt buộc nhập trường "Ghi chú".')).length).toBeGreaterThan(0);
    // Filling the field the message names re-enables the save.
    await fillNote('Phí không hóa đơn', 'Không thu khách — phí nội bộ');
    expect(save).toBeEnabled();
    expect(screen.queryAllByText('Dòng không thu khách (Thực thu để trống) — bắt buộc nhập trường "Ghi chú".')).toHaveLength(0);
  });

  it('B3: the invoice block requires "Số hóa đơn" and the footer names it', async () => {
    await show();
    await addInvoiceRow();
    await chooseType('Phí có hóa đơn', 'Phí soi chiếu');
    await fillAmount('Phí có hóa đơn', '450000');
    const save = screen.getByRole('button', { name: 'Lưu' }) as HTMLButtonElement;
    expect(save).toBeDisabled();
    expect((await screen.findAllByText('Nhập "Số hóa đơn" — khoản có hóa đơn bắt buộc có số hóa đơn.')).length).toBeGreaterThan(0);
    await fillInvoiceNumber('Phí có hóa đơn', 'TD-20260923-001');
    expect(save).toBeEnabled();
  });

  it('B4: the no-invoice block never demands Số hóa đơn (KB: chỉ nhóm có hóa đơn)', async () => {
    await show();
    await chooseType('Phí không hóa đơn', 'Chi công nhân');
    await fillAmount('Phí không hóa đơn', '50000');
    await fillNote('Phí không hóa đơn', 'Chi áp ván');
    expect(screen.getByRole('button', { name: 'Lưu' }).getAttribute('disabled')).toBeNull();
    expect(screen.queryByText(/Số hóa đơn/)).toBeNull();
  });
});
