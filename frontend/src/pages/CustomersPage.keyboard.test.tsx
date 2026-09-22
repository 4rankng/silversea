import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { apiMock } = vi.hoisted(() => ({ apiMock: { get: vi.fn(), put: vi.fn(), post: vi.fn(), delete: vi.fn() } }));
vi.mock('../components/shared/Toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('../lib/api', async (original) => ({ ...await original<typeof import('../lib/api')>(), api: apiMock }));
vi.mock('../hooks/useQueries', () => ({ useCustomerLedgerEntries: () => ({ data: [] }), useSuppliers: () => ({ data: { items: [], total: 0 } }) }));
vi.mock('../hooks/animations', () => ({ usePageAnimations: () => ({ rootRef: { current: null } }) }));
import CustomersPage from './CustomersPage';

function renderPage() {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><CustomersPage /></MemoryRouter></QueryClientProvider>);
}

describe('customer row keyboard boundaries', () => {
  beforeEach(() => {
    apiMock.get.mockReset().mockImplementation(async (url: string) => url.includes('-history')
      ? { items: [], outstanding: '0' }
      : { items: [{ id: 2, name: 'Công ty Biển Bạc', shortName: 'Biển Bạc', status: 'ACTIVE', isCarrier: false }], total: 1 });
  });

  it('leaves checkbox Space and action-menu Enter to their native controls', async () => {
    renderPage();
    const checkbox = await screen.findByRole('checkbox', { name: 'Chọn Biển Bạc' });
    expect(fireEvent.keyDown(checkbox, { key: ' ' })).toBe(true);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.click(checkbox);
    expect(checkbox).toBeChecked();
    const menu = screen.getByRole('button', { name: 'Mở thao tác cho Biển Bạc' });
    expect(fireEvent.keyDown(menu, { key: 'Enter' })).toBe(true);
    fireEvent.click(menu);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Sửa' }).length).toBeGreaterThan(0);
  });

  it('opens details from the row, traps focus, closes on Escape and restores the row', async () => {
    const { container } = renderPage();
    await screen.findByRole('checkbox', { name: 'Chọn Biển Bạc' });
    const row = container.querySelector<HTMLElement>('tbody tr[role="button"]')!;
    row.focus();
    fireEvent.keyDown(row, { key: 'Enter' });
    const dialog = await screen.findByRole('dialog', { name: 'Chi tiết Biển Bạc' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    const close = within(dialog).getByRole('button', { name: 'Đóng' });
    const fullPage = within(dialog).getByRole('button', { name: 'Mở trang đầy đủ' });
    fullPage.focus();
    fireEvent.keyDown(fullPage, { key: 'Tab' });
    expect(close).toHaveFocus();
    fireEvent.keyDown(close, { key: 'Tab', shiftKey: true });
    expect(fullPage).toHaveFocus();
    fireEvent.keyDown(fullPage, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(row).toHaveFocus());
    expect(apiMock.get).toHaveBeenCalledWith('/customers/2/logistics-history?limit=5');
    expect(apiMock.get).toHaveBeenCalledWith('/customers/2/payment-history?limit=5');
  });
});
