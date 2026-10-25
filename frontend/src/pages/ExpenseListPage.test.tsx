import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExpenseWithRefs, PaginatedResponse } from '@tingting/shared';

const apiGet = vi.fn();
const apiPost = vi.fn();

vi.mock('../lib/api', () => ({
  api: { get: (...args: unknown[]) => apiGet(...args), post: (...args: unknown[]) => apiPost(...args) },
}));

const useAuthMock = vi.fn<() => { user: { role: string; userId: number; username: string } | null }>(() => ({ user: null }));
vi.mock('../hooks/useAuth', () => ({ useAuth: () => useAuthMock() }));

vi.mock('../api/configClient', () => ({
  configClient: {
    getAllSuppliers: vi.fn().mockResolvedValue([]),
    getAllExpenseCategories: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('../hooks/useCatalogs', () => ({
  useCatalogs: () => ({ data: { trucks: [] } }),
}));

vi.mock('../hooks/animations', () => ({
  usePageAnimations: () => ({ rootRef: { current: null } }),
  useListAnimations: () => {},
}));

import ExpenseListPage from './ExpenseListPage';

const rows: ExpenseWithRefs[] = [
  {
    id: 1,
    expenseDate: '2026-08-20',
    supplierId: 3,
    categoryId: 5,
    truckId: 7,
    vehicleComponent: 'TRUCK',
    amount: '1250000',
    paymentStatus: 'UNPAID',
    validFrom: null,
    validTo: null,
    receiptId: null,
    note: null,
    createdBy: null,
    createdAt: '2026-08-21T02:00:00.000Z',
    updatedAt: '2026-08-21T02:00:00.000Z',
    deletedAt: null,
    supplier: {
      id: 3, name: 'Garage Auto 123', shortName: 'Garage', contactPerson: null, phone: null,
      taxCode: null, note: null, status: 'ACTIVE', linkedCustomerId: null, isFuelSupplier: false,
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', deletedAt: null,
    },
    category: {
      id: 5, name: 'Sửa chữa', isRenewable: false, reminderLeadDays: 0, status: 'ACTIVE',
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', deletedAt: null,
    },
    truck: { id: 7, licensePlate: '51H-123.45' },
  },
  {
    id: 2,
    expenseDate: '2026-08-19',
    supplierId: 4,
    categoryId: 6,
    truckId: null,
    vehicleComponent: null,
    amount: '480000',
    paymentStatus: 'PAID',
    validFrom: null,
    validTo: null,
    receiptId: null,
    note: null,
    createdBy: null,
    createdAt: '2026-08-19T01:00:00.000Z',
    updatedAt: '2026-08-19T01:00:00.000Z',
    deletedAt: null,
    supplier: {
      id: 4, name: 'Total Petroline', contactPerson: null, phone: null, taxCode: null,
      note: null, status: 'ACTIVE', linkedCustomerId: null, isFuelSupplier: true,
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', deletedAt: null,
    },
    category: {
      id: 6, name: 'Nhiên liệu', isRenewable: false, reminderLeadDays: 0, status: 'ACTIVE',
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', deletedAt: null,
    },
  },
];

function envelope(items: ExpenseWithRefs[], total = items.length): PaginatedResponse<ExpenseWithRefs> {
  return { items, total, page: 1, pageSize: 20 };
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ExpenseListPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  apiGet.mockReset();
  apiGet.mockResolvedValue(envelope(rows, 43));
});

describe('ExpenseListPage', () => {
  it('fetches page 1 with backend-native pagination params and renders records', async () => {
    renderPage();

    expect(await screen.findByText('Garage Auto 123')).toBeTruthy();
    expect(screen.getByText('Ghi nợ')).toBeTruthy();
    expect(screen.getByText('Đã trả')).toBeTruthy();

    // The endpoint speaks page/limit — never the legacy pageSize param.
    expect(apiGet).toHaveBeenCalledWith('/expenses?page=1&limit=20');
    expect(apiGet.mock.calls.every(call => !String(call[0]).includes('pageSize='))).toBe(true);

    // Pagination summary carries the envelope total (43), not the row count.
    expect(screen.getByText('43')).toBeTruthy();
  });

  it('maps the date-range filter to fromDate/toDate and stays on page 1', async () => {
    renderPage();
    await screen.findByText('Garage Auto 123');

    fireEvent.change(screen.getByLabelText('Từ ngày'), { target: { value: '01/08/2026' } });

    await waitFor(() => {
      expect(apiGet).toHaveBeenCalledWith('/expenses?page=1&limit=20&fromDate=2026-08-01');
    });
    // Regression guard: the legacy dateFrom param is never sent.
    expect(apiGet.mock.calls.every(call => !String(call[0]).includes('dateFrom='))).toBe(true);
  });

  it('requests page 2 server-side when a pagination page is clicked', async () => {
    apiGet.mockResolvedValue(envelope(rows, 43));
    renderPage();
    await screen.findByText('Garage Auto 123');

    fireEvent.click(screen.getByRole('button', { name: '2' }));

    await waitFor(() => {
      expect(apiGet).toHaveBeenCalledWith('/expenses?page=2&limit=20');
    });
  });

  it('drives the summary rail from the envelope summary, not page math', async () => {
    apiGet.mockResolvedValue({
      ...envelope(rows, 43),
      summary: {
        totalAmount: 98_765_000,
        paidAmount: 87_654_000,
        unpaidAmount: 11_111_000,
        paidCount: 39,
        unpaidCount: 4,
      },
    });
    renderPage();
    await screen.findByText('Garage Auto 123');

    // Server full-set figures — unreachable from the two-row page fixture.
    expect(screen.getByText('11.111.000 ₫')).toBeTruthy();
    expect(screen.getByText('87.654.000 ₫')).toBeTruthy();
  });

  it('sorts server-side: header click sends sortBy/sortDir and resets the page', async () => {
    renderPage();
    await screen.findByText('Garage Auto 123');

    // Move to page 2 first so the sort's page reset is observable.
    fireEvent.click(screen.getByRole('button', { name: '2' }));
    await waitFor(() => {
      expect(apiGet).toHaveBeenCalledWith('/expenses?page=2&limit=20');
    });

    // Fresh column starts ascending, on page 1.
    fireEvent.click(screen.getByRole('button', { name: 'Số tiền' }));
    await waitFor(() => {
      expect(apiGet).toHaveBeenCalledWith('/expenses?page=1&limit=20&sortBy=amount&sortDir=asc');
    });

    // Same header flips to descending.
    fireEvent.click(screen.getByRole('button', { name: 'Số tiền' }));
    await waitFor(() => {
      expect(apiGet).toHaveBeenCalledWith('/expenses?page=1&limit=20&sortBy=amount&sortDir=desc');
    });
  });
});


// Dual-control review surface (QA-086 FE): pending rows badge as Chờ kiểm
// tra, checked rows offer role-gated Duyệt/Từ chối, and the review actions
// post to the approval endpoints then refetch.
describe('ExpenseListPage direct records', () => {
  beforeEach(() => {
    apiPost.mockReset().mockResolvedValue({});
    useAuthMock.mockReturnValue({ user: null });
  });

  it('badges a pending row and hides review actions without a role', async () => {
    apiGet.mockResolvedValueOnce(envelope([{ ...rows[0]!, id: 101, approvalStatus: 'PENDING' }]));
    renderPage();
    expect(await screen.findByText('Cần hoàn thiện')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Kiểm tra' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Duyệt' })).toBeNull();
  });

  it('keeps legacy drafts editable without restoring review actions for admins', async () => {
    useAuthMock.mockReturnValue({ user: { role: 'ADMIN', userId: 1, username: 'admin' } });
    apiGet.mockResolvedValue(envelope([{ ...rows[0]!, id: 102, approvalStatus: 'CHECKED' }]));
    renderPage();
    expect(await screen.findByText('Cần hoàn thiện')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Duyệt' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Kiểm tra' })).toBeNull();
    expect(apiPost).not.toHaveBeenCalled();
  });

  it('keeps posted payment badges for approved legacy rows', async () => {
    apiGet.mockResolvedValueOnce(envelope([{ ...rows[0]!, id: 103 }]));
    renderPage();
    expect(await screen.findByText('Ghi nợ')).toBeTruthy();
  });
});

// FIN-POL-01a: empty date fields still have visible context and reversible filters.
// Card 20260927_152: Từ/Đến are the shared `DateRangeFields` group — two
// independent fields inside one `role="group"`. The contract is preserved:
// both inputs are empty by default, individually keyboard-addressable, and the
// reset still wipes both.
it('keeps visible date labels and clears the selected date range', async () => {
  renderPage();
  await screen.findByText('Garage Auto 123');
  // Both inputs are individually addressable by their labels inside the
  // shared date-range group.
  const rangeGroup = screen.getByRole('group', { name: 'Khoảng ngày' });
  expect(rangeGroup).toContainElement(screen.getByLabelText('Từ ngày'));
  expect(rangeGroup).toContainElement(screen.getByLabelText('Đến ngày'));
  expect(screen.getByLabelText('Từ ngày')).toHaveValue('');
  expect(screen.getByLabelText('Đến ngày')).toHaveValue('');
  fireEvent.change(screen.getByLabelText('Từ ngày'), { target: { value: '01/08/2026' } });
  fireEvent.change(screen.getByLabelText('Đến ngày'), { target: { value: '31/08/2026' } });
  fireEvent.click(await screen.findByRole('button', { name: 'Xóa bộ lọc' }));
  expect(screen.getByLabelText('Từ ngày')).toHaveValue('');
  expect(screen.getByLabelText('Đến ngày')).toHaveValue('');
});

// ─────────────────────────────────────────────────────────────────────────────
// SIL-471 — data-dense: ngày 1 dòng với badge "Nhập" inline, cột hằng số
// THÀNH PHẦN gộp vào ô Xe, phân trang ẩn khi ≤1 trang, empty state gọn.
describe('ExpenseListPage data-dense density (SIL-471)', () => {
  function mountEnvelope(items: ExpenseWithRefs[], total = items.length) {
    apiGet.mockReset();
    apiGet.mockResolvedValue(envelope(items, total));
    return renderPage();
  }

  it('renders the entry date as an inline badge — the date cell keeps one line', async () => {
    mountEnvelope(rows);
    await screen.findByText('Garage Auto 123');

    // rows[0] nhập 21/08 ≠ phát sinh 20/08 → badge cạnh ngày, không còn div phụ.
    const badge = screen.getByText(/Nhập 21\/08\/2026/);
    expect(badge.className).toContain('expense-record-table__entry-badge');
    expect(badge.closest('td')!.querySelector('.expense-record-table__entry-date')).toBeNull();
    // QA wave 8cea1a6b AC2: the badge is UNCONDITIONAL — a same-date record
    // still carries its entry date ("Nhập 19/08/2026"), it no longer renders
    // a bare date cell.
    expect(screen.getByText(/Nhập 19\/08\/2026/).className).toContain('expense-record-table__entry-badge');
  });

  it('reads an incomplete slip as "Nháp" in the date cell (QA wave 8cea1a6b AC2)', async () => {
    mountEnvelope([{ ...rows[0]!, id: 104, approvalStatus: 'DRAFT' }]);
    await screen.findByText('Garage Auto 123');

    const draftBadge = screen.getByText('Nháp');
    expect(draftBadge.className).toContain('expense-record-table__entry-badge');
    // A draft row shows the draft marker, not an entry-date badge.
    expect(screen.queryByText(/Nhập /)).toBeNull();
  });

  it('drops the constant THÀNH PHẦN column and folds the component into the Xe cell', async () => {
    mountEnvelope(rows);
    await screen.findByText('Garage Auto 123');

    expect(screen.queryByRole('columnheader', { name: 'Thành phần' })).toBeNull();
    // Truck row: plate + muted component suffix in the same cell.
    const xeCell = screen.getByText('51H-123.45').closest('td')!;
    expect(xeCell.dataset.label).toBe('Xe');
    expect(xeCell.querySelector('.expense-record-table__component')!.textContent).toBe('Đầu kéo');
    // Non-vehicle row keeps its quiet dash with no invented component.
    const emptyCell = screen.getByText('—').closest('td')!;
    expect(emptyCell.dataset.label).toBe('Xe');
    expect(emptyCell.querySelector('.expense-record-table__component')).toBeNull();
  });

  it('hides pagination entirely when the set fits one page, count stays in the rail', async () => {
    const { container } = mountEnvelope(rows, 2);
    await screen.findByText('Garage Auto 123');

    expect(container.querySelector('.ds-pagination')).toBeNull();
    // The phiếu counts live in the summary rail, not in pagination controls.
    const rail = screen.getByRole('region', { name: 'Tóm tắt chi phí' });
    expect(rail.textContent).toContain('phiếu');
  });

  it('keeps pagination controls for a multi-page set', async () => {
    mountEnvelope(rows, 43);
    await screen.findByText('Garage Auto 123');
    // 43 / 20 → 3 trang: control trang phải có mặt.
    expect(screen.getByRole('button', { name: '2' })).toBeTruthy();
  });

  it('renders a compact in-table empty state with no illustration band (≤120px)', async () => {
    apiGet.mockReset();
    apiGet.mockResolvedValue(envelope([], 0));
    const { container } = renderPage();
    await screen.findByText('Chưa có khoản chi phí nào.');

    // The page mounts the shared compact face...
    const empty = container.querySelector('.ds-empty-state--compact')!;
    expect(empty).toBeTruthy();
    expect(empty.querySelector('button')).toBeTruthy();
    // ...and the page stylesheet strips its illustration band + padding so the
    // in-table empty face stays ≤120px (jsdom cannot compute the cascade).
    const css = readFileSync(resolve(process.cwd(), 'src/pages/ExpenseListRecordTable.css'), 'utf8');
    expect(css).toMatch(/\.expense-record-table \.ds-empty-state--compact \{ padding: 14px 16px; \}/);
    expect(css).toMatch(/\.expense-record-table \.ds-empty-state--compact \.ds-empty-state__illustration \{ display: none; \}/);
  });
});
