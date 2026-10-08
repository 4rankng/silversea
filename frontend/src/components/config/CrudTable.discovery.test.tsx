import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

const { state, refetch, setEditingId, renderColumn } = vi.hoisted(() => ({
  state: { data: undefined as undefined | Array<{ id: number; name: string }>, isLoading: false, isError: false, isFetching: false },
  refetch: vi.fn(), setEditingId: vi.fn(), renderColumn: vi.fn(),
}));
vi.mock('@tanstack/react-query', () => ({ useQuery: () => ({ ...state, refetch }) }));
vi.mock('../../hooks/useCRUD', () => ({ useCRUD: () => ({ setEditingId, setShowAddForm: vi.fn(), doDelete: vi.fn(), cancelForm: vi.fn(), editingId: null, showAddForm: false }) }));
vi.mock('../../design-system', () => ({ EmptyState: ({ title }: { title: string }) => <div>{title}</div> }));
vi.mock('../UI', () => ({ PageHeader: () => null, Panel: ({ children }: { children: ReactNode }) => <div>{children}</div>, Modal: () => null, useConfirm: () => ({ confirm: vi.fn(), dialog: null }) }));
import { CrudTable } from './CrudTable';

describe('catalogue discovery and recovery', () => {
  beforeEach(() => {
    state.data = [{ id: 7, name: 'Xe đầu kéo' }, { id: 8, name: 'Rơ-moóc' }];
    state.isLoading = state.isError = state.isFetching = false;
    refetch.mockReset(); setEditingId.mockReset(); renderColumn.mockReset();
  });
  const mount = () => render(<MemoryRouter><CrudTable<{ id: number; name: string }> title="Phương tiện" description="Danh mục" endpoint="/trucks" colSpan={1} columns={[{ header: 'Tên', render: (item, _index, _active, items) => { renderColumn(items); return <span>{item.name}</span>; } }]} renderForm={() => null} /></MemoryRouter>);

  it('filters translated visible text without changing aggregate inputs or record identity', () => {
    mount();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Tìm trong phương tiện' }), { target: { value: 'RO-MOOC' } });
    expect(screen.queryByText('Xe đầu kéo')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Rơ-moóc'));
    expect(setEditingId).toHaveBeenCalledWith(8);
    expect(renderColumn.mock.calls.every(([items]) => items.length === 2)).toBe(true);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'missing' } });
    expect(screen.getByText('Không có mục phù hợp.')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Xóa tìm kiếm' }));
    expect(screen.getByText('Xe đầu kéo')).toBeVisible();
  });

  it('does not present a pending or failed read as an empty catalogue', () => {
    state.data = undefined; state.isLoading = true;
    const view = mount();
    expect(screen.getByRole('status')).toHaveTextContent('Đang tải danh mục');
    expect(screen.queryByText('Chưa có dữ liệu')).not.toBeInTheDocument();
    state.isLoading = false; state.isError = true;
    view.rerender(<MemoryRouter><CrudTable<{ id: number; name: string }> title="Phương tiện" description="Danh mục" endpoint="/trucks" colSpan={1} columns={[]} renderForm={() => null} /></MemoryRouter>);
    expect(screen.getByRole('alert')).toHaveTextContent('Không tải được danh mục');
    expect(screen.queryByText('Chưa có dữ liệu')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    expect(refetch).toHaveBeenCalledOnce();
  });

  it('retains previously loaded rows when refresh fails', () => {
    state.isError = true;
    mount();
    expect(screen.getByRole('alert')).toHaveTextContent('có thể chưa cập nhật');
    expect(screen.getByText('Xe đầu kéo')).toBeVisible();
  });
});

describe('config-table presentation contract (card 061026221226)', () => {
  beforeEach(() => {
    state.data = [{ id: 7, name: 'Cảng A' }];
    state.isLoading = state.isError = state.isFetching = false;
  });
  const mount = () => render(<MemoryRouter><CrudTable<{ id: number; name: string }> title="Cảng" description="Danh mục" endpoint="/ports" colSpan={1} columns={[{ header: 'Tên', render: (item) => <span>{item.name}</span> }]} renderForm={() => null} /></MemoryRouter>);

  it('keeps the tabular frame at every width: the config table opts out of the ≤1100px label-per-cell card handoff and rides the shared scroll boundary', () => {
    const view = mount();
    const wrap = view.container.querySelector('.record-table-wrap');
    const table = view.container.querySelector('table.record-table');
    // The card handoff in record-table.css keys on these classes: the wrap
    // adopts the house horizontal-scroll boundary, and the table carries the
    // config variant whose container-query block restores the tabular frame
    // (labels stay in the thead alone — never glued into cells).
    expect(wrap).not.toBeNull();
    expect(wrap).toHaveClass('record-table-wrap--scroll');
    expect(table).toHaveClass('record-table--config');
    // The per-cell data-labels stay in the markup (screen-reader/cell
    // semantics) — the config variant's CSS is what silences their ::before.
    expect(table?.querySelector('tbody td[data-label="Tên"]')).not.toBeNull();
  });
});
