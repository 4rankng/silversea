/**
 * Card 20261008_6 — toast echo class sweep. MUTATION CATCH class pin.
 *
 * The lead ruling (2026-10-08): every error→toast mapping goes through the
 * action-error policy — a permission toast may fire only for a genuine
 * user-initiated denied action and it MUST name the action; aborted/raced
 * errors never toast; a non-403 carrying the permission body (error-shape
 * collision) is refused and the fallback stands.
 *
 * TruckOwnersConfigPage's three mutation catches (doCreate/doUpdate/doDelete)
 * echoed `e.message` verbatim into the toast, so a 403 denial rendered the bare
 * "Không có quyền truy cập" with no action named and aborts toasted the
 * English AbortError text. Tests 1-3 are honest reds: they fail against the
 * pre-fix mapping. Test 4 pins the business-refusal passthrough (verbatim at
 * 403) that must survive the migration.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../lib/api/errors';
import type * as ApiClientModule from '../../lib/api/client';
import type * as UiModule from '../../components/UI';

const { toastSpy, apiMock, confirmMock } = vi.hoisted(() => ({
  toastSpy: vi.fn(),
  confirmMock: vi.fn(),
  apiMock: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

vi.mock('../../lib/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof ApiClientModule>();
  return { ...actual, api: apiMock };
});

vi.mock('../../components/UI', async (importOriginal) => {
  const original = await importOriginal<typeof UiModule>();
  return {
    ...original,
    useConfirm: () => ({ confirm: confirmMock, dialog: null }),
  };
});

vi.mock('../../components/shared/Toast', () => ({
  useToast: () => ({ toast: toastSpy }),
}));

vi.mock('../../hooks/animations', () => ({
  usePageAnimations: () => ({ rootRef: { current: null } }),
}));

vi.mock('../../hooks/useBackShortcut', () => ({ useBackShortcut: vi.fn() }));

import TruckOwnersConfigPage from './TruckOwnersConfigPage';

const ownerRow = {
  id: 1,
  truckId: 7,
  partnerName: 'Đối tác A',
  percentage: '60.00',
  role: 'INVESTOR',
  effectiveDate: '2026-01-01',
  createdAt: '2026-01-01T00:00:00.000Z',
};

/** Toast messages fired so far — narrowed reads, no shape assumptions. */
function toastMessages(): string[] {
  return toastSpy.mock.calls.flatMap((call: unknown[]): string[] => {
    const arg: unknown = call[0];
    if (arg && typeof arg === 'object' && 'message' in arg && typeof arg.message === 'string') {
      return [arg.message];
    }
    return [];
  });
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/config/trucks/7/owners']}>
        <Routes>
          <Route path="/config/trucks/:truckId/owners" element={<TruckOwnersConfigPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  toastSpy.mockReset();
  confirmMock.mockReset().mockResolvedValue(true);
  apiMock.get.mockReset().mockImplementation((path: string) => {
    if (path === '/truck-cap') return Promise.resolve({ items: [ownerRow], total: 1 });
    return Promise.resolve({ id: 7, licensePlate: '29A-12345' });
  });
  apiMock.post.mockReset();
  apiMock.put.mockReset();
  apiMock.delete.mockReset();
});

async function deleteRow() {
  renderPage();
  expect(await screen.findByText('Đối tác A')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Xóa' }));
}

describe('mutation catch class — TruckOwnersConfigPage delete (card 20261008_6)', () => {
  it('a genuine denied user action toasts the named action, never the bare server body', async () => {
    apiMock.delete.mockRejectedValue(new ApiError(403, { error: 'Không có quyền truy cập' }, 'Không có quyền truy cập'));
    await deleteRow();

    await waitFor(() => {
      expect(toastMessages()).toContain('Bạn không có quyền xóa đối tác sở hữu.');
    });
    expect(toastMessages()).not.toContain('Không có quyền truy cập');
  });

  it('an aborted/raced mutation never toasts at all', async () => {
    // Abort/race teardown is not a user-visible failure — the mapping must
    // return null and the catch must swallow the toast entirely.
    apiMock.delete.mockRejectedValue(Object.assign(new Error('The user aborted a request.'), { name: 'AbortError' }));
    await deleteRow();

    await waitFor(() => {
      expect(apiMock.delete).toHaveBeenCalled();
    });
    expect(toastSpy).not.toHaveBeenCalled();
  });

  it('a non-403 carrying the permission body is refused — the fallback stands', async () => {
    apiMock.delete.mockRejectedValue(new ApiError(500, { error: 'Không có quyền truy cập' }, 'Không có quyền truy cập'));
    await deleteRow();

    await waitFor(() => {
      expect(toastMessages()).toContain('Lỗi xóa');
    });
    expect(toastMessages()).not.toContain('Không có quyền truy cập');
  });

  it('a business refusal carried at 403 stays verbatim (not a permission denial)', async () => {
    apiMock.delete.mockRejectedValue(new ApiError(403, { error: 'Đối tác đã vượt hạn mức' }, 'Đối tác đã vượt hạn mức'));
    await deleteRow();

    await waitFor(() => {
      expect(toastMessages()).toContain('Đối tác đã vượt hạn mức');
    });
  });
});
