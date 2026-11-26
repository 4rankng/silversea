import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../components/shared/Toast';
import type { OpsOrderItem } from '../../api/opsClient';
import { ApiError } from '../../lib/api/errors';
import { OpsExpenseFormModal } from './OpsExpenseFormModal';

// SIL-1059 — the FE defects on the "Khai báo chi phí" popup that /ops/orders
// opens (ops hoangnh/duongtt, bookings YMJAW492344960 / EGLV149607019417 /
// NOSTC26HF67810):
//   (2) the yellow duplicate panel must LOCK the footer [Lưu] until the
//       operator answers it ([Kiểm tra lại] / [Tiếp tục lưu]) — the same
//       batch was sendable twice;
//   (3) the panel must NAME the fee type first, and the duplicate-invoice
//       sentence must name the rule it enforces;
//   (4) spec §10.6.3: the amount box shows a 0 HINT (never a 0 value), and
//       the Loại phí box keeps the chosen text while the control is disabled
//       during a save — never blank.
// The Bill/Booking one-line rule (spec §10.8.1) is a table-CSS law and is
// pinned in OpsOrdersPage.sil1059.styles.test.ts.

const api = vi.hoisted(() => ({ getExpenseTypes: vi.fn(), getExpensePhotos: vi.fn(), getContainerClaimants: vi.fn(), createExpense: vi.fn(), updateExpense: vi.fn(), createExpenseType: vi.fn() }));
vi.mock('../../api/opsClient', () => ({ opsClient: api }));
const authState = vi.hoisted(() => ({ role: null as string | null }));
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: authState.role == null ? null : { role: authState.role } }) }));

/** A WIDE catalog: the no-invoice tab then renders the type-to-search
 *  COMBOBOX (≥5 options) — the production shape on a real fee catalog. */
const wideTypes = { items: [
  { id: 1, code: 'SOI_CHIEU', name: 'Phí soi chiếu', requiresInvoice: true },
  { id: 2, code: 'KIEM_HOA', name: 'Phí kiểm hóa', requiresInvoice: true },
  { id: 3, code: 'BOC_XEP', name: 'Bốc xếp hàng', requiresInvoice: true },
  { id: 4, code: 'CONG_NHAN', name: 'Chi công nhân', requiresInvoice: false },
  { id: 5, code: 'SUA_TO_KHAI', name: 'Sửa tờ khai', requiresInvoice: false },
  { id: 6, code: 'NANG_VO', name: 'Phí nâng vỏ', requiresInvoice: false },
  { id: 7, code: 'HA_VO', name: 'Phí hạ vỏ', requiresInvoice: false },
] };

/** A NARROW catalog: the same control falls back to the plain click-to-open
 *  list (a button trigger) — the other shape the Loại phí box can take. */
const narrowTypes = { items: [
  { id: 1, code: 'SOI_CHIEU', name: 'Phí soi chiếu', requiresInvoice: true },
  { id: 4, code: 'CONG_NHAN', name: 'Chi công nhân', requiresInvoice: false },
  { id: 5, code: 'SUA_TO_KHAI', name: 'Sửa tờ khai', requiresInvoice: false },
] };

const order: OpsOrderItem = {
  id: 8, shipmentCode: 'SHP-20260923-0028', status: 'IN_PROGRESS', tradeDirection: 'IMPORT',
  billRef: 'YMLU8923410', customerName: 'Khách hàng', routeName: 'Hải Phòng', pinned: false, pinnedAt: null,
  containerCount: 2, containerNumbers: ['TGHU1234567', 'TGHU7654321'], containerIds: [33, 44],
};

beforeEach(() => {
  vi.resetAllMocks();
  authState.role = 'OPS';
  api.getExpenseTypes.mockResolvedValue(wideTypes);
  api.getExpensePhotos.mockResolvedValue({ items: [] });
  api.getContainerClaimants.mockResolvedValue([]);
  api.createExpense.mockResolvedValue({ id: 7 });
  api.createExpenseType.mockResolvedValue({ item: wideTypes.items[0], created: true });
});

async function show(catalog: { items: typeof wideTypes.items } = wideTypes) {
  api.getExpenseTypes.mockResolvedValue(catalog);
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

/** The Loại phí control flips shape when the catalog lands (a 1-option list
 *  becomes a type-to-search combobox), so every wait re-queries the LIVE
 *  control instead of holding a node that the swap unmounts. */
async function chooseFeeTypeIn(row: HTMLElement, name: string): Promise<void> {
  await waitFor(() => {
    const control = within(row).queryByRole('combobox')
      ?? within(row).queryByRole('button', { name: /Loại phí/ });
    expect(control).toBeEnabled();
  });
  const combo = within(row).queryByRole('combobox');
  if (combo) {
    await act(async () => { combo.focus(); fireEvent.click(combo); });
    fireEvent.click(await screen.findByRole('option', { name }));
    return;
  }
  const trigger = within(row).getByRole('button', { name: /Loại phí/ });
  await act(async () => { fireEvent.click(trigger); });
  fireEvent.click(await screen.findByRole('option', { name }));
}

function fillAmount(row: HTMLElement, value: string): void {
  fireEvent.change(within(row).getByLabelText(/Số tiền \(VNĐ\)/), { target: { value } });
}

async function addRow(blockName: string): Promise<HTMLElement> {
  const before = screen.queryAllByRole('region', { name: /^Khoản \d+$/ }).length;
  await act(async () => { fireEvent.click(within(block(blockName)).getByRole('button', { name: '＋ Thêm chi phí' })); });
  await waitFor(() => expect(screen.queryAllByRole('region', { name: /^Khoản \d+$/ })).toHaveLength(before + 1));
  return screen.queryAllByRole('region', { name: /^Khoản \d+$/ })[before]!;
}

/** The fee label the control PAINTS: the combobox mirrors its value into an
 *  overlay (the input itself is text-transparent), the plain select prints it
 *  inside the trigger. React Aria also keeps a hidden form <select> carrying
 *  the same labels, so the assertion is scoped to the painted control. */
function expectVisibleFeeLabel(row: HTMLElement, label: string): void {
  if (within(row).queryByRole('combobox')) {
    expect(within(row).getByText(label)).toBeVisible();
    return;
  }
  const trigger = within(row).getByRole('button', { name: /Loại phí/ });
  expect(within(trigger).getByText(label)).toBeVisible();
}

describe('SIL-1059 — duplicate panel locks [Lưu] and names the fee type', { timeout: 20_000 }, () => {
  it('names the fee type first and locks [Lưu] until the operator answers the panel', async () => {
    api.createExpense.mockRejectedValueOnce(new ApiError(409, { code: 'OPS_EXPENSE_DUPLICATE', duplicates: [
      { id: 91, expenseTypeName: 'Phí nâng vỏ', amount: '1500000', paidAt: '2026-11-25', containerNumber: 'TGHU1234567', containerNumbers: ['TGHU1234567'], paidById: 2, paidByName: 'Trần Thiên Dương' },
    ] }, 'trùng'));
    await show();
    const row = screen.getByRole('region', { name: 'Khoản 1' });
    await chooseFeeTypeIn(row, 'Phí nâng vỏ');
    fillAmount(row, '1500000');
    const save = screen.getByRole('button', { name: 'Lưu' }) as HTMLButtonElement;
    expect(save).toBeEnabled();
    fireEvent.submit(save.form!);

    // (3) The panel names the FEE TYPE first, then who paid it and when.
    expect(await screen.findByText('CHI PHÍ CÙNG LOẠI ĐÃ ĐƯỢC NHẬP TRƯỚC ĐÓ')).toBeInTheDocument();
    const hit = await screen.findByText(/Phí nâng vỏ — đã có Trần Thiên Dương nhập/);
    expect(hit).toHaveTextContent('Phí nâng vỏ — đã có Trần Thiên Dương nhập 1.500.000 ₫ · ngày 25/11/2026 · TGHU1234567');

    // (2) [Lưu] is locked while the question is open, and the reason is said.
    await waitFor(() => expect(save).toBeDisabled());
    expect(screen.getByText(/Hộp cảnh báo trùng phí đang mở/)).toBeInTheDocument();
    // A submit while the panel is open must not send the batch a second time.
    fireEvent.submit(save.form!);
    expect(api.createExpense).toHaveBeenCalledTimes(1);

    // [Kiểm tra lại] closes the question and hands [Lưu] back.
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Kiểm tra lại' })); });
    expect(save).toBeEnabled();
    expect(screen.queryByText('CHI PHÍ CÙNG LOẠI ĐÃ ĐƯỢC NHẬP TRƯỚC ĐÓ')).toBeNull();
  });

  it('[Tiếp tục lưu] still writes the confirmed record while the panel is open', async () => {
    api.createExpense.mockRejectedValueOnce(new ApiError(409, { code: 'OPS_EXPENSE_DUPLICATE', duplicates: [
      { id: 91, expenseTypeName: 'Phí nâng vỏ', amount: '1500000', paidAt: '2026-11-25', containerNumber: 'TGHU1234567', containerNumbers: ['TGHU1234567'], paidById: 2, paidByName: 'Trần Thiên Dương' },
    ] }, 'trùng'));
    await show();
    const row = screen.getByRole('region', { name: 'Khoản 1' });
    await chooseFeeTypeIn(row, 'Phí nâng vỏ');
    fillAmount(row, '1500000');
    fireEvent.submit((screen.getByRole('button', { name: 'Lưu' }) as HTMLButtonElement).form!);
    await screen.findByText('CHI PHÍ CÙNG LOẠI ĐÃ ĐƯỢC NHẬP TRƯỚC ĐÓ');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Tiếp tục lưu' })); });
    await waitFor(() => expect(api.createExpense).toHaveBeenCalledTimes(2));
    expect(api.createExpense.mock.calls[1][0]).toMatchObject({ duplicateConfirmed: true, expenseTypeCode: 'NANG_VO' });
  });

  it('the duplicate-invoice sentence names the rule, on the row and in the footer', async () => {
    await show();
    await act(async () => { fireEvent.click(screen.getByRole('tab', { name: 'PHÍ CÓ HÓA ĐƠN' })); });
    const firstRow = await addRow('Phí có hóa đơn');
    await chooseFeeTypeIn(firstRow, 'Phí soi chiếu');
    fillAmount(firstRow, '450000');
    fireEvent.change(within(firstRow).getByLabelText(/^Số hóa đơn/), { target: { value: 'QAHĐ-001' } });
    const secondRow = await addRow('Phí có hóa đơn');
    await chooseFeeTypeIn(secondRow, 'Phí soi chiếu');
    fillAmount(secondRow, '100000');
    fireEvent.change(within(secondRow).getByLabelText(/^Số hóa đơn/), { target: { value: 'QAHĐ-001' } });

    const save = screen.getByRole('button', { name: 'Lưu' }) as HTMLButtonElement;
    expect(save).toBeDisabled();
    // One sentence, shared by the two row hints and the footer reason.
    expect(screen.getAllByText('Trùng số hóa đơn trong cùng lần nhập — không thể lưu trùng.')).toHaveLength(3);
  });
});

describe('SIL-1059 — spec §10.6.3: the amount box shows a 0 hint, the Loại phí box keeps its text', { timeout: 20_000 }, () => {
  it('the amount box opens empty with a 0 hint, never a 0 value', async () => {
    await show();
    const amount = within(screen.getByRole('region', { name: 'Khoản 1' })).getByLabelText(/Số tiền \(VNĐ\)/) as HTMLInputElement;
    expect(amount.value).toBe('');
    expect(amount.placeholder).toBe('0');
  });

  it('the Loại phí box keeps the chosen text while the control is disabled during a save (combobox shape)', async () => {
    api.createExpense.mockReturnValue(Promise.withResolvers<unknown>().promise);
    await show(wideTypes);
    const row = screen.getByRole('region', { name: 'Khoản 1' });
    await chooseFeeTypeIn(row, 'Phí nâng vỏ');
    fillAmount(row, '1500000');
    // A second row makes the progress read "Đang lưu 1/2…" — the state the
    // QA screenshot showed.
    const secondRow = await addRow('Phí không hóa đơn');
    await chooseFeeTypeIn(secondRow, 'Chi công nhân');
    fillAmount(secondRow, '80000');
    fireEvent.submit((screen.getByRole('button', { name: 'Lưu' }) as HTMLButtonElement).form!);

    await screen.findByText('Đang lưu 1/2…');
    expectVisibleFeeLabel(row, 'Phí nâng vỏ');
    // The control really is disabled — the text survives THAT state.
    expect(within(row).getByRole('combobox')).toBeDisabled();
  });

  it('the Loại phı box keeps the chosen text while the control is disabled during a save (button-trigger shape)', async () => {
    api.createExpense.mockReturnValue(Promise.withResolvers<unknown>().promise);
    await show(narrowTypes);
    const row = screen.getByRole('region', { name: 'Khoản 1' });
    await chooseFeeTypeIn(row, 'Chi công nhân');
    fillAmount(row, '80000');
    fireEvent.submit((screen.getByRole('button', { name: 'Lưu' }) as HTMLButtonElement).form!);

    await screen.findByText('Đang lưu 1/1…');
    expectVisibleFeeLabel(row, 'Chi công nhân');
    expect(within(row).getByRole('button', { name: /Loại phí/ })).toBeDisabled();
  });
});
