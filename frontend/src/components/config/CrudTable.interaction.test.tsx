import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

const { setEditingId } = vi.hoisted(() => ({ setEditingId: vi.fn() }));
vi.mock('@tanstack/react-query', () => ({ useQuery: () => ({ data: [{ id: 7, name: 'Xe 51C-12345' }], refetch: vi.fn() }) }));
vi.mock('../../hooks/useCRUD', () => ({ useCRUD: () => ({ setEditingId, setShowAddForm: vi.fn(), doDelete: vi.fn(), cancelForm: vi.fn(), editingId: null, showAddForm: false }) }));
vi.mock('../../design-system', () => ({ EmptyState: () => null }));
vi.mock('../UI', () => ({
  PageHeader: () => null,
  Panel: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Modal: () => null,
  useConfirm: () => ({ confirm: vi.fn(), dialog: null }),
}));

import { CrudTable } from './CrudTable';

function renderTable() {
  render(<MemoryRouter><CrudTable<{ id: number; name: string }>
    title="Xe đầu kéo" description="Danh mục xe" endpoint="/trucks" colSpan={2}
    columns={[
      { header: 'Biển số', render: (item) => item.name },
      { header: 'Sở hữu', render: () => <a href="#owners"><span>Đối tác sở hữu</span></a> },
    ]}
    renderForm={() => null}
  /></MemoryRouter>);
}

describe('editable configuration row interaction', () => {
  beforeEach(() => setEditingId.mockClear());

  it('preserves link click and native Enter behavior without opening edit', () => {
    renderTable();
    const link = screen.getByRole('link', { name: 'Đối tác sở hữu' });
    const nativeDefaultPreserved = fireEvent.keyDown(link, { key: 'Enter' });
    fireEvent.click(screen.getByText('Đối tác sở hữu'));
    expect(nativeDefaultPreserved).toBe(true);
    expect(setEditingId).not.toHaveBeenCalled();
  });

  it.each(['Enter', ' '])('opens edit when the row itself receives %s', (key) => {
    renderTable();
    fireEvent.keyDown(screen.getByRole('button', { name: 'Chỉnh sửa xe đầu kéo thứ 1' }), { key });
    expect(setEditingId).toHaveBeenCalledWith(7);
  });

  it('opens edit from ordinary cell content', () => {
    renderTable();
    fireEvent.click(screen.getByText('Xe 51C-12345'));
    expect(setEditingId).toHaveBeenCalledWith(7);
  });
});
