import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Customer } from '@tingting/shared';

const { apiMock } = vi.hoisted(() => ({
  apiMock: { get: vi.fn(), put: vi.fn(), post: vi.fn(), delete: vi.fn() },
}));

vi.mock('../components/shared/Toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock('../lib/api', async (importOriginal) => {
  const original = await importOriginal<typeof import('../lib/api')>();
  return { ...original, api: apiMock };
});

vi.mock('../hooks/useQueries', () => ({
  useCustomerLedgerEntries: () => ({ data: [] }),
  useSuppliers: () => ({ data: { items: [], total: 0 } }),
}));

vi.mock('../hooks/animations', () => ({
  usePageAnimations: () => ({ rootRef: { current: null } }),
}));

import CustomersPage from './CustomersPage';

function customerFixture(id: number, shortName: string): Customer {
  return {
    id,
    name: `Công ty ${shortName}`,
    shortName,
    taxCode: null,
    contactPerson: null,
    phone: null,
    creditLimit: null,
    paymentTermDays: 30,
    fuelSurchargeSharePct: null,
    paymentDatePolicy: 'NEXT_BUSINESS_DAY',
    status: 'ACTIVE',
    isCarrier: false,
    debitNoteMode: 'MONTHLY',
    linkedSupplierId: null,
  } as unknown as Customer;
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <CustomersPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function lastGetUrl(): string {
  const calls = apiMock.get.mock.calls;
  return String(calls[calls.length - 1]![0]);
}

describe('CustomersPage server-side sort headers', () => {
  beforeEach(() => {
    apiMock.get.mockReset();
    // 12 total at pageSize 10 → two pages, so the page-reset proof can run.
    apiMock.get.mockResolvedValue({
      items: [customerFixture(1, 'Biển Bạc'), customerFixture(2, 'Cát Tuyền')],
      total: 12,
    });
  });

  it('sends sortBy/sortDir to the endpoint, toggles asc→desc, and resets to page 1', async () => {
    renderPage();
    expect(await screen.findAllByText('Biển Bạc')).toBeTruthy();

    // Move to page 2 so the sort click's page reset is observable.
    fireEvent.click(await screen.findByRole('button', { name: 'Trang sau' }));
    await waitFor(() => expect(lastGetUrl()).toContain('page=2'));

    // First click: fresh column starts ascending and jumps back to page 1.
    // SIL-169: the identity column header is "Khách hàng" (sortKey name).
    fireEvent.click(screen.getByRole('button', { name: 'Khách hàng' }));
    await waitFor(() => {
      expect(lastGetUrl()).toContain('page=1');
      expect(lastGetUrl()).toContain('sortBy=name');
      expect(lastGetUrl()).toContain('sortDir=asc');
    });

    // Second click on the active column flips to descending.
    fireEvent.click(screen.getByRole('button', { name: 'Khách hàng' }));
    await waitFor(() => {
      expect(lastGetUrl()).toContain('sortDir=desc');
      expect(lastGetUrl()).toContain('page=1');
    });
  }, 15_000);

  it('exposes the backend sort keys through the sortable header buttons', async () => {
    renderPage();
    expect(await screen.findAllByText('Biển Bạc')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'MST' }));
    await waitFor(() => {
      expect(lastGetUrl()).toContain('sortBy=taxCode');
      expect(lastGetUrl()).toContain('sortDir=asc');
    });

    // The active column announces direction; inactive columns announce none.
    // (Query via the header buttons — the bare label text also appears in the
    // mobile card list.)
    const header = screen.getByRole('button', { name: 'MST' }).closest('th');
    expect(header?.getAttribute('aria-sort')).toBe('ascending');
    expect(screen.getByRole('button', { name: 'Khách hàng' }).closest('th')?.getAttribute('aria-sort')).toBe('none');
  });

  it('keeps the server total; the zero-or-unknown Tạm khoá tab stays hidden (SIL-169)', async () => {
    const { container } = renderPage();
    await screen.findAllByText('Biển Bạc');
    const group = screen.getByRole('tablist', { name: 'Lọc theo trạng thái khách hàng' });
    const all = within(group).getByRole('tab', { name: /^Tất cả/ });
    const active = within(group).getByRole('tab', { name: /^Hoạt động/ });
    const writesBefore = [apiMock.post.mock.calls.length, apiMock.put.mock.calls.length, apiMock.delete.mock.calls.length];
    expect(within(all).getByText('12')).toBeVisible();
    // The mocked census endpoint answers the list envelope (no counts), so
    // the in-flight pills carry no numeral and the zero-or-unknown Tạm khoá
    // pill must not render at all — never a provisional numeral.
    expect(active.textContent).toBe('Hoạt động');
    expect(within(group).queryByRole('tab', { name: /^Tạm khoá/ })).toBeNull();

    fireEvent.click(active);
    expect(active).toHaveAttribute('aria-selected', 'true');
    expect(container.querySelectorAll('tbody tr.customers-row')).toHaveLength(2);
    fireEvent.click(all);
    expect(all).toHaveAttribute('aria-selected', 'true');
    expect(container.querySelectorAll('tbody tr.customers-row')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Trang sau' }));
    await waitFor(() => expect(lastGetUrl()).toContain('page=2'));
    expect(within(all).getByText('12')).toBeVisible();
    expect([apiMock.post.mock.calls.length, apiMock.put.mock.calls.length, apiMock.delete.mock.calls.length]).toEqual(writesBefore);
  });

  it('omits sort params entirely until a header is pressed', async () => {
    renderPage();
    expect(await screen.findAllByText('Biển Bạc')).toBeTruthy();
    expect(lastGetUrl()).not.toContain('sortBy');
    expect(lastGetUrl()).not.toContain('sortDir');
  });
});

describe('customers command strip + grid (card 20260927_152)', () => {
  const css = readFileSync(resolve(process.cwd(), 'src/pages/CustomersPage.css'), 'utf8');
  const tsx = readFileSync(resolve(process.cwd(), 'src/pages/CustomersPage.tsx'), 'utf8');
  const plane = readFileSync(resolve(process.cwd(), 'src/features/customers/CustomerFilters.tsx'), 'utf8');

  it('the strip is the shared FilterBar plane, not a page-local command strip', () => {
    expect(tsx).not.toContain('<SummaryRail');
    // The plane is extracted (the page sits on a hard line ceiling) and it
    // renders the shared bar; the page-local strip box, its row1/row2 split and
    // its own search shell are deleted.
    expect(tsx).toContain('<CustomerFilters');
    expect(plane).toContain('<FilterBar');
    expect(plane).toContain('fold={{');
    // SIL-169: the concentration chip rides the header metric row now.
    expect(tsx).toContain('Top 4 KH chiếm');
    expect(tsx).not.toContain('customers-strip__row');
    expect(tsx).not.toContain('customers-strip__search');
    expect(css).not.toMatch(/\.customers-strip__row[12]\s*\{/);
    expect(css).not.toMatch(/\.customers-strip__search/);
  });

  it('grid: the SIL-169 verdict budget — 7 fixed columns, 56px rows, hairline skin', () => {
    // The verdict's column widths ride the colgroup (260/110/180/180/96/120),
    // and the kebab column rides the .cus-col-action class (32px fine
    // pointer, touch floor when a coarse hand needs the button).
    expect(tsx).toContain("<col style={{ width: 260 }} />");
    expect(tsx).toContain("<col style={{ width: 110 }} />");
    expect(tsx).toContain("<col style={{ width: 180 }} />");
    expect(tsx).toContain("<col style={{ width: 96 }} />");
    expect(tsx).toContain("<col style={{ width: 120 }} />");
    expect(tsx).toContain('<col className="cus-col-action" />');
    // 56px rows over the neutral hairline + hover fill; the sage zebra is
    // gone (verdict c: sage is accent only).
    expect(css).toMatch(/\.customers-page \.record-table tbody td\s*\{[^}]*height:\s*56px/s);
    expect(css).toMatch(/border-bottom:\s*1px solid var\(--hairline\)/);
    expect(css).toMatch(/tr:hover td \{ background: var\(--hairline-hover\); \}/);
    expect(css).not.toMatch(/nth-child\(even\)/);
    // The risk dot triad + overdue red ride the SIL-169 tokens, never raw hex.
    expect(css).toMatch(/\.cus-dot--high \{ background: var\(--risk-high\); \}/);
    expect(css).toMatch(/\.cus-dot--med {2}\{ background: var\(--risk-med\); \}/);
    expect(css).toMatch(/\.cus-dot--low {2}\{ background: var\(--risk-low\); \}/);
    expect(css).toMatch(/\.cus-debt-cell\[data-overdue\] \{ color: var\(--overdue-text\); \}/);
    // The strip status group is the shared boxed Tabs primitive (one group
    // shape app-wide, operator ruling 2026-09-27) — no page-local tab CSS.
    expect(plane).toMatch(/<Tabs[\s\S]*variant="boxed"[\s\S]*ariaLabel="Lọc theo trạng thái khách hàng"/);
    expect(css).not.toMatch(/\.customers-strip__tab/);
    expect(css).toMatch(/\.customers-contact-stack\s*\{[^}]*display:\s*grid/);
    expect(css).toMatch(/\.customers-copy-phone/);
    expect(tsx).not.toContain('colSpan={5 + Number');
  });

  it('search keeps the working shortcut handler without printing it', () => {
    // CHIEF 2026-09-27: the hotkey works but stays invisible.
    expect(tsx).not.toContain('customers-strip__kbd');
    expect(plane).not.toContain('customers-strip__kbd');
    expect(tsx).toMatch(/event\.metaKey \|\| event\.ctrlKey/);
  });
});
