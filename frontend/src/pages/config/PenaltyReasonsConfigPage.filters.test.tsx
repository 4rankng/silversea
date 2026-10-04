/**
 * Card 20260927_152 — `/config/penalty-reasons` rides the shared
 * the `FilterBar` band.
 *
 * The hand-rolled bar (its own `.filter-bar__search` shell, `.filter-bar__spacer`
 * and `filter-tab` toggles) is gone, so these pin the BEHAVIOUR it drove — the
 * severity filter, the text search and the amount sort — through the shared
 * slots.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type * as ApiModule from '../../lib/api';
import type * as ConfigClientModule from '../../api/configClient';
import type * as UiModule from '../../components/UI';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { apiGetMock, getPenaltyReasonsMock } = vi.hoisted(() => ({
  apiGetMock: vi.fn(),
  getPenaltyReasonsMock: vi.fn(),
}));

vi.mock('../../lib/api', async (importOriginal) => {
  const original = await importOriginal<typeof ApiModule>();
  return { ...original, api: { ...original.api, get: apiGetMock } };
});

vi.mock('../../api/configClient', async (importOriginal) => {
  const original = await importOriginal<typeof ConfigClientModule>();
  return {
    ...original,
    configClient: { ...original.configClient, getPenaltyReasons: getPenaltyReasonsMock },
  };
});

vi.mock('../../components/UI', async (importOriginal) => {
  const original = await importOriginal<typeof UiModule>();
  return { ...original, useConfirm: () => ({ confirm: vi.fn(), dialog: null }) };
});

vi.mock('../../hooks/useCRUD', () => ({
  useCRUD: () => ({
    showAddForm: false,
    editingId: null,
    saving: false,
    setEditingId: vi.fn(),
    cancelForm: vi.fn(),
    doCreate: vi.fn(),
    doUpdate: vi.fn(),
    doDelete: vi.fn(),
  }),
}));

vi.mock('../../hooks/animations', () => ({
  usePageAnimations: () => ({ rootRef: { current: null } }),
}));

vi.mock('../../hooks/useBackShortcut', () => ({ useBackShortcut: vi.fn() }));

import PenaltyReasonsConfigPage from './PenaltyReasonsConfigPage';

const reasons = [
  { id: 1, reasonText: 'Chạy quá tốc độ', severity: 'high', defaultAmount: 500000, updatedAt: '2026-07-01' },
  { id: 2, reasonText: 'Đi sai tuyến', severity: 'mid', defaultAmount: 200000, updatedAt: '2026-07-02' },
  { id: 3, reasonText: 'Quên bật đèn', severity: 'low', defaultAmount: 100000, updatedAt: '2026-07-03' },
];

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <PenaltyReasonsConfigPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  getPenaltyReasonsMock.mockReset().mockResolvedValue(reasons);
  apiGetMock.mockReset().mockResolvedValue({
    totalCount: 3,
    totalAmount: 800000,
    countsByReason: {},
    period: { month: 7, year: 2026 },
  });
});

describe('PenaltyReasonsConfigPage filter strip', () => {
  // Card 20261004_333 — a failed list fetch must not fall through to the
  // "Không tìm thấy lỗi vi phạm" empty-state, and a failed stats fetch must
  // not fabricate "0 lượt".
  it('shows the fetch-error state with retry instead of the empty catalog when the list query fails', { timeout: 15000 }, async () => {
    getPenaltyReasonsMock.mockRejectedValue(new Error('500'));
    renderPage();
    expect(await screen.findByText('Không thể tải danh sách lỗi vi phạm', undefined, { timeout: 10000 })).toBeVisible();
    expect(screen.queryByText('Không tìm thấy lỗi vi phạm')).not.toBeInTheDocument();

    getPenaltyReasonsMock.mockResolvedValue(reasons);
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    expect(await screen.findByText('Chạy quá tốc độ')).toBeVisible();
    expect(getPenaltyReasonsMock.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('keeps the true-empty state only when the query succeeded with zero items', async () => {
    getPenaltyReasonsMock.mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText('Không tìm thấy lỗi vi phạm')).toBeVisible();
    expect(screen.queryByText('Không thể tải danh sách lỗi vi phạm')).not.toBeInTheDocument();
  });

  it('prints a dash instead of a fabricated zero when the stats query failed', async () => {
    apiGetMock.mockRejectedValue(new Error('500'));
    renderPage();
    expect(await screen.findByText('Chạy quá tốc độ')).toBeVisible();
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(3);
    expect(screen.queryByText('lượt')).not.toBeInTheDocument();
  });

  it('renders the shared bar with the search slot, the severity toggles and the sort action', async () => {
    const { container } = renderPage();
    expect(await screen.findByText('Chạy quá tốc độ')).toBeInTheDocument();

    const bar = container.querySelector('.filter-bar.list-filter-bar') as HTMLElement;
    expect(bar).not.toBeNull();
    expect(container.querySelectorAll('.filter-bar').length).toBe(1);

    const input = within(bar).getByRole('textbox', { name: 'Tìm kiếm lỗi vi phạm' });
    expect(input.getAttribute('name')).toBe('penaltyReasonSearch');
    expect(input.getAttribute('placeholder')).toBe('Tìm kiếm lỗi vi phạm…');

    const chips = [...bar.querySelectorAll('button.filter-chip')];
    expect(chips.map(chip => chip.textContent)).toEqual(['Tất cả', 'Nghiêm trọng', 'Trung bình', 'Nhẹ']);
    expect(chips[0]!.getAttribute('aria-pressed')).toBe('true');

    expect(within(bar).getByRole('button', { name: 'Cao → thấp' })).toBeInTheDocument();
  });

  it('narrows the list from the text search', async () => {
    renderPage();
    expect(await screen.findByText('Chạy quá tốc độ')).toBeInTheDocument();

    fireEvent.change(screen.getByRole('textbox', { name: 'Tìm kiếm lỗi vi phạm' }), {
      target: { value: 'đèn' },
    });

    await waitFor(() => expect(screen.queryByText('Chạy quá tốc độ')).toBeNull());
    expect(screen.getByText('Quên bật đèn')).toBeInTheDocument();
  });

  it('narrows the list from a severity toggle and reports it pressed', async () => {
    renderPage();
    expect(await screen.findByText('Chạy quá tốc độ')).toBeInTheDocument();

    const midChip = screen.getByRole('button', { name: 'Trung bình' });
    fireEvent.click(midChip);

    expect(midChip.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText('Đi sai tuyến')).toBeInTheDocument();
    expect(screen.queryByText('Chạy quá tốc độ')).toBeNull();
    expect(screen.queryByText('Quên bật đèn')).toBeNull();
  });

  it('keeps the page free of hand-rolled bar markup', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/pages/config/PenaltyReasonsConfigPage.tsx'), 'utf8');
    expect(source).toContain("import { EmptyState, FilterBar } from '../../design-system';");
    expect(source).toContain('<FilterBar');
    expect(source).not.toContain('className="filter-bar"');
    expect(source).not.toContain('filter-bar__search');
    expect(source).not.toContain('filter-bar__spacer');
  });
});
