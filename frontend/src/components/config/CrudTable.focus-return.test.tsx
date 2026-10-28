import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

// Stateful useCRUD stand-in — the real hook owns the same create/edit state;
// here it only flips showAddForm/editingId so the REAL Modal (and its
// focus-return machinery) exercises the SIL-579 contract.
// Exception (ts-no-dynamic-import): vi.mock factories are hoisted above every
// static import, so a top-level `useState` cannot be referenced here — the
// module must be loaded inside the factory itself.
vi.mock('../../hooks/useCRUD', async () => {
  const { useState } = await import('react');
  return {
    useCRUD: () => {
      const [showAddForm, setShowAddForm] = useState(false);
      const [editingId, setEditingId] = useState<number | null>(null);
      return {
        showAddForm,
        editingId,
        saving: false,
        deleting: false,
        error: null,
        entityList: [],
        setShowAddForm,
        setEditingId,
        doCreate: () => Promise.resolve(),
        doUpdate: () => Promise.resolve(),
        doDelete: () => Promise.resolve(),
        cancelForm: () => {
          setShowAddForm(false);
          setEditingId(null);
        },
      };
    },
  };
});

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({
    data: [{ id: 7, name: 'Xe 51C-12345' }],
    refetch: vi.fn(),
    isLoading: false,
    isError: false,
    isFetching: false,
  }),
}));

import { CrudTable } from './CrudTable';

function renderTable() {
  return render(
    <MemoryRouter>
      <CrudTable<{ id: number; name: string }>
        title="Xe đầu kéo"
        description="Danh mục xe"
        endpoint="/trucks"
        colSpan={2}
        columns={[{ header: 'Biển số', render: (item) => item.name }]}
        renderForm={(p) => (
          <div>
            <button type="button" onClick={p.onCancel}>Hủy</button>
          </div>
        )}
      />
    </MemoryRouter>,
  );
}

// SIL-579: every /config create dialog returns focus to the page's Thêm mới
// button on close (Escape and Hủy alike) — Add → Cancel → Add without ever
// re-tabbing from the top. The edit dialog restores to its row trigger.
describe('config catalog dialog focus return (SIL-579)', () => {
  it('Escape returns focus to the Thêm mới button', async () => {
    renderTable();
    const add = screen.getByRole('button', { name: /Thêm mới/ });
    // jsdom clicks do not move focus — exactly the capture-order case the
    // live audit measured (activeElement = body at open).
    fireEvent.click(add);
    await screen.findByRole('dialog');
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(add);
  });

  it('Hủy returns focus to the Thêm mới button and Add can reopen directly', async () => {
    renderTable();
    const add = screen.getByRole('button', { name: /Thêm mới/ });
    fireEvent.click(add);
    fireEvent.click(await screen.findByRole('button', { name: 'Hủy' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(add);
    fireEvent.click(add);
    await screen.findByRole('dialog');
  });

  it('Escape on the edit dialog returns focus to the row that opened it', async () => {
    renderTable();
    const row = screen.getByRole('button', { name: 'Chỉnh sửa xe đầu kéo thứ 1' });
    fireEvent.click(row);
    await screen.findByRole('dialog');
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(row);
  });
});
