import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Role } from '@tingting/shared';

const { useAuthMock } = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
}));

vi.mock('./hooks/useAuth', async () => {
  const actual = await vi.importActual<typeof import('./hooks/useAuth')>('./hooks/useAuth');
  return {
    ...actual,
    useAuth: useAuthMock,
  };
});

vi.mock('./components/Layout', async () => {
  const actual = await vi.importActual<typeof import('./components/Layout')>('./components/Layout');
  return {
    ...actual,
    default: ({ children }: { children: React.ReactNode }) => <div data-testid="layout-shell">{children}</div>,
  };
});

vi.mock('./pages/AuditLogPage', () => ({
  default: () => <div>Audit log test page</div>,
}));

import { AppRoutes } from './App';

describe('AppRoutes accountant audit access', () => {
  beforeEach(() => {
    useAuthMock.mockReset();
    useAuthMock.mockReturnValue({
      user: {
        userId: 17,
        username: 'ketoan',
        email: 'ketoan@example.com',
        phone: null,
        role: Role.ACCOUNTANT,
        fullName: 'Kế toán',
      },
      logout: vi.fn(),
      login: vi.fn(),
      updateUser: vi.fn(),
      isAuthenticated: true,
      loading: false,
      sessionExpired: false,
    });
  });

  it('renders the audit page directly for ACCOUNTANT at /audit-logs', async () => {
    render(
      <MemoryRouter initialEntries={['/audit-logs']}>
        <AppRoutes />
      </MemoryRouter>,
    );

    expect(await screen.findByText('Audit log test page')).toBeTruthy();
    expect(screen.getByTestId('layout-shell')).toBeTruthy();
  });
});
