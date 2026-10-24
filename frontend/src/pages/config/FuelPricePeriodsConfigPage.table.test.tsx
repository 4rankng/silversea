import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { ReactNode } from 'react';

const { fetchAllPaginated, confirm, doDelete, setEditingId } = vi.hoisted(() => ({
  fetchAllPaginated: vi.fn(),
  confirm: vi.fn(),
  doDelete: vi.fn(),
  setEditingId: vi.fn(),
}));

vi.mock('../../lib/http/paginate', () => ({ fetchAllPaginated }));

vi.mock('../../api/quotationClient', () => ({
  quotationClient: { listFuelApprovals: vi.fn(async () => ({ items: [], total: 0 })), decideFuelApprovals: vi.fn() },
}));

vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({ user: { role: 'ACCOUNTANT', capabilities: [] } }),
}));

vi.mock('../../hooks/animations', () => ({
  usePageAnimations: () => ({ rootRef: { current: null } }),
}));

vi.mock('../../components/UI', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../components/UI')>();
  return {
    ...actual,
    PageHeader: () => null,
    Panel: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    Modal: () => null,
    useConfirm: () => ({ confirm, dialog: null }),
  };
});

vi.mock('../../hooks/useCRUD', () => ({
  useCRUD: () => ({
    setEditingId, setShowAddForm: vi.fn(), doDelete, cancelForm: vi.fn(),
    editingId: null, showAddForm: false, saving: false, deleting: null, error: null,
    doCreate: vi.fn(), doUpdate: vi.fn(),
  }),
}));

import FuelPricePeriodsConfigPage from './FuelPricePeriodsConfigPage';
import type { FuelPricePeriodRow } from '../../api/pricingClient';

const LONG_NOTE = 'cusonboard.txt Phần 6 — giá dầu kỳ tính toán thực tế; mốc hợp đồng 17.842,59 (26/02) nhưng trong freight_rate_terms.base_fuel_price';

const ROWS: FuelPricePeriodRow[] = [
  { id: 2, effectiveFrom: '2026-10-02', effectiveTo: null, unitPrice: '25760.00', sourceNote: LONG_NOTE, createdBy: null, createdByName: null },
  { id: 3, effectiveFrom: '2027-01-01', effectiveTo: null, unitPrice: '22000.00', sourceNote: 'Kỳ dự kiến quý 1/2027', createdBy: 61, createdByName: 'Quản trị viên' },
  { id: 1, effectiveFrom: '2026-06-01', effectiveTo: null, unitPrice: '21000.00', sourceNote: 'Petrolimex công bố kỳ 01/06', createdBy: 61, createdByName: 'Quản trị viên' },
];

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <FuelPricePeriodsConfigPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const rowFor = (date: string) => {
  const cell = screen.getByText(date).closest('tr');
  if (!cell) throw new Error(`row for ${date} not found`);
  return cell;
};

describe('FuelPricePeriodsConfigPage — SIL-466 data-dense table', () => {
  beforeEach(() => {
    fetchAllPaginated.mockReset().mockResolvedValue(ROWS);
    confirm.mockReset().mockResolvedValue(true);
    doDelete.mockReset().mockResolvedValue(undefined);
    setEditingId.mockReset();
  });

  it('badges the latest ≤ today period "Đang áp dụng" and future ones "Sắp áp dụng"', async () => {
    renderPage();
    await screen.findByText('02/10/2026');
    // The superseded June period carries no badge; the live October one does.
    expect(within(rowFor('02/10/2026')).getByText('Đang áp dụng')).toBeTruthy();
    expect(within(rowFor('01/06/2026')).queryByText('Đang áp dụng')).toBeNull();
    expect(within(rowFor('01/01/2027')).getByText('Sắp áp dụng')).toBeTruthy();
    expect(within(rowFor('01/01/2027')).queryByText('Đang áp dụng')).toBeNull();
    expect(within(rowFor('01/06/2026')).queryByText('Sắp áp dụng')).toBeNull();
  });

  it('reads the legacy null entrant as "—" — "Chưa rõ người nhập" never renders', async () => {
    renderPage();
    await screen.findByText('02/10/2026');
    expect(within(rowFor('02/10/2026')).getAllByText('—').length).toBeGreaterThanOrEqual(1);
    expect(document.body.textContent).not.toContain('Chưa rõ người nhập');
  });

  it('truncates the note to one line with the full text in its title tooltip', async () => {
    renderPage();
    await screen.findByText('02/10/2026');
    const note = within(rowFor('02/10/2026')).getByText(LONG_NOTE);
    expect(note.className).toContain('fp-note');
    expect(note.getAttribute('title')).toBe(LONG_NOTE);
  });

  it('asks by date and note, hides STT, and right-aligns the price tabularly', async () => {
    renderPage();
    await screen.findByText('02/10/2026');
    expect(screen.getByPlaceholderText('Tìm theo ngày hiệu lực, ghi chú…')).toBeTruthy();
    expect(screen.queryByText('STT')).toBeNull();
    const priceCell = within(rowFor('01/06/2026')).getByText('21.000').closest('td');
    expect(priceCell?.className).toContain('num');
  });

  it('pins Sửa/Xóa on every row; Sửa opens the editor, Xóa confirms then deletes', async () => {
    renderPage();
    await screen.findByText('02/10/2026');
    for (const date of ['02/10/2026', '01/01/2027', '01/06/2026']) {
      expect(within(rowFor(date)).getByRole('button', { name: 'Sửa giá dầu theo kỳ' })).toBeTruthy();
      expect(within(rowFor(date)).getByRole('button', { name: 'Xóa giá dầu theo kỳ' })).toBeTruthy();
    }

    fireEvent.click(within(rowFor('01/06/2026')).getByRole('button', { name: 'Sửa giá dầu theo kỳ' }));
    expect(setEditingId).toHaveBeenCalledWith(1);

    fireEvent.click(within(rowFor('02/10/2026')).getByRole('button', { name: 'Xóa giá dầu theo kỳ' }));
    await waitFor(() => expect(confirm).toHaveBeenCalledWith('Bạn có chắc chắn muốn xóa giá dầu theo kỳ này?', expect.objectContaining({ variant: 'danger', confirmLabel: 'Xóa' })));
    await waitFor(() => expect(doDelete).toHaveBeenCalledWith(2, undefined));
  });
});
