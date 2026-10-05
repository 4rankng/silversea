import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// jsdom lacks the layout observers the app shell measures with.
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn() }));
});

/**
 * Card 051026230703 — the phoi-phieu nav flash. The board is a lazy route; a
 * click navigates inside a React transition, and a SUSPENDING transition keeps
 * the previous page painted at the new URL — the Suspense loader never shows
 * (reproduced in a browser: the workspace title painted under
 * /accounting/phoi-phieu for the whole chunk fetch). The fix warms the chunk
 * for the roles the route admits, at app mount, so the first click renders the
 * board. This test pins that contract: opening ANY finance-role page must have
 * pulled the phoi-phieu page module, before that route is ever visited.
 */

const chunkState = vi.hoisted(() => ({ phoiPageLoaded: false }));

vi.mock('./pages/accounting/PhoiPhieuControlPage', () => {
  chunkState.phoiPageLoaded = true;
  return { default: () => <div data-testid="phoi-board-stub" /> };
});
vi.mock('./pages/AccountingWorkspacePage', () => ({ default: () => <div>workspace-stub</div> }));
vi.mock('./components/shared/StaleBuildBanner', () => ({ StaleBuildBanner: () => null }));
vi.mock('./hooks/useAuth', () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useAuth: () => ({
    isAuthenticated: true,
    loading: false,
    user: { id: 7, username: 'ketoan', role: 'ACCOUNTANT', fullName: 'Kế toán' },
  }),
}));

import App from './App';

function renderAppAt(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('AppRoutes — phoi-phieu chunk preload (nav flash fix)', () => {
  it('a finance-role session pulls the phoi-phieu page module without visiting it', async () => {
    renderAppAt('/accounting');
    // The workspace stub proves the app mounted and routed.
    expect(await screen.findByText('workspace-stub')).toBeTruthy();
    await waitFor(() => expect(chunkState.phoiPageLoaded).toBe(true));
  });

  it('the phoi-phieu route itself still renders its page', async () => {
    renderAppAt('/accounting/phoi-phieu');
    expect(await screen.findByTestId('phoi-board-stub')).toBeTruthy();
  });
});
