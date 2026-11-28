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
// survives type/tab edits, a lot-wide submit serializes the EMPTY set =
// Phí chung lô (never Number("") = 0), picking containers declares the fee
// ONCE per picked SET (SIL-881 — no per-cont fan-out, amount never × cont
// count), and "Chọn tất cả" picks every container at once.
const api = vi.hoisted(() => ({ getExpenseTypes: vi.fn(), getExpensePhotos: vi.fn(), getContainerClaimants: vi.fn(), checkExpenseDuplicates: vi.fn(), createExpense: vi.fn(), updateExpense: vi.fn(), createExpenseType: vi.fn() }));
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

/** CR-010.1 (BUG-08): the invoice tab's Số hóa đơn is required — cases fill
 *  a real number to pass the gate (historically, to prove the payload). */
async function fillInvoiceNumber(blockName: string, value: string) {
  fireEvent.change(within(block(blockName)).getByLabelText(/^Số hóa đơn/), { target: { value } });
}

async function fillNote(blockName: string, value: string) {
  fireEvent.change(within(block(blockName)).getByLabelText('Ghi chú'), { target: { value } });
}

/** The Số-Cont picker helper. SIL-861 — the popup opens with every container
 *  pre-picked, so "pick these" first clears the set (clicking an
 *  already-picked option would toggle it OFF) and then ticks exactly the
 *  requested rows; no labels = the emptied scope. */
async function pickContainers(...labels: string[]) {
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /số cont/ })); });
  const popover = await screen.findByRole('dialog', { name: 'Chọn Phí chung lô' });
  fireEvent.click(within(popover).getByRole('button', { name: 'Bỏ chọn tất cả' }));
  const listbox = within(popover).getByRole('listbox');
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
  api.checkExpenseDuplicates.mockResolvedValue({ items: [] });
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
    // SIL-861 — opens with every container picked: the count is truthful and
    // 'Chọn tất cả' starts ticked.
    expect(screen.getByRole('button', { name: 'Đã chọn 2 số cont' }).getAttribute('title')).toContain('TGHU1234567, TGHU7654321');
    expect(screen.getByRole('checkbox', { name: 'Chọn tất cả số cont' })).toBeChecked();

    await pickContainers('TGHU1234567');
    expect(screen.getByRole('button', { name: 'Đã chọn 1 số cont' }).getAttribute('title')).toContain('TGHU1234567');

    await addInvoiceRow();
    await chooseType('Phí có hóa đơn', 'Phí soi chiếu');
    expect(screen.getByRole('button', { name: 'Đã chọn 1 số cont' }).getAttribute('title')).toContain('TGHU1234567');
  });

  it('A2 (SIL-861): the invoice tab refuses the chung-lô / emptied scope — the footer names the container gate, nothing serializes', async () => {
    await show();
    await addInvoiceRow();
    await chooseType('Phí có hóa đơn', 'Phí soi chiếu');
    await fillAmount('Phí có hóa đơn', '450000');
    await fillInvoiceNumber('Phí có hóa đơn', 'TD-20260923-001');
    const save = screen.getByRole('button', { name: 'Lưu' }) as HTMLButtonElement;
    // Default scope = the full container set — the complete row opens saveable.
    expect(save).toBeEnabled();
    // QA DEFECT A probe — Số Cont picker → "Bỏ chọn tất cả": the emptied
    // scope (like the explicit 'Phí chung lô' pick) is refused BEFORE Lưu
    // with the same voice as the no-invoice gate, and the submit writes
    // nothing (the old chung-lô invoice row is gone).
    await pickContainers();
    expect(save).toBeDisabled();
    expect(screen.getByText('Bắt buộc chọn Số container')).toBeInTheDocument();
    fireEvent.submit(save.form!);
    expect(api.createExpense).not.toHaveBeenCalled();
    // The legacy "choice → payload" mapping still never yields 0.
    expect(opsContainerId('LOT')).toBeNull();
    expect(opsContainerId('')).toBeNull();
    expect(opsContainerId('33')).toBe(33);
  });

  it('A3: picked containers declare the fee ONCE — one record carries the whole set, amount never × cont count', async () => {
    await show();
    await pickContainers('TGHU1234567', 'TGHU7654321');
    await addInvoiceRow();
    await chooseType('Phí có hóa đơn', 'Phí soi chiếu');
    await fillAmount('Phí có hóa đơn', '450000');
    await fillInvoiceNumber('Phí có hóa đơn', 'TD-20260923-001');
    const save = screen.getByRole('button', { name: 'Lưu' }) as HTMLButtonElement;
    expect(save).toBeEnabled();
    fireEvent.submit(save.form!);
    // SIL-881 — K conts + tổng X = ONE record with the picked set. The old
    // per-cont fan-out (2 records of 450000) multiplied money and is gone.
    await waitFor(() => expect(api.createExpense).toHaveBeenCalledTimes(1));
    expect(api.createExpense.mock.calls[0][0]).toMatchObject({ expenseTypeCode: 'SOI_CHIEU', amount: '450000' });
    expect(api.createExpense.mock.calls[0][0].shipmentContainerIds).toEqual([33, 44]);
  });

  it('A4: chọn tất cả toggles the whole set at once (SIL-861 default = all picked)', async () => {
    await show();
    // Opens all-picked, so the first toggle empties the per-container picks.
    fireEvent.click(screen.getByRole('checkbox', { name: 'Chọn tất cả số cont' }));
    expect(screen.getByRole('button', { name: 'Chọn số cont…' })).toBeInTheDocument();
    // Toggling again picks every container at once.
    fireEvent.click(screen.getByRole('checkbox', { name: 'Chọn tất cả số cont' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Đã chọn 2 số cont' }).getAttribute('title'))
      .toContain('TGHU1234567, TGHU7654321'));
  });

  it('A5: the claimant warning collapses to ONE line and the duplicate bounce pauses the ONE set record', async () => {
    // SIL-881 — N claimed conts print ONE grouped yellow line, not N lines.
    // OPS-01: the claimants carry their fee type — the banner surfaces only
    // same-type claims, so the mock claims the draft's own type (SOI_CHIEU).
    api.getContainerClaimants.mockResolvedValue([
      { containerId: 33, containerNumber: 'TGHU1234567', paidById: 2, paidByName: 'Ops khác', expenseTypeCode: 'SOI_CHIEU', expenseTypeName: 'Phí soi chiếu' },
      { containerId: 44, containerNumber: 'TGHU7654321', paidById: 2, paidByName: 'Ops khác', expenseTypeCode: 'SOI_CHIEU', expenseTypeName: 'Phí soi chiếu' },
    ]);
    api.createExpense.mockRejectedValueOnce(new ApiError(409, { code: 'OPS_EXPENSE_DUPLICATE', duplicates: [
      { id: 91, expenseTypeName: 'Phí nâng vỏ', amount: 1000, paidAt: '2026-10-01', containerNumber: null, containerNumbers: ['TGHU1234567', 'TGHU7654321'], paidById: 2, paidByName: 'Ops khác' },
    ] }, 'trùng'));
    await show();
    await pickContainers('TGHU1234567', 'TGHU7654321');
    await addInvoiceRow();
    await chooseType('Phí có hóa đơn', 'Phí soi chiếu');
    await fillAmount('Phí có hóa đơn', '450000');
    await fillInvoiceNumber('Phí có hóa đơn', 'TD-20260923-001');
    // 2 claimants → exactly ONE collapsed warning line grouping both conts,
    // phrased as the block it is (QA 28/11 F-B: no open question) and naming
    // the colliding fee type (OPS-01).
    const warnings = await screen.findAllByText(/hệ thống không cho phép lưu trùng/);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toHaveTextContent('Cont TGHU1234567, TGHU7654321 đã có Ops khác nhập Phí soi chiếu trước — hệ thống không cho phép lưu trùng.');
    expect(screen.queryByText(/bạn vẫn tiếp tục nhập chứ/)).not.toBeInTheDocument();
    const save = screen.getByRole('button', { name: 'Lưu' }) as HTMLButtonElement;
    expect(save).toBeEnabled();
    fireEvent.submit(save.form!);
    // The duplicate gate bounces the ONE set record: the panel names the hit
    // and prints its merged cont scope (role=alert is name-from-author, so
    // the panel is scoped by its text, not an accessible-name matcher).
    expect(await screen.findByText('CHI PHÍ CÙNG LOẠI ĐÃ ĐƯỢC NHẬP TRƯỚC ĐÓ')).toBeInTheDocument();
    const hitRow = await screen.findByText(/2 cont: TGHU1234567, TGHU7654321/);
    // SIL-1059 — the panel names the FEE TYPE first, then who paid it and when.
    expect(hitRow).toHaveTextContent('Phí nâng vỏ — đã có Ops khác nhập');
    expect(hitRow).toHaveTextContent('ngày 01/10/2026');
    expect(api.createExpense).toHaveBeenCalledTimes(1);
    expect(api.createExpense.mock.calls[0][0].shipmentContainerIds).toEqual([33, 44]);
    fireEvent.click(screen.getByRole('button', { name: 'Tiếp tục lưu' }));
    // 2 attempts total: the bounced send, then the SAME set record re-sent
    // confirmed — never a per-cont fan-out.
    await waitFor(() => expect(api.createExpense).toHaveBeenCalledTimes(2));
    expect(api.createExpense.mock.calls[1][0]).toMatchObject({ duplicateConfirmed: true, amount: '450000' });
    expect(api.createExpense.mock.calls[1][0].shipmentContainerIds).toEqual([33, 44]);
  });

  it('A6 (QA 28/11 F-B): the duplicate panel names ONLY the overlap between the picks and the saved row', async () => {
    // The payload's containerNumbers may still carry the user's full
    // selection (QA saw both picked conts named when only one had the saved
    // row) — the FE intersects it against the current picks.
    api.createExpense.mockRejectedValueOnce(new ApiError(409, { code: 'OPS_EXPENSE_DUPLICATE', duplicates: [
      { id: 91, expenseTypeName: 'Phí nâng vỏ', amount: 1000, paidAt: '2026-10-01', containerNumber: null, containerNumbers: ['TGHU1234567', 'TGHU7654321'], paidById: 2, paidByName: 'Ops khác' },
    ] }, 'trùng'));
    await show();
    // Only ONE of the two conts the saved row spans is picked now.
    await pickContainers('TGHU1234567');
    await addInvoiceRow();
    await chooseType('Phí có hóa đơn', 'Phí soi chiếu');
    await fillAmount('Phí có hóa đơn', '450000');
    await fillInvoiceNumber('Phí có hóa đơn', 'TD-20260923-002');
    fireEvent.submit((screen.getByRole('button', { name: 'Lưu' }) as HTMLButtonElement).form!);
    const hitRow = await screen.findByText(/đã có Ops khác nhập/);
    // The banner names ONLY the overlap, never the unpicked cont.
    expect(hitRow).toHaveTextContent('· TGHU1234567');
    expect(hitRow).not.toHaveTextContent('TGHU7654321');
  });

  it('A7 (OPS-01, 28/11 consolidated): a cont claimed under a DIFFERENT fee type never enters the headline', async () => {
    // QA saw the banner accuse QATU1128320 while only 8119 collided — the
    // claim on 8320 was for another type. V17: same type + same scope is the
    // conflict; the banner filters claimants to the draft's own types.
    api.getContainerClaimants.mockResolvedValue([
      { containerId: 33, containerNumber: 'TGHU1234567', paidById: 2, paidByName: 'Ops khác', expenseTypeCode: 'SOI_CHIEU', expenseTypeName: 'Phí soi chiếu' },
      { containerId: 44, containerNumber: 'TGHU7654321', paidById: 3, paidByName: 'Ops hai', expenseTypeCode: 'HACONT', expenseTypeName: 'Hàn cont' },
    ]);
    await show();
    await pickContainers('TGHU1234567', 'TGHU7654321');
    await addInvoiceRow();
    await chooseType('Phí có hóa đơn', 'Phí soi chiếu');
    await fillAmount('Phí có hóa đơn', '450000');
    // Only 33's same-type claim surfaces; 44's Hàn-cont claim stays out.
    const warnings = await screen.findAllByText(/hệ thống không cho phép lưu trùng/);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toHaveTextContent('Cont TGHU1234567');
    expect(warnings[0]).not.toHaveTextContent('TGHU7654321');
  });
});

// SIL-723 — the Lưu button must obey KB Chương 6 (bắt buộc tối thiểu = Loại +
// Số tiền, cộng Số hóa đơn thật trên block có hóa đơn — CR-010.1 BUG-08;
// ảnh biên lai tùy chọn) and never disable in silence: the blocked footer
// NAMES the missing field.
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
      invoiceNumber: null,
      photoStorageKeys: [],
    });
    // SIL-881 — the picked set rides the single record.
    expect(api.createExpense.mock.calls[0][0].shipmentContainerIds).toEqual([33]);
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

  it('B3 (CR-010.1 BUG-08): the invoice block demands a real Số hóa đơn — label *, empty blocks Lưu', async () => {
    await show();
    await addInvoiceRow();
    await chooseType('Phí có hóa đơn', 'Phí soi chiếu');
    await fillAmount('Phí có hóa đơn', '450000');
    const save = screen.getByRole('button', { name: 'Lưu' }) as HTMLButtonElement;
    // The label carries the required star; an empty number keeps Lưu dead and
    // the footer NAMES the missing field (SIL-723 never-disabled-in-silence).
    expect(within(block('Phí có hóa đơn')).getByLabelText(/^Số hóa đơn \*/)).toBeInTheDocument();
    expect(save).toBeDisabled();
    // The message lives twice: inline on the row and repeated by the footer.
    expect(screen.getAllByText('Số hóa đơn là bắt buộc với phí có hóa đơn.')).toHaveLength(2);
    fireEvent.submit(save.form!);
    expect(api.createExpense).not.toHaveBeenCalled();
    // A real number — ≥1 digit, SIL-870's own law; digitless text is
    // placeholder, not a number — re-opens Lưu and the row saves with it.
    await fillInvoiceNumber('Phí có hóa đơn', 'TD-20260923-001');
    expect(save).toBeEnabled();
    fireEvent.submit(save.form!);
    await waitFor(() => expect(api.createExpense).toHaveBeenCalledTimes(1));
    expect(api.createExpense.mock.calls[0][0]).toMatchObject({ amount: '450000', invoiceNumber: 'TD-20260923-001' });
  });

  it('B4: the no-invoice block never demands Số hóa đơn (KB: chỉ nhóm có hóa đơn)', async () => {
    await show();
    await chooseType('Phí không hóa đơn', 'Chi công nhân');
    await fillAmount('Phí không hóa đơn', '50000');
    await fillNote('Phí không hóa đơn', 'Chi áp ván');
    // SIL-861 default = all conts picked, so a valid row opens saveable; the
    // Số-container gate speaks only once the pick is emptied.
    expect(screen.getByRole('button', { name: 'Lưu' })).toBeEnabled();
    await pickContainers();
    // Ticket 18/11 Task 4.1 — the Số-container gate blocks lot-scope first:
    // Lưu stays dead with the footer naming the missing scope.
    expect(screen.getByRole('button', { name: 'Lưu' })).toBeDisabled();
    expect(screen.getByText('Bắt buộc chọn Số container')).toBeInTheDocument();
    await pickContainers('TGHU1234567');
    expect(screen.getByRole('button', { name: 'Lưu' }).getAttribute('disabled')).toBeNull();
    expect(screen.queryByText(/Số hóa đơn/)).toBeNull();
  });
});

// Tab determines invoice status exclusively: no 'Có hóa đơn' checkbox on either tab,
// 'Số hóa đơn *' is hidden on 'Phí không hóa đơn' and required on 'Phí có hóa đơn'.
describe('ops expense form — tab determines invoice flag (no Có hóa đơn checkbox)', { timeout: 20_000 }, () => {
  it('hides Có hóa đơn checkbox on both tabs; hides Số hóa đơn on no-invoice tab and requires it on invoice tab', async () => {
    await show();
    expect(within(block('Phí không hóa đơn')).queryByLabelText('Có hóa đơn')).toBeNull();
    expect(within(block('Phí không hóa đơn')).queryByLabelText(/^Số hóa đơn/)).toBeNull();
    await addInvoiceRow();
    expect(within(block('Phí có hóa đơn')).queryByLabelText('Có hóa đơn')).toBeNull();
    expect(within(block('Phí có hóa đơn')).getByLabelText(/^Số hóa đơn \*/)).toBeInTheDocument();
  });

  it('no-invoice tab saves without Số hóa đơn and sends hasInvoice: false, invoiceNumber: null', async () => {
    await show();
    await chooseType('Phí không hóa đơn', 'Chi công nhân');
    await fillAmount('Phí không hóa đơn', '80000');
    const save = screen.getByRole('button', { name: 'Lưu' }) as HTMLButtonElement;
    expect(save).toBeEnabled();
    fireEvent.submit(save.form!);
    await waitFor(() => expect(api.createExpense).toHaveBeenCalledTimes(1));
    expect(api.createExpense.mock.calls[0][0]).toMatchObject({ hasInvoice: false, invoiceNumber: null });
  });

  it('invoice tab blocks empty Số hóa đơn and sends hasInvoice: true when filled', async () => {
    await show();
    await addInvoiceRow();
    await chooseType('Phí có hóa đơn', 'Phí soi chiếu');
    await fillAmount('Phí có hóa đơn', '450000');
    const save = screen.getByRole('button', { name: 'Lưu' }) as HTMLButtonElement;
    expect(save).toBeDisabled();
    expect(screen.getAllByText('Số hóa đơn là bắt buộc với phí có hóa đơn.')).toHaveLength(2);
    await fillInvoiceNumber('Phí có hóa đơn', 'HD-01');
    expect(save).toBeEnabled();
    fireEvent.submit(save.form!);
    await waitFor(() => expect(api.createExpense).toHaveBeenCalledTimes(1));
    expect(api.createExpense.mock.calls[0][0]).toMatchObject({ hasInvoice: true, invoiceNumber: 'HD-01' });
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

  it('S1: cont chưa cập nhật số vẫn chọn được; chọn-tất-cả ghi 01 khoản chi cho cả tập cont', async () => {
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
    // SIL-881 — the whole picked set rides ONE record; 123000 is the total,
    // never 2 × 123000.
    await waitFor(() => expect(api.createExpense).toHaveBeenCalledTimes(1));
    expect(api.createExpense.mock.calls[0][0]).toMatchObject({ amount: '123000' });
    expect(api.createExpense.mock.calls[0][0].shipmentContainerIds).toEqual([879, 880]);
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
// bypass — the BE law stands; SIL-1059 r2 only makes the FE SURFACE the
// first bounce as the yellow question panel, and a confirmed resend the
// gate refuses again lands as the inline hard error). The PHÍ CÓ HÓA ĐƠN
// tab keeps its warn-then-confirm law for TYPE repeats, hard-gates a
// duplicated Số hóa đơn in the DRAFT stage (SIL-861 — the write path's
// post-save bounce alone produced a partial save), and a duplicate already
// persisted on the lot still arrives as a hard 409 the popup cannot
// override.
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
    await pickContainers(); // SIL-861 — the popup opens all-picked; empty it to reach the gated state.
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
    // SIL-881 — the save carries the picked set on one record.
    expect(api.createExpense.mock.calls[0][0]).toMatchObject({ expenseTypeCode: 'CONG_NHAN' });
    expect(api.createExpense.mock.calls[0][0].shipmentContainerIds).toEqual([33]);
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
    // SIL-881 — each row is ONE record carrying the picked set.
    expect(api.createExpense.mock.calls[0][0]).toMatchObject({ expenseTypeCode: 'CONG_NHAN' });
    expect(api.createExpense.mock.calls[0][0].shipmentContainerIds).toEqual([33]);
    expect(api.createExpense.mock.calls[1][0]).toMatchObject({ expenseTypeCode: 'SUA_TO_KHAI' });
    expect(api.createExpense.mock.calls[1][0].shipmentContainerIds).toEqual([33]);
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
    // SIL-881 — same-type invoice rows stay saveable; each row is ONE record
    // carrying the picked set.
    expect(api.createExpense.mock.calls[0][0]).toMatchObject({ expenseTypeCode: 'SOI_CHIEU', invoiceNumber: 'TD-20260923-001' });
    expect(api.createExpense.mock.calls[0][0].shipmentContainerIds).toEqual([33]);
    expect(api.createExpense.mock.calls[1][0]).toMatchObject({ expenseTypeCode: 'SOI_CHIEU', invoiceNumber: 'TD-20260923-002' });
    expect(api.createExpense.mock.calls[1][0].shipmentContainerIds).toEqual([33]);
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
    // SIL-861 — the default full-set scope keeps the row saveable; the 409
    // below is the hard duplicate, not the scope gate.
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
    // SIL-1059 — one sentence, shared by the two row hints and the footer.
    expect(screen.getAllByText('Trùng số hóa đơn trong cùng lần nhập — không thể lưu trùng.')).toHaveLength(3);
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

  it('G7 (SIL-861 + CR-010.1 BUG-08): empties trip the REQUIRED gate, never the duplicate gate; distinct numbers save', async () => {
    api.createExpense.mockResolvedValue(entry);
    await show();
    await addInvoiceRow();
    await chooseType('Phí có hóa đơn', 'Phí soi chiếu');
    await fillAmount('Phí có hóa đơn', '450000');
    await addInvoiceRow();
    const secondRow = screen.getByRole('region', { name: 'Khoản 2' });
    await chooseRowType(secondRow, 'Phí soi chiếu');
    fireEvent.change(within(secondRow).getByLabelText(/Số tiền \(VNĐ\)/), { target: { value: '100000' } });
    // Both Số hóa đơn left EMPTY — the CR-010.1 (BUG-08) required gate owns
    // that state (Lưu dead, footer names the field), NOT the duplicate gate.
    const save = screen.getByRole('button', { name: 'Lưu' }) as HTMLButtonElement;
    expect(save).toBeDisabled();
    expect(screen.queryByText(/Trùng số hóa đơn/)).toBeNull();
    // Two empty rows → the message lives inline on BOTH rows + the footer.
    expect(screen.getAllByText('Số hóa đơn là bắt buộc với phí có hóa đơn.')).toHaveLength(3);
    // Distinct real numbers clear it; neither row trips the duplicate gate.
    // Two invoice rows now match the label — target row 1 explicitly.
    fireEvent.change(within(block('Phí có hóa đơn')).getAllByLabelText(/^Số hóa đơn/)[0]!, { target: { value: 'QAHĐ-001' } });
    fireEvent.change(within(secondRow).getByLabelText(/^Số hóa đơn/), { target: { value: 'QAHĐ-002' } });
    expect(save).toBeEnabled();
    api.createExpense.mockResolvedValue(entry);
    fireEvent.submit(save.form!);
    await waitFor(() => expect(api.createExpense).toHaveBeenCalledTimes(2));
    expect(api.createExpense.mock.calls[0][0]).toMatchObject({ invoiceNumber: 'QAHĐ-001' });
    expect(api.createExpense.mock.calls[1][0]).toMatchObject({ invoiceNumber: 'QAHĐ-002' });
  });

  it('G5: a lot with NO container rows saves as chung-lô — the empty set, never null', async () => {
    order.containers = [];
    await show();
    await chooseType('Phí không hóa đơn', 'Chi công nhân');
    await fillAmount('Phí không hóa đơn', '80000');
    const save = screen.getByRole('button', { name: 'Lưu' }) as HTMLButtonElement;
    expect(save).toBeEnabled();
    expect(screen.getByText('Lô chưa có dòng cont để gắn chi phí — khoản ghi theo phạm vi chung lô.')).toBeInTheDocument();
    fireEvent.submit(save.form!);
    await waitFor(() => expect(api.createExpense).toHaveBeenCalledTimes(1));
    // SIL-881 — chung lô = empty set on the one record.
    expect(api.createExpense.mock.calls[0][0]).toMatchObject({ expenseTypeCode: 'CONG_NHAN' });
    expect(api.createExpense.mock.calls[0][0].shipmentContainerIds).toEqual([]);
    expect(api.createExpense.mock.calls[0][0].shipmentContainerId).toBeUndefined();
  });

  // SIL-861 (QA 23/11, build 6bcc081e) — the two re-opened defects, pinned.
  it('G8 (SIL-861 DEFECT A): invoice row + emptied Số Cont = footer "Bắt buộc chọn Số container" + Lưu disabled', async () => {
    await show();
    await addInvoiceRow();
    await chooseType('Phí có hóa đơn', 'Phí soi chiếu');
    await fillAmount('Phí có hóa đơn', '200000');
    await fillInvoiceNumber('Phí có hóa đơn', 'QAHĐ-861-D01');
    // QA probe: lot EHPH26080202 → Số Cont picker → "Bỏ chọn tất cả".
    await pickContainers();
    const save = screen.getByRole('button', { name: 'Lưu' }) as HTMLButtonElement;
    expect(save).toBeDisabled();
    expect(screen.getByText('Bắt buộc chọn Số container')).toBeInTheDocument();
    expect(screen.queryByText(/Trùng số hóa đơn/)).toBeNull();
    fireEvent.submit(save.form!);
    expect(api.createExpense).not.toHaveBeenCalled();
  });

  it('G9 (SIL-861 DEFECT B): default popup + one valid no-invoice row = no scope error, Lưu enabled, ONE record with the full set', async () => {
    await show();
    // The picker count is truthful from the first paint: both conts picked,
    // 'Chọn tất cả' ticked — display and validation agree at init.
    expect(screen.getByRole('button', { name: 'Đã chọn 2 số cont' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Chọn tất cả số cont' })).toBeChecked();
    await chooseType('Phí không hóa đơn', 'Chi công nhân');
    await fillAmount('Phí không hóa đơn', '100000');
    const save = screen.getByRole('button', { name: 'Lưu' }) as HTMLButtonElement;
    expect(save).toBeEnabled();
    expect(screen.queryByText('Bắt buộc chọn Số container')).toBeNull();
    fireEvent.submit(save.form!);
    await waitFor(() => expect(api.createExpense).toHaveBeenCalledTimes(1));
    // SIL-881 — the default scope is the FULL set on ONE record.
  });
});
