import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ConfigPage from './ConfigPage';

const { state } = vi.hoisted(() => ({ state: { role: 'ADMIN', queries: [] as Array<{ data: unknown; isLoading: boolean; isError: boolean; isFetching: boolean; refetch: ReturnType<typeof vi.fn> }> } }));
vi.mock('@tanstack/react-query', () => ({
  useQueries: () => state.queries,
  // Singleton count queries (quotations, fuel-consumption-norms) ride
  // useQuery — same uniform { total: 3 } shape as the summary array.
  useQuery: () => ({ data: { total: 3 }, isLoading: false, isError: false, isFetching: false, refetch: vi.fn().mockResolvedValue({}) }),
}));
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: { role: state.role } }) }));
vi.mock('../hooks/animations', () => ({ usePageAnimations: () => ({ rootRef: { current: null } }) }));

describe('configuration discovery and partial failures', () => {
  beforeEach(() => {
    state.role = 'ADMIN';
    // Length must cover every query `ConfigPage` requests (currently 20 —
    // the last is `freightRateTerms`); the mock returns a uniform { total: 3 }
    // so index 0..N are all defined and the destructuring in ConfigPage never
    // reads undefined. Bump when a query is added to the summary list.
    state.queries = Array.from({ length: 20 }, () => ({ data: { total: 3 }, isLoading: false, isError: false, isFetching: false, refetch: vi.fn().mockResolvedValue({}) }));
  });
  const mount = () => render(<MemoryRouter><ConfigPage /></MemoryRouter>);

  it('offers a local accent-insensitive search and recovery from no matches', () => {
    mount();
    const search = screen.getByRole('searchbox', { name: 'Tìm cấu hình' });
    fireEvent.change(search, { target: { value: 'ro-mooc' } });
    expect(screen.getByRole('button', { name: /Rơ-moóc Danh sách/ })).toBeVisible();
    expect(screen.queryByRole('button', { name: /Thông tin công ty Tên pháp lý/ })).not.toBeInTheDocument();
    fireEvent.change(search, { target: { value: 'no-such-config' } });
    expect(screen.getByText('Không tìm thấy cấu hình')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Hiện tất cả cấu hình' }));
    expect(search).toHaveValue('');
    expect(screen.getByRole('button', { name: /Thông tin công ty Tên pháp lý/ })).toBeVisible();
  });

  it('shows failed summaries as unavailable, retains navigation, and retries only failed reads', () => {
    // Company-info is the 16th query (index 15) in ConfigPage's summary list —
    // index 14 is fuelConfig. Keep this in sync with the `useQueries` order.
    state.queries[15] = { ...state.queries[15]!, data: undefined, isError: true };
    mount();
    const company = screen.getByRole('button', { name: /Thông tin công ty Tên pháp lý/ });
    expect(company).not.toBeDisabled();
    expect(within(company).getByText('Không tải được')).toBeVisible();
    expect(within(company).queryByText('Chưa cấu hình')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    expect(state.queries[15]!.refetch).toHaveBeenCalledTimes(1);
    expect(state.queries[0]!.refetch).not.toHaveBeenCalled();
  });

  it('does not expose administrator-only configuration to manager searches', () => {
    state.role = 'MANAGER';
    mount();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Tìm cấu hình' }), { target: { value: 'Master Data' } });
    expect(screen.getByText('Không tìm thấy cấu hình')).toBeVisible();
    expect(screen.queryByRole('button', { name: /Nạp dữ liệu nền tảng Kiểm tra/ })).not.toBeInTheDocument();
  });
});
