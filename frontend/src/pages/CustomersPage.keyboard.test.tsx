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

  // Card 20260929_207: the checkbox is gone and the row is the selection
  // control. The invariants below are the SAME ones, expressed on the new
  // affordance: selecting a row must never open a dialog, and a row action
  // keeps its own native Enter behaviour instead of being swallowed by the row.
  it('row Space selects without opening anything, and row actions keep Enter', async () => {
    const { container } = renderPage();
    const row = await waitFor(() => {
      const found = container.querySelector<HTMLElement>('tbody tr.customers-row');
      if (!found) throw new Error('row not rendered yet');
      return found;
    });
    row.focus();
    // Space on the row is CLAIMED (its default is prevented so the page does
    // not scroll), so the old "not prevented" assertion is gone: the invariant
    // now is that selecting opens no dialog, below.
    fireEvent.keyDown(row, { key: ' ' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(row).toHaveAttribute('data-selected', 'true'));
    // Chief grid: direct hover actions replaced the dots menu — Enter on the
    // edit affordance opens the edit modal (its own dialog carries the same
    // accessible name), and the row's own Space never does.
    const edit = screen.getByRole('button', { name: 'Sửa khách hàng Biển Bạc' });
    expect(fireEvent.keyDown(edit, { key: 'Enter' })).toBe(true);
    fireEvent.click(edit);
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Sửa khách hàng Biển Bạc' })).toBeTruthy());
  });

  // Card 20260929_207 (PM decision): row click PICKED the customer, so opening
  // the record moved to the name — the cell that carries its identity. The
  // drawer contract is unchanged: it traps focus, closes on Escape, returns
  // focus to what opened it, and still loads both histories.
  it('opens details from the customer name, traps focus, closes on Escape and restores focus', async () => {
    renderPage();
    const openName = await screen.findByRole('button', { name: 'Mở hồ sơ Công ty Biển Bạc' });
    openName.focus();
    // Enter-activates-a-native-button is browser behaviour jsdom does not
    // synthesize, so the drawer is opened the way a user does it: a click on
    // the name. The keyboard contract asserted below (focus trap, Escape,
    // focus restore) is unchanged from the checkbox-era test.
    fireEvent.click(openName);
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
    await waitFor(() => expect(openName).toHaveFocus());
    expect(apiMock.get).toHaveBeenCalledWith('/customers/2/logistics-history?limit=5');
    expect(apiMock.get).toHaveBeenCalledWith('/customers/2/payment-history?limit=5');
  });
});
