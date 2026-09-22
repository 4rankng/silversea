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
    expect(await screen.findByText('SS-A')).toBeInTheDocument();
    expect(screen.getByText(/TSTU1111111/)).toBeInTheDocument();
    expect(screen.getByText('Sẵn sàng phát lệnh')).toBeInTheDocument();
    expect(screen.getByText('Đang vận chuyển')).toBeInTheDocument();
  });

  it('retains all shipment fields and both actions in the labelled narrow-screen record', async () => {
    renderPage();
    const row = (await screen.findByText('SS-A')).closest('tr')!;
    const fields = Array.from(row.querySelectorAll('td[data-label]')).map((cell) => [cell.getAttribute('data-label'), cell.textContent]);
    expect(fields).toEqual([
      ['Mã lô', 'SS-A'],
      ['Khách hàng', 'Khách A'],
      ['Tuyến', 'HP-BN'],
      ['Container', '1 · TSTU1111111'],
      ['Bill / Booking', 'BL-001'],
      ['Trạng thái', 'Sẵn sàng phát lệnh'],
    ]);
    expect(row.querySelector('.ops-pin')).toHaveAttribute('aria-label', 'Ghim SS-A');
    expect(row.querySelector('.ops-orders__expense')).toHaveTextContent('Khai chi phí');
  });

  it('labels the pin button with a business key when the lot has no shipment code', async () => {
    const data = makeItems();
    // Bulk lots carry shipment_code = null; Bill/Booking is the business key
    // the row itself displays, so the pin must speak in the same identity.
    data.items[0].shipmentCode = null;
    data.items[1].shipmentCode = null;
    data.items[1].billRef = null;
    apiGet.mockImplementation((url: string) => {
      if (url.startsWith('/ops/orders')) return Promise.resolve(data);
      if (url.startsWith('/ops/expense-types')) return Promise.resolve({ items: [] });
      return Promise.resolve({ items: [] });
    });
    renderPage();

    const codedRow = (await screen.findByText('BL-001')).closest('tr')!;
    expect(codedRow.querySelector('.ops-pin')).toHaveAttribute('aria-label', 'Ghim BL-001');
    // Both keys absent: the label still names its object, never ends bare.
    const orphanRow = (await screen.findByText('Khách B')).closest('tr')!;
    expect(orphanRow.querySelector('.ops-pin')).toHaveAttribute('aria-label', 'Ghim lô');
  });

  it('keeps the narrow records flat and removes the forced horizontal table floor', () => {
    expect(pageStyles).not.toMatch(/min-width:\s*960px/);
    expect(pageStyles).toContain('@container (max-width: 900px)');
    expect(pageStyles).toMatch(/\.ops-orders__table \.ops-orders__row\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);/);
    expect(pageStyles).toMatch(/\.ops-orders__table \.ops-orders__row\s*\{[^}]*border-bottom:\s*1px solid var\(--line\);/);
    expect(pageStyles).toMatch(/\.ops-orders__controls\s*\{[^}]*grid-template-columns:\s*minmax\(0, 148px\) minmax\(0, 1fr\);/);
    expect(pageStyles).toContain('.ops-orders__search:focus-within');
    expect(pageStyles).toContain('@media (pointer: coarse)');
  });

  it('preserves debounced search and selected-date filtering', async () => {
    renderPage();
    await screen.findByText('SS-A');
    fireEvent.change(screen.getByRole('textbox', { name: 'Tìm kiếm' }), { target: { value: '  TSTU1111111  ' } });
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith(`/ops/orders?date=${dateStr}&q=TSTU1111111`));
    fireEvent.change(screen.getByLabelText('Ngày giao dự kiến'), { target: { value: '20/09/2026' } });
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/ops/orders?date=2026-09-20&q=TSTU1111111'));
  });

  it('distinguishes an empty search from an empty day and clears only the query', async () => {
    apiGet.mockImplementation((url: string) => Promise.resolve(url.includes('q=missing') ? { date: dateStr, items: [] } : makeItems()));
    renderPage();
    await screen.findByText('SS-A');
    fireEvent.change(screen.getByLabelText('Ngày giao dự kiến'), { target: { value: '20/09/2026' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Tìm kiếm' }), { target: { value: 'missing' } });
    expect(await screen.findByText('Không có lô hàng phù hợp với từ khóa trong ngày đã chọn.')).toBeInTheDocument();
    expect(screen.queryByText('Không có lô hàng trong ngày này.')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Xóa tìm kiếm' }));
    expect(await screen.findByText('SS-A')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Tìm kiếm' })).toHaveValue('');
    expect(screen.getByLabelText('Ngày giao dự kiến')).toHaveValue('20/09/2026');
    expect(apiGet).toHaveBeenLastCalledWith('/ops/orders?date=2026-09-20');
  });

  it('optimistically pins a row to the top and puts the new state', async () => {
    // Keep the mutation pending so the optimistic cache patch is not yet
    // reconciled by the refetch (the mock server does not persist pins).
    apiPut.mockReturnValue(new Promise(() => {}));
    renderPage();
    await screen.findByText('SS-A');

    const pinButtons = screen.getAllByRole('button', { name: /Ghim SS-/ });
    // SS-B is the second row; pinning it must float it above SS-A immediately.
    fireEvent.click(pinButtons[1]);

    // The mutation stays pending, so nothing reconciles the optimistic patch.
    await waitFor(() => {
      const firstCode = document.querySelector('.ops-orders__table tbody tr .col-code');
      expect(firstCode?.textContent).toBe('SS-B');
    });
    await waitFor(() => {
      expect(apiPut).toHaveBeenCalledWith('/ops/orders/shipment-pins/22', { pinned: true });
    });
  });

  it('reports a failed pin, restores the saved state, and allows an explicit retry', async () => {
    apiPut.mockRejectedValueOnce(new Error('Mất kết nối khi lưu ghim'));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Ghim SS-A' }));
    expect(await screen.findByText('Mất kết nối khi lưu ghim')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Ghim SS-A' })).toBeEnabled());
    expect(screen.getByRole('button', { name: 'Ghim SS-A' })).toHaveAttribute('aria-pressed', 'false');
    apiPut.mockReturnValueOnce(new Promise(() => {}));
    fireEvent.click(screen.getByRole('button', { name: 'Ghim SS-A' }));
    await waitFor(() => expect(apiPut).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('button', { name: 'Bỏ ghim SS-A' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('sends one pin update while the previous action is pending', async () => {
    apiPut.mockReturnValue(new Promise(() => {}));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Ghim SS-A' }));
    const pending = await screen.findByRole('button', { name: 'Bỏ ghim SS-A' });
    expect(pending).toBeDisabled();
    expect(pending).toHaveAttribute('aria-busy', 'true');
    fireEvent.click(pending);
    fireEvent.click(screen.getByRole('button', { name: 'Ghim SS-B' }));
    await waitFor(() => expect(apiPut).toHaveBeenCalledTimes(1));
  });

  it('opens the expense form with the lô context auto-filled', async () => {
    renderPage();
    await screen.findByText('SS-A');

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
    await screen.findByText('SS-A');
    fireEvent.click(screen.getAllByRole('button', { name: /Khai chi phí/ })[0]);
    fireEvent.click(await screen.findByRole('combobox', { name: /Loại phí/ }));
    fireEvent.click(await screen.findByRole('option', { name: 'Cân xe' }));
    const amount = screen.getByLabelText(/Thực chi \(VND\)/);
    fireEvent.change(amount, { target: { value: '-123000' } });
    expect(amount).toHaveValue(-123000);
    expect(amount).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Số tiền phải là số dương')).toBeInTheDocument();
    const submit = screen.getByRole('dialog', { name: 'Khai báo chi phí' }).querySelector<HTMLButtonElement>('button[type="submit"]')!;
    expect(submit).toBeDisabled();
    expect(apiPost).not.toHaveBeenCalled();
    fireEvent.change(amount, { target: { value: '123.45' } });
    expect(amount).toHaveValue(123.45);
    expect(submit).toBeDisabled();
    fireEvent.submit(submit.closest('form')!);
    expect(apiPost).not.toHaveBeenCalled();
    fireEvent.change(amount, { target: { value: '123000' } });
    expect(submit).toBeEnabled();
    expect(screen.queryByText('Số tiền phải là số dương')).not.toBeInTheDocument();
  });

  it('waits for the receipt upload before creating the expense with its storage key', async () => {
    let finishUpload!: (value: { storageKey: string; url: string }) => void;
    apiUpload.mockReturnValue(new Promise((resolve) => { finishUpload = resolve; }));
    renderPage();
    await screen.findByText('SS-A');
    fireEvent.click(screen.getAllByRole('button', { name: /Khai chi phí/ })[0]);
    fireEvent.click(await screen.findByRole('combobox', { name: /Loại phí/ }));
    fireEvent.click(await screen.findByRole('option', { name: 'Cân xe' }));
    fireEvent.change(screen.getByLabelText(/Thực chi \(VND\)/), { target: { value: '123000' } });
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
