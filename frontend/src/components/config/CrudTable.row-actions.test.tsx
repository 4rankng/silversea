import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

const { confirm, doDelete, setEditingId, setShowAddForm, queryData } = vi.hoisted(() => ({
  confirm: vi.fn(),
  doDelete: vi.fn(),
  setEditingId: vi.fn(),
  setShowAddForm: vi.fn(),
  queryData: { items: [] as Array<{ id: number; name: string; updatedAt?: string }> },
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: vi.fn(() => ({ data: queryData.items, refetch: vi.fn() })),
}));
vi.mock('../../hooks/useCRUD', () => ({
  useCRUD: () => ({
    setEditingId, setShowAddForm, doDelete, cancelForm: vi.fn(),
    editingId: null, showAddForm: false, saving: false, deleting: null, error: null,
    doCreate: vi.fn(), doUpdate: vi.fn(),
  }),
}));
vi.mock('../../design-system', () => ({ EmptyState: ({ variant }: { variant?: string }) => <div data-testid="empty" data-variant={variant ?? 'default'} /> }));
vi.mock('../UI', () => ({
  PageHeader: () => null,
  Panel: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Modal: () => null,
  useConfirm: () => ({ confirm, dialog: null }),
}));

import { CrudTable } from './CrudTable';

function renderTable(props: Partial<Parameters<typeof CrudTable>[0]> = {}) {
  render(
    <MemoryRouter>
      <CrudTable<{ id: number; name: string; updatedAt?: string }>
        title="Kỳ giá" description="Danh mục" endpoint="/fuel-price-periods" colSpan={1}
        columns={[{ header: 'Tên', render: (item) => item.name }]}
        renderForm={() => null}
        {...props}
      />
    </MemoryRouter>,
  );
}

describe('CrudTable SIL-466 capabilities', () => {
  beforeEach(() => {
    queryData.items = [{ id: 7, name: 'Kỳ 02/10', updatedAt: '2026-10-02T00:00:00Z' }];
    confirm.mockReset().mockResolvedValue(true);
    doDelete.mockReset().mockResolvedValue(undefined);
    setEditingId.mockReset();
    setShowAddForm.mockReset();
  });

  it('keeps the shared default: STT column, generic placeholder, no action cell', () => {
    renderTable();
    expect(screen.getByText('STT')).toBeTruthy();
    expect(screen.getByPlaceholderText('Tìm trong danh mục…')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Sửa kỳ giá' })).toBeNull();
  });

  it('rowActions pins Sửa/Xóa on the row; Sửa opens the editor, Xóa confirms then deletes', async () => {
    renderTable({ rowActions: true });
    fireEvent.click(screen.getByRole('button', { name: 'Sửa kỳ giá' }));
    expect(setEditingId).toHaveBeenCalledWith(7);

    fireEvent.click(screen.getByRole('button', { name: 'Xóa kỳ giá' }));
    await vi.waitFor(() => expect(confirm).toHaveBeenCalledWith('Bạn có chắc chắn muốn xóa kỳ giá này?', expect.objectContaining({ variant: 'danger', confirmLabel: 'Xóa' })));
    await vi.waitFor(() => expect(doDelete).toHaveBeenCalledWith(7, '2026-10-02T00:00:00Z'));
  });

  it('showIndex=false drops the STT column page-scoped', () => {
    renderTable({ showIndex: false });
    expect(screen.queryByText('STT')).toBeNull();
  });

  it('searchPlaceholder and emptyVariant ride through to the shared shells', () => {
    queryData.items = [];
    renderTable({ searchPlaceholder: 'Tìm theo ngày hiệu lực, ghi chú…', emptyVariant: 'compact' });
    expect(screen.getByPlaceholderText('Tìm theo ngày hiệu lực, ghi chú…')).toBeTruthy();
    expect(screen.getByTestId('empty').getAttribute('data-variant')).toBe('compact');
    queryData.items = [{ id: 7, name: 'Kỳ 02/10', updatedAt: '2026-10-02T00:00:00Z' }];
  });

  it('a declined confirm never reaches doDelete', async () => {
    confirm.mockResolvedValue(false);
    renderTable({ rowActions: true });
    fireEvent.click(screen.getByRole('button', { name: 'Xóa kỳ giá' }));
    await vi.waitFor(() => expect(confirm).toHaveBeenCalled());
    expect(doDelete).not.toHaveBeenCalled();
  });
});
