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

describe('DataTable responsive row interactions', () => {
  it('keeps pagination reachable when a later page becomes empty', () => {
    const onChange = vi.fn();
    render(<DataTable data={[]} columns={columns} pagination={{ page: 2, totalPages: 2, onChange }} />);
    expect(screen.getByText('Không có dữ liệu')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Trang trước' }));
    expect(onChange).toHaveBeenCalledWith(1);
  });
  it('keeps the table available at narrow widths when no mobile view was supplied', () => {
    const { container } = render(
      <DataTable data={rows} columns={[{ key: 'name', label: 'Tên', accessor: (row) => row.name }]} />,
    );
    expect(screen.getByText('Alpha')).toBeTruthy();
    expect(container.querySelector('.ds-table-wrap--desktop')).toBeNull();
    expect(container.querySelector('.ds-table-wrap--mobile')).toBeNull();
  });

  it('only swaps to the mobile view when a renderer was supplied', () => {
    const { container } = render(<DataTable data={rows} columns={columns} mobileRender={(row) => row.name} />);
    expect(container.querySelector('.ds-table-wrap--desktop')).toBeTruthy();
    expect(container.querySelector('.ds-table-wrap--mobile')).toBeTruthy();
  });

  it('does not open a row when its nested action or form label is clicked', () => {
    const onRowClick = vi.fn();
    const action = vi.fn();
    render(
      <DataTable
        data={[rows[0]]}
        columns={[
          { key: 'name', label: 'Tên', accessor: (row) => row.name },
          { key: 'action', label: 'Thao tác', render: () => <button type="button" onClick={action}><span>Sửa</span></button> },
          { key: 'select', label: 'Chọn', render: () => <label><input type="checkbox" />Chọn dòng</label> },
        ]}
        onRowClick={onRowClick}
      />,
    );
    fireEvent.click(screen.getByText('Sửa'));
    expect(action).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByText('Chọn dòng'));
    expect(onRowClick).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Alpha'));
    expect(onRowClick).toHaveBeenCalledExactlyOnceWith(rows[0]);
    fireEvent.keyDown(screen.getByText('Alpha').closest('tr')!, { key: 'Enter' });
    expect(onRowClick).toHaveBeenCalledTimes(2);
  });

  it('keeps mobile links independent of the row click and preserves row keyboard activation', () => {
    const onRowClick = vi.fn();
    const { container } = render(
      <DataTable
        data={[rows[0]]}
        columns={columns}
        mobileRender={(row) => <><span>{row.name}</span><a href="#contact">Liên hệ</a></>}
        onRowClick={onRowClick}
      />,
    );
    fireEvent.click(screen.getByRole('link', { name: 'Liên hệ' }));
    expect(onRowClick).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Alpha'));
    fireEvent.keyDown(container.querySelector('.ds-mobile-card')!, { key: ' ' });
    expect(onRowClick).toHaveBeenCalledTimes(2);
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
