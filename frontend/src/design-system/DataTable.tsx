import type { ReactNode, CSSProperties } from 'react';
import { Pagination, type PaginationProps } from './Pagination';
import { EmptyState } from './EmptyState';
import './DataTable.css';

export interface DataTableColumn<T> {
  key: string;
  label: ReactNode;
  numeric?: boolean;
  width?: string | number;
  render?: (row: T) => ReactNode;
  accessor?: (row: T) => unknown;
}

export interface DataTableProps<T> {
  data: T[] | undefined;
  columns: DataTableColumn<T>[];
  onRowClick?: (row: T) => void;
  mobileRender?: (row: T) => ReactNode;
  rowStyle?: (row: T) => Record<string, string | number> | undefined;
  rowClassName?: (row: T) => string | undefined;
  loading?: boolean;
  emptyState?: ReactNode;
  pagination?: Omit<PaginationProps, 'page' | 'onChange'> & { page: number; onChange: (p: number) => void };
  loadingRows?: number;
  rowKey?: (row: T, idx: number) => string | number;
}

function defaultRowKey<T extends { id?: number | string }>(row: T, idx: number): string | number {
  return row.id ?? idx;
}

function cssVars(vars?: Record<string, string | number>): CSSProperties | undefined {
  if (!vars) return undefined;
  return vars as unknown as CSSProperties;
}

export function DataTable<T extends { id?: number | string }>({
  data,
  columns,
  onRowClick,
  mobileRender,
  rowStyle,
  rowClassName,
  loading,
  emptyState,
  pagination,
  loadingRows = 6,
  rowKey = defaultRowKey,
}: DataTableProps<T>) {
  const rows = data ?? [];
  const isLoading = loading && rows.length === 0;

  if (isLoading) {
    return (
      <div className="ds-table-wrap" aria-busy="true">
        <div className="ds-table-scroll">
          <table className="ds-table">
            <thead>
              <tr>
                {columns.map((c) => (
                  <th key={c.key} className={c.numeric ? 'num' : ''} style={{ width: c.width }}>{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: loadingRows }).map((_, i) => (
                <tr key={i} className="ds-table__skeleton-row">
                  {columns.map((c) => (
                    <td key={c.key} className={c.numeric ? 'num' : ''}>
                      <span className="ds-table__skeleton-bar" />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  if (rows.length === 0) {
    return <div className="ds-table-empty">{emptyState ?? <EmptyState title="Không có dữ liệu" />}</div>;
  }

  return (
    <>
      <div className="ds-table-wrap ds-table-wrap--desktop">
        <div className="ds-table-scroll">
          <table className="ds-table">
            <thead>
              <tr>
                {columns.map((c) => (
                  <th key={c.key} className={c.numeric ? 'num' : ''} style={{ width: c.width }}>{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => {
                const k = rowKey(row, idx);
                const cls = [
                  onRowClick ? 'is-clickable' : '',
                  rowClassName?.(row) ?? '',
                ].filter(Boolean).join(' ');
                return (
                  <tr
                    key={k}
                    className={cls}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                    onKeyDown={onRowClick ? (event) => {
                      if (event.target !== event.currentTarget) return;
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        onRowClick(row);
                      }
                    } : undefined}
                    tabIndex={onRowClick ? 0 : undefined}
                    style={cssVars(rowStyle?.(row))}
                  >
                    {columns.map((c) => (
                      <td key={c.key} className={c.numeric ? 'num' : ''}>
                        {c.render
                          ? c.render(row)
                          : (c.accessor ? String(c.accessor(row) ?? '') : null)}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {pagination && <Pagination {...pagination} />}
      </div>

      {mobileRender && (
        <div className="ds-table-wrap ds-table-wrap--mobile">
          <div className="ds-mobile-list">
            {rows.map((row, idx) => {
              const k = rowKey(row, idx);
              const cls = [
                'ds-mobile-card',
                onRowClick ? 'is-clickable' : '',
                rowClassName?.(row) ?? '',
              ].filter(Boolean).join(' ');
              return (
                <div
                  key={k}
                  className={cls}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  onKeyDown={onRowClick ? (event) => {
                    if (event.target !== event.currentTarget) return;
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      onRowClick(row);
                    }
                  } : undefined}
                  style={cssVars(rowStyle?.(row))}
                  role={onRowClick ? 'button' : undefined}
                  tabIndex={onRowClick ? 0 : undefined}
                >
                  {mobileRender(row)}
                </div>
              );
            })}
          </div>
          {pagination && <Pagination {...pagination} />}
        </div>
      )}
    </>
  );
}
