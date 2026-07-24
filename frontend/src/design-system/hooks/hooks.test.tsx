import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode } from 'react';
import { useDebouncedValue } from './useDebouncedValue';
import { useTableQueryState, type TableQueryEndpoint } from './useTableQueryState';

function withQueryClient() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

describe('useDebouncedValue', () => {
  it('returns the initial value synchronously', () => {
    const { result } = renderHook(() => useDebouncedValue('hello', 100));
    expect(result.current).toBe('hello');
  });

  it('does not change immediately when value changes', () => {
    const { result, rerender } = renderHook(
      ({ value }) => useDebouncedValue(value, 200),
      { initialProps: { value: 'a' } },
    );
    rerender({ value: 'b' });
    expect(result.current).toBe('a');
  });
});

describe('useTableQueryState', () => {
  type Row = { id: number; name: string };
  const endpoint: TableQueryEndpoint<Row, { status?: string }> = async () => {
    return { items: [{ id: 1, name: 'A' }], total: 1 };
  };

  it('exposes the expected surface', () => {
    const { result } = renderHook(
      () =>
        useTableQueryState<Row, { status?: string }>({
          endpoint,
          // eslint-disable-next-line @tingting/no-bare-query-key -- test fixture key; not a domain key
          queryKey: ['test'],
          defaultPageSize: 10,
        }),
      { wrapper: withQueryClient() },
    );
    expect(result.current.search).toBe('');
    expect(result.current.page).toBe(1);
    expect(result.current.pageSize).toBe(10);
    expect(result.current.total).toBe(0);
    expect(result.current.totalPages).toBe(1);
    expect(typeof result.current.setSearch).toBe('function');
    expect(typeof result.current.setFilter).toBe('function');
    expect(typeof result.current.setPage).toBe('function');
  });

  it('updates search and resets page on search/filter change', () => {
    const { result } = renderHook(
      () =>
        useTableQueryState<Row, { status?: string }>({
          endpoint,
          // eslint-disable-next-line @tingting/no-bare-query-key -- test fixture key; not a domain key
          queryKey: ['test'],
        }),
      { wrapper: withQueryClient() },
    );
    act(() => result.current.setSearch('hello'));
    expect(result.current.search).toBe('hello');
    act(() => result.current.setPage(3));
    expect(result.current.page).toBe(3);
    act(() => result.current.setSearch('world'));
    expect(result.current.search).toBe('world');
    expect(result.current.page).toBe(1);
    act(() => result.current.setPage(3));
    expect(result.current.page).toBe(3);
    act(() => result.current.setFilter('status', 'ACTIVE'));
    expect(result.current.filters.status).toBe('ACTIVE');
    expect(result.current.page).toBe(1);
  });
});
