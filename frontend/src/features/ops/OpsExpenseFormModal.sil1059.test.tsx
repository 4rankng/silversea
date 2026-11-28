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

const api = vi.hoisted(() => ({ getExpenseTypes: vi.fn(), getExpensePhotos: vi.fn(), getContainerClaimants: vi.fn(), checkExpenseDuplicates: vi.fn(), createExpense: vi.fn(), updateExpense: vi.fn(), createExpenseType: vi.fn() }));
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
  api.checkExpenseDuplicates.mockResolvedValue({ items: [] });
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
  fireEvent.change(within(row).getByLabelText(/Số tiền \(₫\)/), { target: { value } });
}

async function addRow(blockName: string): Promise<HTMLElement> {
  const before = screen.queryAllByRole('region', { name: /^Khoản \d+$/ }).length;
  // QA 28/11 P2 — the single '+ Thêm chi phí' entry rides the tab band
  // (outside the block region); switch tab first so it adds to `blockName`.
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '＋ Thêm chi phí' })); });
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
  it('the amount box opens with the SIL-1240 default and the 0 hint placeholder', async () => {
    await show();
    const amount = within(screen.getByRole('region', { name: 'Khoản 1' })).getByLabelText(/Số tiền \(₫\)/) as HTMLInputElement;
    // SIL-1059's "opens empty" law is superseded by SIL-1240 (K5.34, 36aa1466):
    // the box opens pre-filled 1.000.000, while an untouched row still saves
    // as placeholder money (isEmptyDraft) — so the placeholder '0' hint stays.
    expect(amount.value).toBe('1.000.000');
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

  // The save promise is driven manually so the in-flight window and the
  // settle are each observed exactly, with no timers: the chosen fee name
  // must survive the whole pending save, and when the save settles the
  // control returns to a normal editable combobox with the name still shown.
  it('the chosen fee name survives the pending save and its settle into the duplicate question — combobox returns editable with the name still shown', async () => {
    const pendingSave = Promise.withResolvers<unknown>();
    api.createExpense.mockReturnValueOnce(pendingSave.promise);
    await show(wideTypes);
    const row = screen.getByRole('region', { name: 'Khoản 1' });
    await chooseFeeTypeIn(row, 'Phí nâng vỏ');
    fillAmount(row, '1500000');
    fireEvent.submit((screen.getByRole('button', { name: 'Lưu' }) as HTMLButtonElement).form!);

    await screen.findByText('Đang lưu 1/1…');
    expectVisibleFeeLabel(row, 'Phí nâng vỏ');
    expect(within(row).getByRole('combobox')).toBeDisabled();

    await act(async () => {
      pendingSave.reject(new ApiError(409, { code: 'OPS_EXPENSE_DUPLICATE', duplicates: [
        { id: 91, expenseTypeName: 'Phí nâng vỏ', amount: '1500000', paidAt: '2026-11-25', containerNumber: 'TGHU1234567', containerNumbers: ['TGHU1234567'], paidById: 2, paidByName: 'Trần Thiên Dương' },
      ] }, 'trùng'));
    });
    expect(await screen.findByText('CHI PHÍ CÙNG LOẠI ĐÃ ĐƯỢC NHẬP TRƯỚC ĐÓ')).toBeInTheDocument();
    expectVisibleFeeLabel(row, 'Phí nâng vỏ');
    expect(within(row).getByRole('combobox')).toBeEnabled();
  });

  it('the chosen fee name also survives a settle into a server refusal — inline error shown, name kept, control editable again', async () => {
    const pendingSave = Promise.withResolvers<unknown>();
    api.createExpense.mockReturnValueOnce(pendingSave.promise);
    await show(wideTypes);
    const row = screen.getByRole('region', { name: 'Khoản 1' });
    await chooseFeeTypeIn(row, 'Phí nâng vỏ');
    fillAmount(row, '1500000');
    fireEvent.submit((screen.getByRole('button', { name: 'Lưu' }) as HTMLButtonElement).form!);

    await screen.findByText('Đang lưu 1/1…');
    expectVisibleFeeLabel(row, 'Phí nâng vỏ');

    await act(async () => {
      pendingSave.reject(new ApiError(400, { code: 'PERIOD_CLOSED' }, 'Kỳ đã chốt — không lưu được khoản chi vào ngày đã khóa.'));
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('Kỳ đã chốt — không lưu được khoản chi vào ngày đã khóa.');
    expectVisibleFeeLabel(row, 'Phí nâng vỏ');
    expect(within(row).getByRole('combobox')).toBeEnabled();
  });
});

// SIL-1059 r2 (QA 26/11 build d568cbae, lô QBDP-2511-01 — phí "Đảo vỏ" 1.000 ₫,
// 2 cont, đã có Nguyễn Huy Hoàng nhập trước): the NO-INVOICE family's hard
// 409 (OPS_EXPENSE_TYPE_CONFLICT, Ticket 18/11 Task 4.1) used to fall through
// to the plain inline line — no yellow panel, no [Kiểm tra lại]/[Tiếp tục
// lưu], [Lưu] still enabled. The panel must open for BOTH duplicate codes;
// the BE hard law stays untouched.
describe('SIL-1059 r2 — the no-invoice hard bounce opens the same yellow panel', { timeout: 20_000 }, () => {
  const hardHits = [{ id: 92, expenseTypeName: 'Phí hạ vỏ', amount: '1000', paidAt: '2026-11-25', containerNumber: null, containerNumbers: ['TGHU1234567', 'TGHU7654321'], paidById: 3, paidByName: 'Nguyễn Huy Hoàng' }];

  it('the TYPE_CONFLICT 409 opens the panel naming the fee type first and locks [Lưu]', async () => {
    api.createExpense.mockRejectedValueOnce(new ApiError(409, { code: 'OPS_EXPENSE_TYPE_CONFLICT', duplicates: hardHits },
      'Loại phí này đã có Nguyễn Huy Hoàng nhập trước trên 2 cont: TGHU1234567, TGHU7654321 — phí không hóa đơn không cho phép lưu trùng trên cùng phạm vi.'));
    await show();
    const row = screen.getByRole('region', { name: 'Khoản 1' });
    await chooseFeeTypeIn(row, 'Phí hạ vỏ');
    fillAmount(row, '1000');
    const save = screen.getByRole('button', { name: 'Lưu' }) as HTMLButtonElement;
    expect(save).toBeEnabled();
    fireEvent.submit(save.form!);

    expect(await screen.findByText('CHI PHÍ CÙNG LOẠI ĐÃ ĐƯỢC NHẬP TRƯỚC ĐÓ')).toBeInTheDocument();
    const hit = await screen.findByText(/Phí hạ vỏ — đã có Nguyễn Huy Hoàng nhập/);
    expect(hit).toHaveTextContent('Phí hạ vỏ — đã có Nguyễn Huy Hoàng nhập 1.000 ₫ · ngày 25/11/2026 · 2 cont: TGHU1234567, TGHU7654321');
    await waitFor(() => expect(save).toBeDisabled());
    expect(screen.getByRole('button', { name: 'Kiểm tra lại' })).toBeInTheDocument();
    // QA 28/11 finding 07 — the hard gate never offers the override: the
    // panel names the overlapping containers and blocks instead.
    expect(screen.queryByRole('button', { name: 'Tiếp tục lưu' })).toBeNull();
    expect(screen.getByText(/không cho phép lưu trùng/)).toBeInTheDocument();
    // The open panel keeps the anti-double-send lock: a submit sends nothing.
    fireEvent.submit(save.form!);
    expect(api.createExpense).toHaveBeenCalledTimes(1);
  });

  it('the hard panel offers no override — only Kiểm tra lại closes it, no confirmed resend exists', async () => {
    api.createExpense.mockRejectedValueOnce(new ApiError(409, { code: 'OPS_EXPENSE_TYPE_CONFLICT', duplicates: hardHits },
      'Loại phí này đã có Nguyễn Huy Hoàng nhập trước trên 2 cont: TGHU1234567, TGHU7654321 — phí không hóa đơn không cho phép lưu trùng trên cùng phạm vi.'));
    await show();
    const row = screen.getByRole('region', { name: 'Khoản 1' });
    await chooseFeeTypeIn(row, 'Phí hạ vỏ');
    fillAmount(row, '1000');
    fireEvent.submit((screen.getByRole('button', { name: 'Lưu' }) as HTMLButtonElement).form!);
    await screen.findByText('CHI PHÍ CÙNG LOẠI ĐÃ ĐƯỢC NHẬP TRƯỚC ĐÓ');
    // QA 28/11 finding 07 — one attempt, one refusal, no override button: the
    // BE hard law is the FIRST and final answer, never a second confirmed send.
    expect(screen.queryByRole('button', { name: 'Tiếp tục lưu' })).toBeNull();
    expect(api.createExpense).toHaveBeenCalledTimes(1);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Kiểm tra lại' })); });
    expect(screen.queryByText('CHI PHÍ CÙNG LOẠI ĐÃ ĐƯỢC NHẬP TRƯỚC ĐÓ')).toBeNull();
    expect(api.createExpense).toHaveBeenCalledTimes(1);
  });
});

// SIL-1059 r3 (re-open 27/11, same recipe as QA 8574 — lô 1221, "Đảo vỏ"
// 1.000 ₫ trên 2 cont): filling fee + amount must ALREADY show the yellow
// panel, BEFORE any [Lưu] click. The panel used to open only on the write
// path's 409, so the operator kept saving into the bounce. The pre-save probe
// (GET /ops/expenses/duplicate-check) answers from the same live rows the
// write gate checks; the 409 law stays untouched as the backstop.
describe('SIL-1059 r3 — the pre-save probe opens the yellow panel before any submit', { timeout: 20_000 }, () => {
  const hit = (id: number, typeName: string) => ({
    id,
    expenseTypeName: typeName,
    amount: '1000',
    paidAt: '2026-11-25',
    containerNumber: null,
    containerNumbers: ['TGHU1234567', 'TGHU7654321'],
    paidById: 3,
    paidByName: 'Nguyễn Huy Hoàng',
  });

  it('a duplicate fee type opens the panel while the operator is still filling the form', async () => {
    api.checkExpenseDuplicates.mockResolvedValue({ items: [{ expenseTypeCode: 'NANG_VO', duplicates: [hit(1221, 'Phí nâng vỏ')] }] });
    await show();
    const row = screen.getByRole('region', { name: 'Khoản 1' });
    await chooseFeeTypeIn(row, 'Phí nâng vỏ');
    fillAmount(row, '1000');

    // The probe asked the write gate's exact question up front: fee type +
    // the picked cont set, no submit involved.
    expect(api.checkExpenseDuplicates).toHaveBeenCalledWith(8, ['NANG_VO'], [33, 44]);
    expect(await screen.findByText('CHI PHÍ CÙNG LOẠI ĐÃ ĐƯỢC NHẬP TRƯỚC ĐÓ')).toBeInTheDocument();
    const line = await screen.findByText(/Phí nâng vỏ — đã có Nguyễn Huy Hoàng nhập/);
    expect(line).toHaveTextContent('Phí nâng vỏ — đã có Nguyễn Huy Hoàng nhập 1.000 ₫ · ngày 25/11/2026 · 2 cont: TGHU1234567, TGHU7654321');
    // AC: hộp trùng nêu tên loại phí + khóa [Lưu] — trước khi lưu.
    const save = screen.getByRole('button', { name: 'Lưu' }) as HTMLButtonElement;
    await waitFor(() => expect(save).toBeDisabled());
    expect(screen.getByText(/Hộp cảnh báo trùng phí đang mở/)).toBeInTheDocument();
    expect(api.createExpense).not.toHaveBeenCalled();
  });

  it('a non-duplicate fee type leaves the form alone', async () => {
    api.checkExpenseDuplicates.mockResolvedValue({ items: [{ expenseTypeCode: 'NANG_VO', duplicates: [] }] });
    await show();
    const row = screen.getByRole('region', { name: 'Khoản 1' });
    await chooseFeeTypeIn(row, 'Phí nâng vỏ');
    fillAmount(row, '1000');
    await waitFor(() => expect(api.checkExpenseDuplicates).toHaveBeenCalled());
    expect(screen.queryByText('CHI PHÍ CÙNG LOẠI ĐÃ ĐƯỢC NHẬP TRƯỚC ĐÓ')).toBeNull();
    expect(screen.getByRole('button', { name: 'Lưu' })).toBeEnabled();
  });

  it('[Kiểm tra lại] closes the pre-save panel, re-asks the probe, and hands [Lưu] back', async () => {
    api.checkExpenseDuplicates.mockResolvedValue({ items: [{ expenseTypeCode: 'NANG_VO', duplicates: [hit(1221, 'Phí nâng vỏ')] }] });
    await show();
    const row = screen.getByRole('region', { name: 'Khoản 1' });
    await chooseFeeTypeIn(row, 'Phí nâng vỏ');
    fillAmount(row, '1000');
    await screen.findByText('CHI PHÍ CÙNG LOẠI ĐÃ ĐƯỢC NHẬP TRƯỚC ĐÓ');

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Kiểm tra lại' })); });
    expect(screen.queryByText('CHI PHÍ CÙNG LOẠI ĐÃ ĐƯỢC NHẬP TRƯỚC ĐÓ')).toBeNull();
    expect(screen.getByRole('button', { name: 'Lưu' })).toBeEnabled();
    await waitFor(() => expect(api.checkExpenseDuplicates).toHaveBeenCalledTimes(2));
  });

  it('a pre-save no-invoice duplicate BLOCKS: no override offer, no write at all', async () => {
    api.checkExpenseDuplicates.mockResolvedValue({ items: [{ expenseTypeCode: 'HA_VO', duplicates: [hit(1221, 'Phí hạ vỏ')] }] });
    await show();
    const row = screen.getByRole('region', { name: 'Khoản 1' });
    await chooseFeeTypeIn(row, 'Phí hạ vỏ');
    fillAmount(row, '1000');
    await screen.findByText('CHI PHÍ CÙNG LOẠI ĐÃ ĐƯỢC NHẬP TRƯỚC ĐÓ');

    // QA 28/11 finding 07 — the no-invoice duplicate is the hard gate: the
    // panel blocks (Kiểm tra lại only), [Lưu] stays locked, and no write is
    // ever attempted (the BE would refuse a confirmed resend anyway).
    expect(screen.queryByRole('button', { name: 'Tiếp tục lưu' })).toBeNull();
    expect(screen.getByText(/không cho phép lưu trùng/)).toBeInTheDocument();
    const save = screen.getByRole('button', { name: 'Lưu' }) as HTMLButtonElement;
    expect(save).toBeDisabled();
    fireEvent.submit(save.form!);
    expect(api.createExpense).not.toHaveBeenCalled();
  });

  it('[Tiếp tục lưu] on a pre-save invoice duplicate writes the confirmed record and closes the dialog', async () => {
    api.checkExpenseDuplicates.mockResolvedValue({ items: [{ expenseTypeCode: 'SOI_CHIEU', duplicates: [hit(1222, 'Phí soi chiếu')] }] });
    const { close } = await show();
    await act(async () => { fireEvent.click(screen.getByRole('tab', { name: 'PHÍ CÓ HÓA ĐƠN' })); });
    const row = await addRow('Phí có hóa đơn');
    await chooseFeeTypeIn(row, 'Phí soi chiếu');
    fillAmount(row, '450000');
    fireEvent.change(within(row).getByLabelText(/^Số hóa đơn/), { target: { value: 'QAHĐ-3' } });
    await screen.findByText('CHI PHÍ CÙNG LOẠI ĐÃ ĐƯỢC NHẬP TRƯỚC ĐÓ');

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Tiếp tục lưu' })); });
    await waitFor(() => expect(api.createExpense).toHaveBeenCalledTimes(1));
    expect(api.createExpense.mock.calls[0][0]).toMatchObject({ duplicateConfirmed: true, expenseTypeCode: 'SOI_CHIEU' });
    await waitFor(() => expect(close).toHaveBeenCalled());
  });
});

// QA 28/11 F-A — the storage cap is 999.999.999.999 ₫: an amount typed above
// it must print the inline red message NEXT TO the field (the footer stays
// silent — HOT-07) and keep [Lưu] locked. The old cap
// 999.999.999.999.999 accepted a 1e12 ₫ save with no message at all.
describe('QA 28/11 F-A — amount above the storage cap blocks [Lưu]', { timeout: 20_000 }, () => {
  it('typing 1.000.000.000.000 ₫ shows the cap error and keeps [Lưu] locked', async () => {
    await show();
    const row = screen.getByRole('region', { name: 'Khoản 1' });
    await chooseFeeTypeIn(row, 'Phí nâng vỏ');
    fillAmount(row, '1000000000000');
    expect(await screen.findByText('Số tiền vượt mức tối đa 999.999.999.999 ₫')).toBeVisible();
    const save = screen.getByRole('button', { name: 'Lưu' }) as HTMLButtonElement;
    expect(save).toBeDisabled();
    fireEvent.submit(save.form!);
    expect(api.createExpense).not.toHaveBeenCalled();
  });

  it('999.999.999.999 ₫ is the last accepted amount — no error, [Lưu] enabled', async () => {
    await show();
    const row = screen.getByRole('region', { name: 'Khoản 1' });
    await chooseFeeTypeIn(row, 'Phí nâng vỏ');
    fillAmount(row, '999999999999');
    expect(screen.queryByText(/vượt mức tối đa/)).toBeNull();
    const save = screen.getByRole('button', { name: 'Lưu' }) as HTMLButtonElement;
    await waitFor(() => expect(save).toBeEnabled());
    fireEvent.submit(save.form!);
    await waitFor(() => expect(api.createExpense).toHaveBeenCalledTimes(1));
  });
});
