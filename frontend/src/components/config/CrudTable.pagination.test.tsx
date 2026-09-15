import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { CrudTable } from './CrudTable';

const { get, renderColumn } = vi.hoisted(() => ({ get: vi.fn(), renderColumn: vi.fn() }));
vi.mock('../../lib/api', () => ({ api: { get } }));
vi.mock('../../hooks/useCRUD', () => ({ useCRUD: () => ({ setEditingId: vi.fn(), setShowAddForm: vi.fn(), doDelete: vi.fn(), cancelForm: vi.fn(), editingId: null, showAddForm: false }) }));
vi.mock('../../design-system', () => ({ EmptyState: ({ title }: { title: string }) => <div>{title}</div> }));
vi.mock('../UI', () => ({ PageHeader: () => null, Panel: ({ children }: { children: ReactNode }) => <div>{children}</div>, Modal: () => null, useConfirm: () => ({ confirm: vi.fn(), dialog: null }) }));

beforeEach(() => { get.mockReset(); renderColumn.mockReset(); });
const records = Array.from({ length: 101 }, (_, index) => ({ id: index + 1, name: `Xe ${index + 1}` }));
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter><CrudTable<{ id: number; name: string }> title="Xe" description="Danh mục" endpoint="/trucks" colSpan={1} columns={[{ header: 'Tên', render: (item, _index, _active, items) => { renderColumn(items.length); return item.name; } }]} renderForm={() => null} /></MemoryRouter></QueryClientProvider>);
}

it('makes page-two records searchable and keeps the complete aggregate collection', async () => {
  get.mockImplementation(async (path: string) => {
    const page = Number(new URL(path, 'http://test').searchParams.get('page'));
    return { items: page === 1 ? records.slice(0, 100) : records.slice(100), total: 101, page, pageSize: 100 };
  });
  mount();
  expect(await screen.findByText('Xe 101')).toBeVisible();
  expect(get).toHaveBeenCalledTimes(2);
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Xe 101' } });
  expect(screen.queryByText('Xe 1')).not.toBeInTheDocument();
  expect(screen.getByText('Xe 101')).toBeVisible();
  expect(renderColumn.mock.calls.every(([size]) => size === 101)).toBe(true);
});

it('rejects partial catalogues and recovers all rows when the failed page is retried', async () => {
  let failSecondPage = true;
  get.mockImplementation(async (path: string) => {
    const page = Number(new URL(path, 'http://test').searchParams.get('page'));
    if (page === 2 && failSecondPage) throw new Error('Connection interrupted');
    return { items: page === 1 ? records.slice(0, 100) : records.slice(100), total: 101, page, pageSize: 100 };
  });
  mount();
  expect(await screen.findByRole('alert')).toHaveTextContent('Không tải được danh mục');
  expect(screen.queryByText('Xe 1')).not.toBeInTheDocument();
  failSecondPage = false;
  fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
  await waitFor(() => expect(screen.getByText('Xe 101')).toBeVisible());
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
