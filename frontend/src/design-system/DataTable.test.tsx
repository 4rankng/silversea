import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { DataTable } from './DataTable';
import { nextTableSort, readTableSort } from '../lib/table-sort';

interface Row { id: number; name: string }

const rows: Row[] = [{ id: 1, name: 'Alpha' }, { id: 2, name: 'Beta' }];

const columns = [
  { key: 'name', label: 'Tên', sortKey: 'name' },
  { key: 'note', label: 'Ghi chú' },
];

describe('DataTable sort headers', () => {
  it('renders a sort button with aria-sort none on an inactive sortable column and no aria-sort elsewhere', () => {
    render(<DataTable data={rows} columns={columns} sort={null} onSortChange={() => {}} />);
    const nameHeader = screen.getByText('Tên').closest('th');
    const noteHeader = screen.getByText('Ghi chú').closest('th');
    expect(nameHeader?.getAttribute('aria-sort')).toBe('none');
    expect(noteHeader?.getAttribute('aria-sort')).toBeNull();
    expect(screen.getByRole('button', { name: /Tên/ })).toBeTruthy();
  });

  it('marks the active column ascending or descending', () => {
    const { rerender } = render(
      <DataTable data={rows} columns={columns} sort={{ by: 'name', dir: 'asc' }} onSortChange={() => {}} />,
    );
    expect(screen.getByText('Tên').closest('th')?.getAttribute('aria-sort')).toBe('ascending');
    rerender(
      <DataTable data={rows} columns={columns} sort={{ by: 'name', dir: 'desc' }} onSortChange={() => {}} />,
    );
    expect(screen.getByText('Tên').closest('th')?.getAttribute('aria-sort')).toBe('descending');
  });

  it('fires onSortChange with the column sortKey', () => {
    const onSortChange = vi.fn();
    render(<DataTable data={rows} columns={columns} sort={null} onSortChange={onSortChange} />);
    fireEvent.click(screen.getByRole('button', { name: /Tên/ }));
    expect(onSortChange).toHaveBeenCalledWith('name');
  });

  it('leaves headers inert without onSortChange', () => {
    render(<DataTable data={rows} columns={columns} sort={{ by: 'name', dir: 'asc' }} />);
    expect(screen.queryByRole('button', { name: /Tên/ })).toBeNull();
    expect(screen.getByText('Tên').closest('th')?.getAttribute('aria-sort')).toBeNull();
  });
});

describe('nextTableSort', () => {
  it('starts a fresh column ascending and flips the active one', () => {
    expect(nextTableSort(null, 'name')).toEqual({ by: 'name', dir: 'asc' });
    expect(nextTableSort({ by: 'name', dir: 'asc' }, 'name')).toEqual({ by: 'name', dir: 'desc' });
    expect(nextTableSort({ by: 'name', dir: 'desc' }, 'name')).toEqual({ by: 'name', dir: 'asc' });
    expect(nextTableSort({ by: 'date', dir: 'desc' }, 'name')).toEqual({ by: 'name', dir: 'asc' });
  });
});

describe('readTableSort', () => {
  it('parses param pairs and rejects absent keys', () => {
    expect(readTableSort('name', 'desc')).toEqual({ by: 'name', dir: 'desc' });
    expect(readTableSort('name', 'asc')).toEqual({ by: 'name', dir: 'asc' });
    expect(readTableSort('name', 'bogus')).toEqual({ by: 'name', dir: 'asc' });
    expect(readTableSort(null, 'desc')).toBeNull();
    expect(readTableSort('', 'asc')).toBeNull();
  });
});
