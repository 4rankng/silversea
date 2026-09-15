import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import NotFoundPage from './NotFoundPage';

const { state } = vi.hoisted(() => ({ state: { role: 'ADMIN' } }));
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: { role: state.role } }) }));

describe('unknown page recovery', () => {
  it.each([['ADMIN', '/config'], ['CUSTOMER', '/portal/shipments'], ['OPS', '/my-orders']])('keeps %s recovery inside its permitted workspace', (role, target) => {
    state.role = role;
    render(<MemoryRouter><NotFoundPage /></MemoryRouter>);
    expect(screen.getByRole('heading', { name: 'Không tìm thấy trang' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Về trang chính' })).toHaveAttribute('href', target);
  });
});
