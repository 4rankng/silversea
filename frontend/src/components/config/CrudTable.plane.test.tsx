import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

const { state } = vi.hoisted(() => ({
  state: { data: undefined as undefined | Array<{ id: number; name: string }>, isLoading: false, isError: false, isFetching: false },
}));
vi.mock('@tanstack/react-query', () => ({ useQuery: () => ({ ...state, refetch: vi.fn() }) }));
vi.mock('../../hooks/useCRUD', () => ({ useCRUD: () => ({ setEditingId: vi.fn(), setShowAddForm: vi.fn(), doDelete: vi.fn(), cancelForm: vi.fn(), editingId: null, showAddForm: false }) }));
vi.mock('../../design-system', () => ({ EmptyState: ({ title }: { title: string }) => <div>{title}</div> }));
vi.mock('../UI', () => ({
  PageHeader: () => null,
  Panel: ({ children }: { children: ReactNode }) => <div className="panel">{children}</div>,
  Modal: () => null,
  useConfirm: () => ({ confirm: vi.fn(), dialog: null }),
}));

import { CrudTable } from './CrudTable';

/**
 * Card 20260927_152 — the shell renders the ONE shared filter plane.
 *
 * `CrudTable` is the table shell behind every catalogue config page, so a
 * page-local plane growing back inside it re-introduces the hand-rolled row on
 * ~20 surfaces at once. These are the structural facts the shared bar owns:
 * one `.filter-bar.list-filter-bar` strip holding the search, the result
 * counter and the primary action, no `.toolbar` row of the shell's own, and the
 * strip is its own card rather than a nested one inside the table panel.
 */
describe('catalogue shell renders the shared filter plane', () => {
  const mount = () => {
    state.data = [{ id: 7, name: 'Xe đầu kéo' }, { id: 8, name: 'Rơ-moóc' }];
    state.isLoading = state.isError = state.isFetching = false;
    return render(
      <MemoryRouter>
        <CrudTable<{ id: number; name: string }>
          title="Phương tiện"
          description="Danh mục"
          endpoint="/trucks"
          colSpan={1}
          columns={[{ header: 'Tên', render: (item) => <span>{item.name}</span> }]}
          renderForm={() => null}
        />
      </MemoryRouter>,
    );
  };

  it('hosts the search, the counter and the primary action in the one bar', () => {
    const { container } = mount();
    const bar = container.querySelector('.filter-bar.list-filter-bar');
    expect(bar).not.toBeNull();
    expect(container.querySelector('.toolbar')).toBeNull();

    // The search keeps the accessible name and placeholder the pages shipped.
    const search = within(bar as HTMLElement).getByRole('searchbox', { name: 'Tìm trong phương tiện' });
    expect(search).toHaveAttribute('placeholder', 'Tìm trong danh mục…');

    expect(bar?.querySelector('.cfg-catalogue-summary')?.textContent).toContain('2 mục');
    expect(within(bar as HTMLElement).getByRole('button', { name: /Thêm mới/ })).toBeVisible();
  });

  it('keeps the bar out of the table panel so the strip is one card, not a nested one', () => {
    const { container } = mount();
    const bar = container.querySelector('.filter-bar.list-filter-bar');
    const panel = container.querySelector('.panel');
    expect(panel).not.toBeNull();
    expect(panel?.contains(bar as Node)).toBe(false);
    // The catalogue table itself stays inside the panel.
    expect(panel?.querySelector('table.record-table')).not.toBeNull();
  });

  it('renders no `Bộ lọc` trigger — the shell has no secondary criterion to fold', () => {
    mount();
    expect(screen.queryByRole('button', { name: /^Bộ lọc/ })).not.toBeInTheDocument();
  });
});
