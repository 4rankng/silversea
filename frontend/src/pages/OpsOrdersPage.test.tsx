import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../components/shared/Toast';
import type { OpsOrderItem } from '../api/opsClient';
import OpsOrdersPage from './OpsOrdersPage';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const pageStyles = readFileSync(resolve(process.cwd(), 'src/pages/OpsOrdersPage.css'), 'utf8');

const { apiGet, apiPost, apiPut, apiUpload } = vi.hoisted(() => ({ apiGet: vi.fn(), apiPost: vi.fn(), apiPut: vi.fn(), apiUpload: vi.fn() }));
vi.mock('../lib/imageCompression', () => ({ compressImageFile: vi.fn(async (file: File) => file) }));
vi.mock('../lib/api', async (importOriginal) => ({
  ...await importOriginal<typeof import('../lib/api')>(),
  api: {
    get: apiGet,
    post: apiPost,
    put: apiPut,
    patch: vi.fn(),
    delete: vi.fn(),
    upload: apiUpload,
  },
}));

const today = new Date();
const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

function makeItems(): { date: string; items: OpsOrderItem[] } {
  return {
    date: dateStr,
    items: [
      {
        id: 11, shipmentCode: 'SS-A', status: 'READY_FOR_DISPATCH', tradeDirection: 'IMPORT',
        billRef: 'BL-001', customerName: 'Khách A', routeName: 'HP-BN', pinned: false,
        pinnedAt: null, containerCount: 1, containerNumbers: ['TSTU1111111'], containerIds: [111],
      },
      {
        id: 22, shipmentCode: 'SS-B', status: 'IN_TRANSIT', tradeDirection: 'EXPORT',
        billRef: 'BK-002', customerName: 'Khách B', routeName: 'HP-HY', pinned: false,
        pinnedAt: null, containerCount: 2, containerNumbers: ['TSTU2222222', 'TSTU3333333'], containerIds: [222, 333],
      },
    ],
  };
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter>
          <OpsOrdersPage />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe('OpsOrdersPage (OpsVanHanh §3)', () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiPost.mockReset();
    apiPut.mockReset();
    apiUpload.mockReset();
    apiGet.mockImplementation((url: string) => {
      if (url.startsWith('/ops/orders')) return Promise.resolve(makeItems());
      if (url.startsWith('/ops/expense-types')) {
        return Promise.resolve({
          items: [
            { id: 1, code: 'NANGHA', name: 'Nâng/hạ', requiresInvoice: true },
            { id: 2, code: 'CANXE', name: 'Cân xe', requiresInvoice: false },
          ],
        });
      }
      return Promise.resolve({ items: [] });
    });
    apiPost.mockResolvedValue({ pinned: true });
  });

  it('shows the explicit missing-route label, never a bare dash, when routeName is null', async () => {
    const data = makeItems();
    data.items[1].routeName = null;
    apiGet.mockImplementation((url: string) => {
      if (url.startsWith('/ops/orders')) return Promise.resolve(data);
      if (url.startsWith('/ops/expense-types')) {
        return Promise.resolve({ items: [] });
      }
      return Promise.resolve({ items: [] });
    });
    renderPage();

    expect(await screen.findByText('HP-BN')).toBeInTheDocument();
    // The null-route row renders the explicit label — never a bare dash.
    expect(screen.getByText('Chưa có tuyến đường')).toBeInTheDocument();
  });

  it('renders the day list with containers and colored plain-text status', async () => {
    renderPage();
    expect(await screen.findByText('BL-001')).toBeInTheDocument();
    expect(screen.getByText(/TSTU1111111/)).toBeInTheDocument();
    expect(screen.getByText('Sẵn sàng phát lệnh')).toBeInTheDocument();
    expect(screen.getByText('Đang vận chuyển')).toBeInTheDocument();
  });

  it('retains all shipment fields and both actions in the labelled narrow-screen record', async () => {
    renderPage();
    const row = (await screen.findByText('BL-001')).closest('tr')!;
    const fields = Array.from(row.querySelectorAll('td[data-label]')).map((cell) => [cell.getAttribute('data-label'), cell.textContent]);
    expect(fields).toEqual([
      ['Bill / Booking', 'BL-001'],
      ['Khách hàng', 'Khách A'],
      ['Tuyến', 'HP-BN'],
      ['Container', '1 · TSTU1111111'],
      ['Trạng thái', 'Sẵn sàng phát lệnh'],
    ]);
    expect(row.querySelector('.ops-pin')).toHaveAttribute('aria-label', 'Ghim BL-001');
    expect(row.querySelector('.ops-orders__expense')).toHaveTextContent('Khai chi phí');
  });

  it('uses a business key and never falls back to the internal shipment code', async () => {
    const data = makeItems();
    // Distinct internal codes exist even when the business key is missing.
    data.items[0].shipmentCode = 'SHP-2609-00011';
    data.items[1].shipmentCode = 'SHP-2609-00022';
    data.items[1].billRef = null;
    apiGet.mockImplementation((url: string) => {
      if (url.startsWith('/ops/orders')) return Promise.resolve(data);
      if (url.startsWith('/ops/expense-types')) return Promise.resolve({ items: [] });
      return Promise.resolve({ items: [] });
    });
    renderPage();

    const codedRow = (await screen.findByText('BL-001')).closest('tr')!;
    expect(codedRow.querySelector('.ops-pin')).toHaveAttribute('aria-label', 'Ghim BL-001');
    expect(screen.queryByText('SHP-2609-00011')).not.toBeInTheDocument();
    expect(screen.queryByText('SHP-2609-00022')).not.toBeInTheDocument();
    // Both keys absent: the label still names its object, never ends bare.
    const orphanRow = (await screen.findByText('Khách B')).closest('tr')!;
    expect(orphanRow.querySelector('.ops-pin')).toHaveAttribute('aria-label', 'Ghim Chưa có số Bill/Booking');
  });

  it('keeps the narrow records flat and removes the forced horizontal table floor', () => {
    expect(pageStyles).not.toMatch(/min-width:\s*960px/);
    expect(pageStyles).toContain('@container (max-width: 900px)');
    expect(pageStyles).toMatch(/\.ops-orders__table \.ops-orders__row\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);/);
    expect(pageStyles).toMatch(/\.ops-orders__table \.ops-orders__row\s*\{[^}]*border:\s*1px solid var\(--line\);[^}]*border-radius:\s*12px;/s);
    expect(pageStyles).toContain('@media (pointer: coarse)');
  });

  it('keeps every mobile row-card liền khối with at most one accent (card _2 mandate)', () => {
    // Card 20261009_9 reconciliation (port of 6da4f6b7 into prod). The mobile
    // collapse must render as a bordered card: a border-bottom slice let the
    // row bleed past its boundary and left every field reading as an isolated
    // grey block on mobile 390.
    expect(pageStyles).toMatch(/\.ops-orders__table \.ops-orders__row\s*\{[^}]*border:\s*1px solid var\(--line\);[^}]*border-radius:\s*12px;/s);
    // The card carries its own surface so the frame stays liền khối...
    expect(pageStyles).toMatch(/\.ops-orders__table \.ops-orders__row\s*\{[^}]*background:\s*var\(--surface\);/s);
    // ...and field-group cells carry no tint of their own — a gap must never
    // paint as its own "block xám" between fields.
    expect(pageStyles).toMatch(/\.ops-orders__table \.ops-orders__row > td\s*\{[^}]*background:\s*transparent;/s);
    // The pinned card shows ONE brand accent: the canonical status strip on the
    // leading edge. Exactly one accent per card — never a row fill as well.
    expect(pageStyles).toMatch(/\.ops-orders__table \.ops-orders__row\.is-pinned::before\s*\{[^}]*background:\s*var\(--brand\);/s);
    // The hover wash is a quiet neutral scan-aid on fine pointers only — never
    // a sticky hover on touch, never a painted field-group.
    expect(pageStyles).toContain('@media (hover: hover) and (pointer: fine)');
    expect(pageStyles).toMatch(/\.ops-orders__table \.ops-orders__row:not\(\.is-pinned\):hover\s*\{[^}]*background:\s*color-mix\(in srgb, var\(--fg-1\) 2%, var\(--surface\)\);/s);
  });

  it('never lets the desktop pinned tint bleed into the mobile card (specificity law)', () => {
    // The desktop table still paints a pinned row with the warn tint — that is
    // prod's long-standing look (7fa5ae07, colour-only retouched by c9442b2f)
    // and the reconciliation deliberately kept it. What must never happen is
    // that tint surviving INSIDE the collapsed card, which is what broke the
    // frame on mobile 390. The card rule (.ops-orders__table .ops-orders__row,
    // 0-2-0) outranks the desktop pinned rule (tbody tr.is-pinned, 0-1-2), so
    // the container block must set the surface and no descendant rule in it may
    // re-introduce a warn fill on the pinned card.
    const container = pageStyles.slice(pageStyles.indexOf('@container (max-width: 900px)'));
    expect(container).not.toMatch(/is-pinned[^{]*\{[^}]*background:[^;}]*var\(--warn/);
    expect(container).not.toMatch(/is-pinned[^{]*::before[^{]*\{[^}]*background:\s*var\(--warn/);
    // Exactly one painted accent on a pinned card: the brand strip.
    const paintedAccents = container.match(/\.is-pinned[^{]*\{[^}]*background:\s*var\(--brand\)/g) ?? [];
    expect(paintedAccents).toHaveLength(1);
    // The bleed is a CASCADE fact, not a declaration fact: the desktop rule
    // `.ops-orders__table tbody tr.is-pinned` is 0-2-2 and the plain card rule
    // is only 0-2-0, so declaring `background: var(--surface)` on the card does
    // NOT save a pinned row. The container block must therefore carry an
    // explicit pinned reset at 0-3-0 (`.ops-orders__table .ops-orders__row
    // .is-pinned`). Verified in real Chromium at 390px — without this rule the
    // pinned card computes to the warn wash, two accents on one card.
    expect(container).toMatch(
      /\.ops-orders__table \.ops-orders__row\.is-pinned\s*\{[^}]*background:\s*var\(--surface\);/s,
    );
  });

  it('declares no filter plane of its own — the strip is the shared FilterBar band', () => {
    // Card 20260927_152: the page shipped its own control container, control
    // shell and a 220px search width. The shared bar owns all three now, so a
    // page-local filter rule reappearing here is the regression this pins.
    // Comments are stripped first: the sheet records the deleted selectors in
    // the note that explains why they are gone.
    const rules = pageStyles.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(rules).not.toMatch(/\.ops-orders__(controls|date|search)\b/);
    expect(rules).not.toMatch(/width:\s*220px/);
  });

  it('preserves debounced search and selected-date filtering', async () => {
    renderPage();
    await screen.findByText('BL-001');
    fireEvent.change(screen.getByRole('textbox', { name: 'Tìm kiếm' }), { target: { value: '  TSTU1111111  ' } });
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith(`/ops/orders?date=${dateStr}&q=TSTU1111111`));
    fireEvent.change(screen.getByLabelText('Ngày giao dự kiến'), { target: { value: '20/09/2026' } });
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/ops/orders?date=2026-09-20&q=TSTU1111111'));
  });

  it('distinguishes an empty search from an empty day and clears only the query', async () => {
    apiGet.mockImplementation((url: string) => Promise.resolve(url.includes('q=missing') ? { date: dateStr, items: [] } : makeItems()));
    renderPage();
    await screen.findByText('BL-001');
    fireEvent.change(screen.getByLabelText('Ngày giao dự kiến'), { target: { value: '20/09/2026' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Tìm kiếm' }), { target: { value: 'missing' } });
    expect(await screen.findByText('Không có lô hàng phù hợp với từ khóa trong ngày đã chọn.')).toBeInTheDocument();
    expect(screen.queryByText('Không có lô hàng trong ngày này.')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Xóa tìm kiếm' }));
    expect(await screen.findByText('BL-001')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Tìm kiếm' })).toHaveValue('');
    // The shared date field keeps its value: the three segments still read
    // DD/MM/YYYY (the field shows a draft, so the value lives per segment).
    expect(Array.from(document.querySelectorAll<HTMLInputElement>('[data-seg]')).map((node) => node.value).join('/')).toBe('20/09/2026');
    expect(apiGet).toHaveBeenLastCalledWith('/ops/orders?date=2026-09-20');
  });

  it('optimistically pins a row to the top and puts the new state', async () => {
    // Keep the mutation pending so the optimistic cache patch is not yet
    // reconciled by the refetch (the mock server does not persist pins).
    apiPut.mockReturnValue(new Promise(() => {}));
    renderPage();
    await screen.findByText('BL-001');

    const pinButtons = screen.getAllByRole('button', { name: /Ghim (BL-|BK-)/ });
    // SS-B is the second row; pinning it must float it above SS-A immediately.
    fireEvent.click(pinButtons[1]);

    // The mutation stays pending, so nothing reconciles the optimistic patch.
    await waitFor(() => {
      const firstCode = document.querySelector('.ops-orders__table tbody tr .col-code');
      expect(firstCode?.textContent).toBe('BK-002');
    });
    await waitFor(() => {
      expect(apiPut).toHaveBeenCalledWith('/ops/orders/shipment-pins/22', { pinned: true });
    });
  });

  it('reports a failed pin, restores the saved state, and allows an explicit retry', async () => {
    apiPut.mockRejectedValueOnce(new Error('Mất kết nối khi lưu ghim'));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Ghim BL-001' }));
    expect(await screen.findByText('Mất kết nối khi lưu ghim')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Ghim BL-001' })).toBeEnabled());
    expect(screen.getByRole('button', { name: 'Ghim BL-001' })).toHaveAttribute('aria-pressed', 'false');
    apiPut.mockReturnValueOnce(new Promise(() => {}));
    fireEvent.click(screen.getByRole('button', { name: 'Ghim BL-001' }));
    await waitFor(() => expect(apiPut).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('button', { name: 'Bỏ ghim BL-001' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('sends one pin update while the previous action is pending', async () => {
    apiPut.mockReturnValue(new Promise(() => {}));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Ghim BL-001' }));
    const pending = await screen.findByRole('button', { name: 'Bỏ ghim BL-001' });
    expect(pending).toBeDisabled();
    expect(pending).toHaveAttribute('aria-busy', 'true');
    fireEvent.click(pending);
    fireEvent.click(screen.getByRole('button', { name: 'Ghim BK-002' }));
    await waitFor(() => expect(apiPut).toHaveBeenCalledTimes(1));
  });

  it('opens the expense form with the lô context auto-filled', async () => {
    renderPage();
    await screen.findByText('BL-001');

    fireEvent.click(screen.getAllByRole('button', { name: /Khai chi phí/ })[0]);

    expect(await screen.findByRole('dialog', { name: 'Khai báo chi phí' })).toBeInTheDocument();
    // IMPORT → Số Bill readonly autofilled.
    expect(screen.getByLabelText('Số Bill')).toHaveValue('BL-001');
    // The Số Cont select renders a UUI button that holds the label text
    // "Số Cont" (or starts with the same), so the form contains more than
    // one button matching that name (the form's own buttons and the
    // combobox). Pick the trigger by name + the "Phí chung lô" caption
    // (the lô-level option that the trigger shows by default).
    const dialog = screen.getByRole('dialog', { name: 'Khai báo chi phí' });
    const allButtons = Array.from(dialog.querySelectorAll('button'));
    const containerTrigger = allButtons.find((button) => button.textContent?.includes('Phí chung lô'));
    expect(containerTrigger, 'UuiSelectField trigger for "Số Cont" should be present').toBeDefined();
    fireEvent.click(containerTrigger!);
    const listbox = await screen.findByRole('listbox');
    const labels = Array.from(listbox.querySelectorAll('[role="option"]')).map((node) => node.textContent ?? '');
    expect(labels).toContain('Phí chung lô');
    expect(labels).toContain('TSTU1111111');
    // Close the listbox (Escape) so the form's dialog is the active
    // accessible region again before asserting the submit button.
    fireEvent.keyDown(listbox, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
    // Submit disabled until type + amount valid.
    const submit = screen.getByRole('dialog', { name: 'Khai báo chi phí' }).querySelector<HTMLButtonElement>('button[type="submit"]')!;
    expect(submit).toBeDisabled();
  });
  it('shows the rejected negative amount and explains how to recover before saving', async () => {
    renderPage();
    await screen.findByText('BL-001');
    fireEvent.click(screen.getAllByRole('button', { name: /Khai chi phí/ })[0]);
    fireEvent.click(await screen.findByRole('combobox', { name: /Loại phí/ }));
    fireEvent.click(await screen.findByRole('option', { name: 'Cân xe' }));
    const amount = screen.getByLabelText(/Thực chi \(VND\)/);
    const submit = screen.getByRole('dialog', { name: 'Khai báo chi phí' }).querySelector<HTMLButtonElement>('button[type="submit"]')!;
    // Card 20260928_197 — a NEGATIVE amount is the PM's "(-) chi phí tương
    // đương xóa dòng". It must be accepted here; the backend drops the row from
    // every total via sumExcludingNegative rather than netting it out.
    fireEvent.change(amount, { target: { value: '-123000' } });
    // Grouped money field (card 20260928_197): a text input holding the vi-VN
    // rendering, so the accepted negative reads "-123.000", not -123000.
    expect(amount).toHaveValue('-123.000');
    expect(amount).toHaveAttribute('aria-invalid', 'false');
    expect(screen.queryByText(/Số tiền phải là số nguyên khác 0/)).not.toBeInTheDocument();
    // Cân xe is a no-invoice line, so opsCustomerCharge — the client mirror of
    // the server's receivableForCost — charges nothing and the row carries its
    // own mandatory reason (card 20260928_162). Satisfy that orthogonal gate
    // once, so every submit-button assertion below is the AMOUNT's doing.
    fireEvent.change(screen.getByLabelText('Ghi chú'), { target: { value: 'dòng chi âm, xem chứng từ gốc' } });
    expect(submit).toBeEnabled();
    // 0 is an empty row, not a signed one.
    fireEvent.change(amount, { target: { value: '0' } });
    expect(amount).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText(/Số tiền không được bằng 0/)).toBeInTheDocument();
    expect(submit).toBeDisabled();
    expect(apiPost).not.toHaveBeenCalled();
    // A grouped money field cannot hold a fraction — "." is the thousands
    // separator, so "123.45" reads as the integer 12.345, the only shape the
    // signed integer schema accepts. What it still refuses is 0 (above) and a
    // value past the ceiling: both mark the field invalid and block the save.
    fireEvent.change(amount, { target: { value: '123.45' } });
    expect(amount).toHaveValue('12.345');
    expect(amount).toHaveAttribute('aria-invalid', 'false');
    fireEvent.change(amount, { target: { value: '1000000000000000' } });
    expect(amount).toHaveValue('1.000.000.000.000.000');
    expect(amount).toHaveAttribute('aria-invalid', 'true');
    expect(submit).toBeDisabled();
    fireEvent.submit(submit.closest('form')!);
    expect(apiPost).not.toHaveBeenCalled();
    fireEvent.change(amount, { target: { value: '123000' } });
    expect(submit).toBeEnabled();
    expect(screen.queryByText(/Số tiền/)).not.toBeInTheDocument();
  });

  it('waits for the receipt upload before creating the expense with its storage key', async () => {
    let finishUpload!: (value: { storageKey: string; url: string }) => void;
    apiUpload.mockReturnValue(new Promise((resolve) => { finishUpload = resolve; }));
    renderPage();
    await screen.findByText('BL-001');
    fireEvent.click(screen.getAllByRole('button', { name: /Khai chi phí/ })[0]);
    fireEvent.click(await screen.findByRole('combobox', { name: /Loại phí/ }));
    fireEvent.click(await screen.findByRole('option', { name: 'Cân xe' }));
    fireEvent.change(screen.getByLabelText(/Thực chi \(VND\)/), { target: { value: '123000' } });
    // Cân xe is a no-invoice line, so opsCustomerCharge (the client mirror of
    // the server's receivableForCost) charges nothing and the row cannot be
    // saved without the reason — card 20260928_162. The gate is announced, so
    // the operator is not left guessing why Lưu stays dark.
    expect(screen.getByText(/ghi chú bắt buộc/i)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Ghi chú'), { target: { value: 'cân xe tại cảng, khách tự thanh toán' } });
    const dialog = screen.getByRole('dialog', { name: 'Khai báo chi phí' });
    const form = dialog.querySelector('form')!;
    const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    fireEvent.change(form.querySelector('input[type="file"]')!, {
      target: { files: [new File(['receipt'], 'receipt.png', { type: 'image/png' })] },
    });
    await waitFor(() => expect(apiUpload).toHaveBeenCalledTimes(1));
    expect(submit).toBeDisabled();
    fireEvent.submit(form);
    expect(apiPost).not.toHaveBeenCalled();
    finishUpload({ storageKey: 'ops/receipt.png', url: '/api/photos/ops%2Freceipt.png' });
    await waitFor(() => expect(submit).toBeEnabled());
    fireEvent.submit(form);
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/ops/expenses', expect.objectContaining({
      amount: '123000', photoStorageKeys: ['ops/receipt.png'],
    })));
    expect(apiPost).toHaveBeenCalledTimes(1);
  });

});
