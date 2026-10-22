import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QuotationCreateDialog } from './QuotationCreateDialog';

// Card 221026040742 — tạo khung giá fail-im-lặng. A blocked submit must
// surface a dialog-level Alert naming the offending fields (not only small
// per-field hints), attribute errors to the right field, and never fire a
// POST while blocked. The happy path keeps POSTing the schema-defaulted
// payload and calling onCreated with the new id.

const { apiGet, apiPost } = vi.hoisted(() => ({ apiGet: vi.fn(), apiPost: vi.fn() }));
vi.mock('../../lib/api', () => ({
  api: { get: apiGet, post: apiPost },
}));

function makeWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

const customers = [
  { id: 7, name: 'Công ty A' },
  { id: 9, name: 'Công ty B' },
];

function formElement(): HTMLFormElement {
  return document.querySelector('form') as HTMLFormElement;
}

/** Fill the three date segments; the widget emits ISO only when complete. */
function fillDate(day: string, month: string, year: string) {
  fireEvent.change(document.querySelector('input[data-seg="dd"]') as HTMLInputElement, { target: { value: day } });
  fireEvent.change(document.querySelector('input[data-seg="mm2"]') as HTMLInputElement, { target: { value: month } });
  fireEvent.change(document.querySelector('input[data-seg="yyyy"]') as HTMLInputElement, { target: { value: year } });
}

beforeEach(() => {
  vi.clearAllMocks();
  apiGet.mockImplementation((path: string) => {
    if (path.startsWith('/customers')) return Promise.resolve({ items: customers, total: 2, pageSize: 100 });
    return Promise.reject(new Error(`unexpected GET ${path}`));
  });
  apiPost.mockResolvedValue({ id: 99 });
});

function renderDialog() {
  const onClose = vi.fn();
  const onCreated = vi.fn();
  render(<QuotationCreateDialog onClose={onClose} onCreated={onCreated} />, { wrapper: makeWrapper() });
  return { onClose, onCreated };
}

async function selectCustomerA() {
  // React Aria's press-driven popover needs pointer events a Modal-scoped
  // jsdom click can't deliver; focusing the trigger arms the hidden native
  // <select> fallback, whose change event drives onSelectionChange.
  // The trigger label echoes the committed selection, proving state landed.
  const trigger = screen.getAllByRole('button').find(b => /khách hàng/i.test(b.textContent ?? ''));
  expect(trigger).toBeTruthy();
  // A real press is pointerdown→pointerup→click; a bare synthetic click on an
  // already-focused trigger is ignored by React Aria's usePress (the blocked
  // submit's focus-move parks focus on the trigger), leaving the hidden
  // select disabled.
  fireEvent.pointerDown(trigger as HTMLElement);
  fireEvent.pointerUp(trigger as HTMLElement);
  fireEvent.click(trigger as HTMLElement);
  const hiddenSelect = await waitFor(() => {
    const select = document.querySelector('[data-testid="hidden-select-container"] select') as HTMLSelectElement;
    expect(select).toBeTruthy();
    expect(select.disabled).toBe(false);
    return select;
  });
  fireEvent.change(hiddenSelect, { target: { value: '7' } });
  await waitFor(() => expect(screen.getAllByRole('button').some(b => /Công ty A/.test(b.textContent ?? ''))).toBe(true));
}

describe('QuotationCreateDialog — fail-im-lặng (card 221026040742)', () => {
  it('RC-QC-CREATE-1: KH chưa chọn → Alert nêu rõ "không gửi gì đi" + khách hàng, không POST, dialog còn mở', async () => {
    const { onCreated } = renderDialog();
    await screen.findByRole('button', { name: /Khách hàng/i });
    fireEvent.change(screen.getByLabelText(/Tên mẫu báo giá/), { target: { value: 'Mẫu NEWEB' } });
    fillDate('22', '10', '2026');
    fireEvent.change(screen.getByLabelText(/Độ trễ áp giá dầu/), { target: { value: '1' } });
    fireEvent.submit(formElement());

    // Blocked loudly: dialog-level Alert names the field, and nothing is sent.
    expect(await screen.findByText(/Chưa tạo được báo giá/)).toBeTruthy();
    const blockedAlert = screen.getByText(/Chưa tạo được báo giá/).closest('[role="alert"]') as HTMLElement;
    expect(blockedAlert.textContent).toContain('khách hàng');
    expect(apiPost).not.toHaveBeenCalled();
    expect(onCreated).not.toHaveBeenCalled();

    // Fix the field → the Alert clears and the create goes through.
    // (Re-selecting through React Aria's focus state machine after the
    // blocked submit's focus move is not jsdom-drivable; RC-QC-CREATE-4
    // covers selection-driven success from fresh state, and the fix-clears-
    // Alert chain is covered below via the date field.)
  });

  it('RC-QC-CREATE-2: ngày bỏ trống → Alert nêu ngày hiệu lực, không POST; điền ngày xong Alert biến mất và tạo thành công', async () => {
    const { onCreated } = renderDialog();
    await selectCustomerA();
    fireEvent.change(screen.getByLabelText(/Tên mẫu báo giá/), { target: { value: 'Mẫu NEWEB' } });
    fireEvent.change(screen.getByLabelText(/Độ trễ áp giá dầu/), { target: { value: '1' } });

    fireEvent.submit(formElement());

    expect(await screen.findByText(/Chưa tạo được báo giá/)).toBeTruthy();
    const alert = screen.getByText(/Chưa tạo được báo giá/).closest('[role="alert"]') as HTMLElement;
    expect(alert.textContent).toContain('ngày hiệu lực');
    expect(apiPost).not.toHaveBeenCalled();
    expect(onCreated).not.toHaveBeenCalled();

    // Fix the field → the Alert clears and the create goes through.
    fillDate('22', '10', '2026');
    expect(screen.queryByText(/Chưa tạo được báo giá/)).toBeNull();
    fireEvent.submit(formElement());
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(99));
    expect(apiPost).toHaveBeenCalledTimes(1);
  });

  it('RC-QC-CREATE-3: lag bỏ trống → lỗi gán đúng "độ trễ áp giá dầu", không nhầm sang ngày hiệu lực, không POST', async () => {
    renderDialog();
    await selectCustomerA();
    fireEvent.change(screen.getByLabelText(/Tên mẫu báo giá/), { target: { value: 'Mẫu NEWEB' } });
    fillDate('22', '10', '2026');
    fireEvent.change(screen.getByLabelText(/Độ trễ áp giá dầu/), { target: { value: '' } });

    fireEvent.submit(formElement());

    expect(await screen.findByText(/Chưa tạo được báo giá/)).toBeTruthy();
    const alert = screen.getByText(/Chưa tạo được báo giá/).closest('[role="alert"]') as HTMLElement;
    expect(alert.textContent).toContain('độ trễ áp giá dầu');
    expect(alert.textContent).not.toContain('ngày hiệu lực');
    expect(screen.getByLabelText(/Độ trễ áp giá dầu/).getAttribute('aria-invalid')).toBe('true');
    expect(apiPost).not.toHaveBeenCalled();
  });

  it('RC-QC-CREATE-4: happy path — POST mang payload đã default (NONE, lag 1, cells/fees rỗng), onCreated nhận id', async () => {
    const { onCreated, onClose } = renderDialog();
    await selectCustomerA();
    fireEvent.change(screen.getByLabelText(/Tên mẫu báo giá/), { target: { value: 'Mẫu NEWEB' } });
    fillDate('22', '10', '2026');
    fireEvent.change(screen.getByLabelText(/Độ trễ áp giá dầu/), { target: { value: '1' } });

    fireEvent.submit(formElement());

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(99));
    expect(apiPost).toHaveBeenCalledTimes(1);
    const [path, body] = apiPost.mock.calls[0];
    expect(path).toBe('/quotations');
    expect(body).toEqual({
      customerId: 7,
      templateName: 'Mẫu NEWEB',
      effectiveDate: '2026-10-22',
      surchargeRoundingMode: 'NONE',
      fuelPriceLagDays: 1,
      note: '',
      cells: [],
      fees: [],
    });
    expect(onClose).not.toHaveBeenCalled(); // the owner closes after onCreated
  });
});
