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
const api = vi.hoisted(() => ({ getExpenseTypes: vi.fn(), getExpensePhotos: vi.fn(), getContainerClaimants: vi.fn(), createExpense: vi.fn(), updateExpense: vi.fn(), createExpenseType: vi.fn() }));
vi.mock('../../api/opsClient', () => ({ opsClient: api }));
// SIL-761 — the popup reads the viewer's role; standalone renders have no
// AuthProvider, so the mock defaults to null (= every pre-761 test keeps the
// non-Ops view) and the Ops cases flip it per test.
const authState = vi.hoisted(() => ({ role: null as string | null }));
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: authState.role == null ? null : { role: authState.role } }) }));

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
 *  driver waits for the blocks to render before touching the form. SIL-760:
 *  the group name now lives on the centered tab button, so the await reads
 *  the tab, not a heading. */
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
  await screen.findByRole('tab', { name: 'PHÍ KHÔNG HÓA ĐƠN' });
  return { client, close };
}

function block(name: string): HTMLElement {
  return screen.getByRole('region', { name });
}

/** SIL-760 — only the active tab's rows render; adding an invoice row means
 *  switching to the [PHÍ CÓ HÓA ĐƠN] tab first. */
async function openInvoiceTab() {
  await act(async () => { fireEvent.click(screen.getByRole('tab', { name: 'PHÍ CÓ HÓA ĐƠN' })); });
}

async function addInvoiceRow() {
  await openInvoiceTab();
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
  fireEvent.change(within(block(blockName)).getByLabelText(/Số tiền \(VNĐ\)/), { target: { value } });
}

/** SIL-834: Số hóa đơn is Tùy chọn — submit-driving cases fill it only to
 *  prove the payload, never to unblock Lưu. */
async function fillInvoiceNumber(blockName: string, value: string) {
  fireEvent.change(within(block(blockName)).getByLabelText(/^Số hóa đơn/), { target: { value } });
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
  authState.role = null;
  api.getExpenseTypes.mockResolvedValue(types);
  api.getExpensePhotos.mockResolvedValue({ items: [] });
  api.getContainerClaimants.mockResolvedValue([]);
  api.createExpense.mockResolvedValue(entry);
  api.createExpenseType.mockResolvedValue({ item: types.items[0], created: true });
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
    // Ticket 18/11 Task 4.1 — a no-invoice row requires an explicit Số
    // container, so the payload pin rides cont 33 (lot-scope serialization
    // stays pinned on the invoice tab in A2).
    await pickContainers('TGHU1234567');
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
      shipmentContainerId: 33,
      invoiceNumber: null,
      photoStorageKeys: [],
    });
  });

  it('B2 (SIL-777): a no-charge row saves WITHOUT Ghi chú — the old note gate is gone', async () => {
    await show();
    await pickContainers('TGHU1234567'); // Ticket 18/11 Task 4.1 — no-invoice rows need an explicit cont.
    await chooseType('Phí không hóa đơn', 'Chi công nhân');
    await fillAmount('Phí không hóa đơn', '80000');
    const save = screen.getByRole('button', { name: 'Lưu' }) as HTMLButtonElement;
    // SIL-777 (owner 09/11/2026) reverses SIL-723's "không thu khách → bắt
    // buộc ghi chú": Loại phí + Số tiền alone open Lưu and no gate notice
    // renders on the row hint or the footer.
    expect(save).toBeEnabled();
    expect(screen.queryAllByText('Dòng chi này không thu khách hàng — bắt buộc nhập trường "Ghi chú".')).toHaveLength(0);
    // A row WITH a note still saves as before (the field stays functional).
    await fillNote('Phí không hóa đơn', 'Không thu khách — phí nội bộ');
    expect(save).toBeEnabled();
    fireEvent.submit(save.form!);
    await waitFor(() => expect(api.createExpense).toHaveBeenCalledTimes(1));
    expect(api.createExpense.mock.calls[0][0]).toMatchObject({ amount: '80000', note: 'Không thu khách — phí nội bộ' });
  });

  it('B3 (SIL-834): the invoice block treats "Số hóa đơn" as Tùy chọn — an empty number saves', async () => {
    await show();
    await addInvoiceRow();
    await chooseType('Phí có hóa đơn', 'Phí soi chiếu');
    await fillAmount('Phí có hóa đơn', '450000');
    const save = screen.getByRole('button', { name: 'Lưu' }) as HTMLButtonElement;
    // Spec Rev2 Task 2.1.3 ("Input Số HĐ (Tùy chọn)"): no gate, no disabled
    // Lưu, and the label itself says "(Tùy chọn)".
    expect(within(block('Phí có hóa đơn')).getByLabelText(/^Số hóa đơn \(Tùy chọn\)/)).toBeInTheDocument();
    expect(save).toBeEnabled();
    expect(screen.queryByText(/bắt buộc có số hóa đơn/)).toBeNull();
    fireEvent.submit(save.form!);
    await waitFor(() => expect(api.createExpense).toHaveBeenCalledTimes(1));
    expect(api.createExpense.mock.calls[0][0]).toMatchObject({ amount: '450000', invoiceNumber: null });
  });

  it('B4: the no-invoice block never demands Số hóa đơn (KB: chỉ nhóm có hóa đơn)', async () => {
    await show();
    await chooseType('Phí không hóa đơn', 'Chi công nhân');
    await fillAmount('Phí không hóa đơn', '50000');
    await fillNote('Phí không hóa đơn', 'Chi áp ván');
    // Ticket 18/11 Task 4.1 — the Số-container gate blocks lot-scope first:
    // Lưu stays dead with the footer naming the missing scope.
    expect(screen.getByRole('button', { name: 'Lưu' })).toBeDisabled();
    expect(screen.getByText('Bắt buộc chọn Số container')).toBeInTheDocument();
    await pickContainers('TGHU1234567');
    expect(screen.getByRole('button', { name: 'Lưu' }).getAttribute('disabled')).toBeNull();
    expect(screen.queryByText(/Số hóa đơn/)).toBeNull();
  });
});

// SIL-760 — the two groups live on centered tabs and ONE shared Lưu: drafts
// typed on each tab survive every switch, and one submit gathers both tabs.
describe('ops expense form — tabs + shared save (SIL-760)', { timeout: 20_000 }, () => {
  it('C1: rows survive tab switches in both directions', async () => {
    await show();
    await chooseType('Phí không hóa đơn', 'Chi công nhân');
    await fillAmount('Phí không hóa đơn', '80000');
    await fillNote('Phí không hóa đơn', 'Chi công nhân dỡ hàng');

    await addInvoiceRow();
    // The no-invoice region is unmounted with its tab — only invoice rows show.
    expect(screen.queryByRole('region', { name: 'Phí không hóa đơn' })).toBeNull();
    await chooseType('Phí có hóa đơn', 'Phí soi chiếu');
    await fillAmount('Phí có hóa đơn', '450000');
    await fillInvoiceNumber('Phí có hóa đơn', 'TD-20260923-001');

    await act(async () => { fireEvent.click(screen.getByRole('tab', { name: 'PHÍ KHÔNG HÓA ĐƠN' })); });
    expect(screen.getByLabelText(/Số tiền \(VNĐ\)/)).toHaveValue('80.000');
    expect(screen.getByLabelText('Ghi chú')).toHaveValue('Chi công nhân dỡ hàng');
    await openInvoiceTab();
    expect(within(block('Phí có hóa đơn')).getByLabelText(/Số tiền \(VNĐ\)/)).toHaveValue('450.000');
    expect(within(block('Phí có hóa đơn')).getByLabelText(/^Số hóa đơn/)).toHaveValue('TD-20260923-001');
  });

  it('C2: one Lưu gathers rows from BOTH tabs in one submit', async () => {
    await show();
    await pickContainers('TGHU1234567'); // Ticket 18/11 Task 4.1 — the no-invoice row rides cont 33.
    await chooseType('Phí không hóa đơn', 'Chi công nhân');
    await fillAmount('Phí không hóa đơn', '80000');
    await fillNote('Phí không hóa đơn', 'Chi công nhân dỡ hàng');
    await addInvoiceRow();
    await chooseType('Phí có hóa đơn', 'Phí soi chiếu');
    await fillAmount('Phí có hóa đơn', '450000');
    await fillInvoiceNumber('Phí có hóa đơn', 'TD-20260923-001');

    const save = screen.getByRole('button', { name: 'Lưu' }) as HTMLButtonElement;
    expect(save).toBeEnabled();
    fireEvent.submit(save.form!);
    await waitFor(() => expect(api.createExpense).toHaveBeenCalledTimes(2));
    expect(api.createExpense.mock.calls[0][0]).toMatchObject({ expenseTypeCode: 'CONG_NHAN', amount: '80000' });
    expect(api.createExpense.mock.calls[1][0]).toMatchObject({ expenseTypeCode: 'SOI_CHIEU', amount: '450000', invoiceNumber: 'TD-20260923-001', invoiceDate: null });
  });
});

// SIL-761 — an OPS viewer (hoangnh, legacy FORWARDER folded by getModernRole)
// never sees the thu-khách pair: no Thực thu cell, no Ghi-chú-thu-khách cell,
// no hint naming Thực thu. Non-Ops viewers of the same popup keep them.
describe('ops expense form — thu-khách visibility by role (SIL-761)', { timeout: 20_000 }, () => {
  it('C3: Ops viewer sees neither field anywhere in the popup and still saves', async () => {
    authState.role = 'OPS';
    await show();
    // Whole-popup scan for the forbidden strings (acceptance: tìm toàn bộ popup).
    expect(screen.queryByText(/Thực thu/)).toBeNull();
    expect(screen.queryByLabelText('Thực thu (thu khách)')).toBeNull();
    expect(screen.queryByLabelText('Ghi chú thu khách')).toBeNull();
    // The no-customer-charge hint no longer references the hidden field.
    expect(screen.queryByText(/Thực thu để trống/)).toBeNull();

    await pickContainers('TGHU1234567'); // Ticket 18/11 Task 4.1 — no-invoice rows need an explicit cont.
    await chooseType('Phí không hóa đơn', 'Chi công nhân');
    await fillAmount('Phí không hóa đơn', '80000');
    await fillNote('Phí không hóa đơn', 'Chi công nhân dỡ hàng');
    const save = screen.getByRole('button', { name: 'Lưu' }) as HTMLButtonElement;
    expect(save).toBeEnabled();
    fireEvent.submit(save.form!);
    await waitFor(() => expect(api.createExpense).toHaveBeenCalledTimes(1));
    // The server derives charge 0 from the omitted override; no recovery note.
    expect(api.createExpense.mock.calls[0][0]).toMatchObject({
      expenseTypeCode: 'CONG_NHAN',
      amount: '80000',
      note: 'Chi công nhân dỡ hàng',
      customerChargeAmount: undefined,
      recoveryNote: null,
    });
  });

  it('C4: a non-Ops viewer of the same popup keeps the thu-khách pair', async () => {
    authState.role = 'CUS';
    await show();
    await chooseType('Phí không hóa đơn', 'Chi công nhân');
    expect(screen.getByLabelText('Thực thu (thu khách)')).toBeInTheDocument();
    expect(screen.getByLabelText('Ghi chú thu khách')).toBeInTheDocument();
  });

  it('C5: a legacy FORWARDER account reads as Ops (fields hidden)', async () => {
    authState.role = 'FORWARDER';
    await show();
    expect(screen.queryByLabelText('Thực thu (thu khách)')).toBeNull();
    expect(screen.queryByLabelText('Ghi chú thu khách')).toBeNull();
  });
});

// SIL-813 — the creatable catalog: Ops gõ tên loại phí MỚI chưa có trong
// danh mục; Lưu ghi loại phí mới vào danh mục của nhóm tương ứng (Phí có hóa
// đơn / Phí không hóa đơn) để các lần sau có sẵn trong dropdown.
/** The Loại phí control flips shape with catalog size (≤4 options render the
 *  button trigger, ≥5 the type-to-search combobox) — read the selected label
 *  off whichever shape is live. The row's own '+ Thêm loại phí mới' button
 *  also matches /Loại phí/, so it is excluded by its text. */
function selectedTypeLabel(row: HTMLElement): string {
  const trigger = within(row).queryAllByRole('button', { name: /Loại phí/ })
    .find((candidate) => !candidate.textContent?.includes('Thêm loại phí mới'));
  if (trigger) return trigger.textContent ?? '';
  const combo = within(row).getByRole('combobox', { name: /Loại phí/ });
  return (combo as HTMLInputElement).value || combo.textContent || '';
}

describe('ops expense form — creatable loại phí (SIL-813)', { timeout: 20_000 }, () => {
  it('D1: a typed new fee name persists into the no-invoice group and selects itself', async () => {
    const created = { item: { id: 6, code: 'RUT_CONT', name: 'Phí rút cont', requiresInvoice: false, category: null }, created: true };
    api.createExpenseType.mockResolvedValue(created);
    api.getExpenseTypes.mockImplementation(async () => ({ items: [...types.items, created.item] }));
    await show();
    const row = block('Phí không hóa đơn');
    await act(async () => { fireEvent.click(within(row).getByRole('button', { name: '+ Thêm loại phí mới' })); });
    fireEvent.change(await screen.findByLabelText('Tên loại phí mới'), { target: { value: 'Phí rút cont' } });
    await act(async () => { fireEvent.click(within(row).getByRole('button', { name: 'Thêm' })); });
    await waitFor(() => expect(api.createExpenseType).toHaveBeenCalledWith({ name: 'Phí rút cont', requiresInvoice: false }));
    // After the catalog refetch the row's select reads the new type.
    await waitFor(() => expect(selectedTypeLabel(row)).toContain('Phí rút cont'));
    expect(screen.queryByLabelText('Tên loại phí mới')).toBeNull();
  });

  it('D2: the invoice tab files the new type under Phí có hóa đơn', async () => {
    const created = { item: { id: 7, code: 'PHI_KIEM_HOA_DP', name: 'Phí kiểm hóa hạ', requiresInvoice: true, category: 'DROP' }, created: true };
    api.createExpenseType.mockResolvedValue(created);
    api.getExpenseTypes.mockImplementation(async () => ({ items: [...types.items, created.item] }));
    await show();
    await addInvoiceRow();
    const row = block('Phí có hóa đơn');
    await act(async () => { fireEvent.click(within(row).getByRole('button', { name: '+ Thêm loại phí mới' })); });
    fireEvent.change(await screen.findByLabelText('Tên loại phí mới'), { target: { value: 'Phí kiểm hóa hạ' } });
    await act(async () => { fireEvent.click(within(row).getByRole('button', { name: 'Thêm' })); });
    await waitFor(() => expect(api.createExpenseType).toHaveBeenCalledWith({ name: 'Phí kiểm hóa hạ', requiresInvoice: true }));
    await waitFor(() => expect(selectedTypeLabel(row)).toContain('Phí kiểm hóa hạ'));
  });

  it('D3: a name the catalog already has selects it with the honest toast, no duplicate', async () => {
    api.createExpenseType.mockResolvedValue({ item: types.items[3], created: false });
    await show();
    const row = block('Phí không hóa đơn');
    await act(async () => { fireEvent.click(within(row).getByRole('button', { name: '+ Thêm loại phí mới' })); });
    fireEvent.change(await screen.findByLabelText('Tên loại phí mới'), { target: { value: 'chi công nhân' } });
    await act(async () => { fireEvent.click(within(row).getByRole('button', { name: 'Thêm' })); });
    await waitFor(() => expect(api.createExpenseType).toHaveBeenCalledWith({ name: 'chi công nhân', requiresInvoice: false }));
    await screen.findByText(/đã có trong danh mục/);
    await waitFor(() => expect(selectedTypeLabel(row)).toContain('Chi công nhân'));
  });
});

// SIL-844 (id 973, KH 15/11) — "đợt trước chọn được, đợt này không ấn được":
// the picker gated on the NUMBERED-only projection, so any lot whose container
// rows carry no số yet (the common dispatch-stage state — staging probe
// 16/11: 52/138 lots) rendered the whole picker disabled. The picker now
// reads the FULL `containers` row list: hạch toán theo cont đi bằng id, số
// đính kèm sau vẫn chọn được; lô CHƯA có dòng cont nào thì chung lô là scope
// đúng duy nhất và popup phải nói rõ thay vì khóa câm.
describe('ops expense form — mở khóa picker theo cont (SIL-844)', { timeout: 20_000 }, () => {
  beforeEach(() => { delete order.containers; });

  it('S1: cont chưa cập nhật số vẫn chọn được; chọn-tất-cả gán đúng khoản chi theo từng cont', async () => {
    order.containers = [{ id: 879, number: null }, { id: 880, number: 'TSTU4444444' }];
    await show();
    expect(screen.getByRole('checkbox', { name: 'Chọn tất cả số cont' })).toBeEnabled();
    await pickContainers('Cont 1 (chưa có số)', 'TSTU4444444');
    expect(screen.getByRole('button', { name: 'Đã chọn 2 số cont' }).getAttribute('title'))
      .toContain('Cont 1 (chưa có số), TSTU4444444');
    await chooseType('Phí không hóa đơn', 'Chi công nhân');
    await fillAmount('Phí không hóa đơn', '123000');
    const save = screen.getByRole('button', { name: 'Lưu' }) as HTMLButtonElement;
    expect(save).toBeEnabled();
    fireEvent.submit(save.form!);
    await waitFor(() => expect(api.createExpense).toHaveBeenCalledTimes(2));
    expect(api.createExpense.mock.calls[0][0]).toMatchObject({ shipmentContainerId: 879 });
    expect(api.createExpense.mock.calls[1][0]).toMatchObject({ shipmentContainerId: 880 });
  });

  it('S2: lô chưa có dòng cont nào — picker khóa kèm giải thích, không còn khóa câm', async () => {
    order.containers = [];
    await show();
    expect(screen.getByRole('checkbox', { name: 'Chọn tất cả số cont' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Đã chọn 1 số cont' })).toBeDisabled();
    expect(screen.getByText('Lô chưa có dòng cont để gắn chi phí — khoản ghi theo phạm vi chung lô.')).toBeInTheDocument();
  });
});

// Ticket 18/11 Task 4.1 — the PHÍ KHÔNG HÓA ĐƠN tab is HARD-GATED: an
// explicit Số container is required and the same cost TYPE may not repeat on
// the same cont (the write path hard-409s the family with no confirm
// bypass). The PHÍ CÓ HÓA ĐƠN tab keeps its warn-then-confirm law for TYPE
// repeats, hard-gates a duplicated Số hóa đơn in the DRAFT stage (SIL-861 —
// the write path's post-save bounce alone produced a partial save), and a
// duplicate already persisted on the lot still arrives as a hard 409 the
// popup cannot override.
describe('ops expense form — hard gates (ticket 18/11 Task 4.1)', { timeout: 20_000 }, () => {
  beforeEach(() => { delete order.containers; });

  /** A row-scoped type fill for the multi-row cases — the block-level helper
   *  matches every row's type trigger and would click the wrong one. */
  async function chooseRowType(row: HTMLElement, name: string) {
    const trigger = within(row).getByRole('button', { name: /Loại phí/ });
    await waitFor(() => expect(trigger).toBeEnabled());
    await act(async () => { fireEvent.click(trigger); });
    fireEvent.click(await screen.findByRole('option', { name }));
  }

  it('G1: saving a no-invoice row without an explicit Số container is blocked with the named error', async () => {
    await show();
    await chooseType('Phí không hóa đơn', 'Chi công nhân');
    await fillAmount('Phí không hóa đơn', '80000');
    const save = screen.getByRole('button', { name: 'Lưu' }) as HTMLButtonElement;
    expect(save).toBeDisabled();
    expect(screen.getByText('Bắt buộc chọn Số container')).toBeInTheDocument();
    fireEvent.submit(save.form!);
    expect(api.createExpense).not.toHaveBeenCalled();
    await pickContainers('TGHU1234567');
    expect(save).toBeEnabled();
    fireEvent.submit(save.form!);
    await waitFor(() => expect(api.createExpense).toHaveBeenCalledTimes(1));
    expect(api.createExpense.mock.calls[0][0]).toMatchObject({ expenseTypeCode: 'CONG_NHAN', shipmentContainerId: 33 });
  });

  it('G2: the same TYPE twice on the no-invoice tab is blocked until one row changes', async () => {
    await show();
    await pickContainers('TGHU1234567');
    await chooseType('Phí không hóa đơn', 'Chi công nhân');
    await fillAmount('Phí không hóa đơn', '80000');
    await act(async () => { fireEvent.click(within(block('Phí không hóa đơn')).getByRole('button', { name: '＋ Thêm chi phí' })); });
    const secondRow = screen.getByRole('region', { name: 'Khoản 2' });
    await chooseRowType(secondRow, 'Chi công nhân');
    fireEvent.change(within(secondRow).getByLabelText(/Số tiền \(VNĐ\)/), { target: { value: '50000' } });

    const save = screen.getByRole('button', { name: 'Lưu' }) as HTMLButtonElement;
    expect(save).toBeDisabled();
    expect(screen.getByText('Trùng loại phí "Chi công nhân" trên cùng số cont — không lưu dòng trùng.')).toBeInTheDocument();
    expect(screen.getAllByText('Trùng loại phí trên cùng số cont — không lưu dòng trùng.')).toHaveLength(2);
    fireEvent.submit(save.form!);
    expect(api.createExpense).not.toHaveBeenCalled();

    await chooseRowType(secondRow, 'Sửa tờ khai');
    expect(save).toBeEnabled();
    fireEvent.submit(save.form!);
    await waitFor(() => expect(api.createExpense).toHaveBeenCalledTimes(2));
    expect(api.createExpense.mock.calls[0][0]).toMatchObject({ expenseTypeCode: 'CONG_NHAN', shipmentContainerId: 33 });
    expect(api.createExpense.mock.calls[1][0]).toMatchObject({ expenseTypeCode: 'SUA_TO_KHAI', shipmentContainerId: 33 });
  });

  it('G3: PHÍ CÓ HÓA ĐƠN keeps multiple same-type rows saveable (warn-then-confirm unchanged)', async () => {
    api.createExpense.mockResolvedValue(entry);
    await show();
    await pickContainers('TGHU1234567');
    await addInvoiceRow();
    await chooseType('Phí có hóa đơn', 'Phí soi chiếu');
    await fillAmount('Phí có hóa đơn', '450000');
    await fillInvoiceNumber('Phí có hóa đơn', 'TD-20260923-001');
    await addInvoiceRow();
    const secondRow = screen.getByRole('region', { name: 'Khoản 2' });
    await chooseRowType(secondRow, 'Phí soi chiếu'); // same type again — the invoice tab allows it
    fireEvent.change(within(secondRow).getByLabelText(/Số tiền \(VNĐ\)/), { target: { value: '500000' } });
    fireEvent.change(within(secondRow).getByLabelText(/^Số hóa đơn/), { target: { value: 'TD-20260923-002' } });

    const save = screen.getByRole('button', { name: 'Lưu' }) as HTMLButtonElement;
    expect(save).toBeEnabled();
    fireEvent.submit(save.form!);
    await waitFor(() => expect(api.createExpense).toHaveBeenCalledTimes(2));
    expect(api.createExpense.mock.calls[0][0]).toMatchObject({ expenseTypeCode: 'SOI_CHIEU', shipmentContainerId: 33, invoiceNumber: 'TD-20260923-001' });
    expect(api.createExpense.mock.calls[1][0]).toMatchObject({ expenseTypeCode: 'SOI_CHIEU', shipmentContainerId: 33, invoiceNumber: 'TD-20260923-002' });
    expect(api.createExpense.mock.calls[0][0].duplicateConfirmed).toBeUndefined();
    expect(api.createExpense.mock.calls[1][0].duplicateConfirmed).toBeUndefined();
  });

  it('G4: a duplicate Số hóa đơn 409 surfaces as a hard error — no confirm bypass', async () => {
    api.createExpense.mockRejectedValueOnce(new ApiError(409, { code: 'OPS_EXPENSE_INVOICE_DUPLICATE' }, 'Số hóa đơn TD-20260923-001 đã tồn tại trên lô này.'));
    await show();
    await addInvoiceRow();
    await chooseType('Phí có hóa đơn', 'Phí soi chiếu');
    await fillAmount('Phí có hóa đơn', '450000');
    await fillInvoiceNumber('Phí có hóa đơn', 'TD-20260923-001');
    const save = screen.getByRole('button', { name: 'Lưu' }) as HTMLButtonElement;
    // The invoice tab is NOT container-gated: a lot-scope invoice row saves.
    expect(save).toBeEnabled();
    fireEvent.submit(save.form!);
    expect(await screen.findByText('Số hóa đơn TD-20260923-001 đã tồn tại trên lô này.')).toBeInTheDocument();
    expect(screen.queryByText(/NHẬP TRƯỚC ĐÓ/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Tiếp tục lưu' })).toBeNull();
    expect(api.createExpense).toHaveBeenCalledTimes(1);
  });

  // SIL-861 (QA build 09069560) — two invoice rows sharing one Số hóa đơn
  // used to save every sibling and bounce the duplicate only AFTER the write
  // ('Đã lưu 3 dòng. 1 dòng chưa lưu: …'), a partial save. The draft gate
  // kills it BEFORE Lưu in the same voice as the no-invoice duplicate type.
  it('G6 (SIL-861): the same Số hóa đơn twice on the invoice tab blocks BEFORE Lưu — inline + footer, Lưu disabled', async () => {
    await show();
    await addInvoiceRow();
    await chooseType('Phí có hóa đơn', 'Phí soi chiếu');
    await fillAmount('Phí có hóa đơn', '450000');
    await fillInvoiceNumber('Phí có hóa đơn', 'QAHĐ-001');
    await addInvoiceRow();
    const secondRow = screen.getByRole('region', { name: 'Khoản 2' });
    await chooseRowType(secondRow, 'Phí soi chiếu'); // same fee type stays allowed — only the NUMBER is unique
    fireEvent.change(within(secondRow).getByLabelText(/Số tiền \(VNĐ\)/), { target: { value: '100000' } });
    fireEvent.change(within(secondRow).getByLabelText(/^Số hóa đơn/), { target: { value: 'QAHĐ-001' } });

    const save = screen.getByRole('button', { name: 'Lưu' }) as HTMLButtonElement;
    expect(save).toBeDisabled();
    expect(screen.getByText('Trùng số hóa đơn "QAHĐ-001" — không lưu dòng trùng.')).toBeInTheDocument();
    expect(screen.getAllByText('Trùng số hóa đơn trên lô này — không lưu dòng trùng.')).toHaveLength(2);
    fireEvent.submit(save.form!);
    expect(api.createExpense).not.toHaveBeenCalled();

    // A distinct Số hóa đơn clears the gate; both rows save whole.
    fireEvent.change(within(secondRow).getByLabelText(/^Số hóa đơn/), { target: { value: 'QAHĐ-002' } });
    expect(save).toBeEnabled();
    api.createExpense.mockResolvedValue(entry);
    fireEvent.submit(save.form!);
    await waitFor(() => expect(api.createExpense).toHaveBeenCalledTimes(2));
    expect(api.createExpense.mock.calls[0][0]).toMatchObject({ invoiceNumber: 'QAHĐ-001' });
    expect(api.createExpense.mock.calls[1][0]).toMatchObject({ invoiceNumber: 'QAHĐ-002' });
  });

  it('G7 (SIL-861): distinct Số hóa đơn rows and empty (Tùy chọn) numbers never trip the gate', async () => {
    api.createExpense.mockResolvedValue(entry);
    await show();
    await addInvoiceRow();
    await chooseType('Phí có hóa đơn', 'Phí soi chiếu');
    await fillAmount('Phí có hóa đơn', '450000');
    await addInvoiceRow();
    const secondRow = screen.getByRole('region', { name: 'Khoản 2' });
    await chooseRowType(secondRow, 'Phí soi chiếu');
    fireEvent.change(within(secondRow).getByLabelText(/Số tiền \(VNĐ\)/), { target: { value: '100000' } });
    // Both Số hóa đơn left EMPTY — optional (SIL-834), never a duplicate.
    const save = screen.getByRole('button', { name: 'Lưu' }) as HTMLButtonElement;
    expect(save).toBeEnabled();
    expect(screen.queryByText(/Trùng số hóa đơn/)).toBeNull();
    fireEvent.submit(save.form!);
    await waitFor(() => expect(api.createExpense).toHaveBeenCalledTimes(2));
    expect(api.createExpense.mock.calls[0][0]).toMatchObject({ invoiceNumber: null });
    expect(api.createExpense.mock.calls[1][0]).toMatchObject({ invoiceNumber: null });
  });

  it('G5: a lot with NO container rows keeps the lot scope for no-invoice fees', async () => {
    order.containers = [];
    await show();
    await chooseType('Phí không hóa đơn', 'Chi công nhân');
    await fillAmount('Phí không hóa đơn', '80000');
    const save = screen.getByRole('button', { name: 'Lưu' }) as HTMLButtonElement;
    expect(save).toBeEnabled();
    expect(screen.getByText('Lô chưa có dòng cont để gắn chi phí — khoản ghi theo phạm vi chung lô.')).toBeInTheDocument();
    fireEvent.submit(save.form!);
    await waitFor(() => expect(api.createExpense).toHaveBeenCalledTimes(1));
    expect(api.createExpense.mock.calls[0][0]).toMatchObject({ expenseTypeCode: 'CONG_NHAN', shipmentContainerId: null });
  });
});
