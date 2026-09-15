import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AdminAdvanceSettlementsPage from './AdminAdvanceSettlementsPage';

const { settlementsQuery } = vi.hoisted(() => ({ settlementsQuery: vi.fn() }));
vi.mock('../hooks/useForwarderQueries', () => ({
  useAdminSettlements: settlementsQuery,
  useAdminAdvanceBalances: () => ({ data: { items: [], totalOutstanding: 0 } }),
}));
vi.mock('../hooks/animations', () => ({ usePageAnimations: () => ({ rootRef: { current: null } }) }));

const response = { items: [], totalPages: 1, statusCounts: { DRAFT: 4, RECORDED: 3 }, statusAmounts: {} };
beforeEach(() => settlementsQuery.mockReset().mockReturnValue({ data: response, isLoading: false }));

function renderPage() {
  return render(<MemoryRouter><AdminAdvanceSettlementsPage /></MemoryRouter>);
}

describe('AdminAdvanceSettlementsPage draft filter', () => {
  it('uses the full-set draft count and sends the exact draft status', () => {
    const { container } = renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Chưa hoàn tất4' }));
    expect(settlementsQuery).toHaveBeenLastCalledWith({ status: 'DRAFT', page: 1, limit: 50 });
    expect(container).not.toHaveTextContent('undefined');
    expect(screen.getByRole('button', { name: 'Tất cả7' })).toBeInTheDocument();
  });

  it('renders zero when the server has no draft records', () => {
    settlementsQuery.mockReturnValue({ data: { ...response, statusCounts: { RECORDED: 3 } }, isLoading: false });
    const { container } = renderPage();
    expect(screen.getByRole('button', { name: 'Chưa hoàn tất0' })).toBeInTheDocument();
    expect(container).not.toHaveTextContent('undefined');
  });
});
