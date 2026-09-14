import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../components/shared/Toast';
import type { OpsOrderItem } from '../api/opsClient';
import OpsOrdersPage from './OpsOrdersPage';

const { apiGet, apiPost, apiPut } = vi.hoisted(() => ({ apiGet: vi.fn(), apiPost: vi.fn(), apiPut: vi.fn() }));
vi.mock('../lib/api', async (importOriginal) => ({
  ...await importOriginal<typeof import('../lib/api')>(),
  api: {
    get: apiGet,
    post: apiPost,
    put: apiPut,
    patch: vi.fn(),
    delete: vi.fn(),
    upload: vi.fn(),
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
});
