// Card 20260923_14 — deposit-tracker overdue-CV alert surface: verbatim red
// line, per-session dismissal. SIL-877 (CR-009.1 3.3): the banner at the top
// of the table is the ONE alert surface — the once-per-load toast is gone, so
// every test here also pins toastMock staying silent. The unrefunded-total
// line runs continuously (work order c12 _14 line 2) and is NOT dismissible.
import { fireEvent, render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const toastMock = vi.fn();
vi.mock('../../components/shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../components/shared')>()),
  useToast: () => ({ toast: toastMock, dismiss: vi.fn() }),
}));

vi.mock('../../api/depositRefundClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/depositRefundClient')>()),
  listDepositTrackers: vi.fn(),
}));

import DepositRefundTrackerPage from './DepositRefundTrackerPage';
import { listDepositTrackers, type DepositTrackerListResponse } from '../../api/depositRefundClient';

const DISMISS_KEY = 'deposit-cv-overdue-alert-dismissed';

function makeResponse(overrides: Partial<DepositTrackerListResponse> = {}): DepositTrackerListResponse {
  return {
    items: [], total: 0,
    warnings: { cvOverdueCount: 0, unrefundedTotal: 0 },
    ...overrides,
  };
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <DepositRefundTrackerPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(listDepositTrackers).mockReset();
  toastMock.mockClear();
  sessionStorage.clear();
});

describe('deposit-tracker overdue alerts (card 20260923_14)', () => {
  it('renders the verbatim red line zero-padded and never fires a toast', async () => {
    vi.mocked(listDepositTrackers).mockResolvedValue(makeResponse({
      warnings: { cvOverdueCount: 1, unrefundedTotal: 4_000_000 },
    }));
    renderPage();
    await waitFor(() => expect(document.querySelector('.deposit-tracker-warnings__item--danger')).toBeTruthy());
    expect(document.querySelector('.deposit-tracker-warnings__item--danger')!.textContent)
      .toBe('Cảnh báo quá hạn nộp công văn hoàn cược: 01 lô hàng');
    // SIL-877 3.3: the banner is the only surface — no duplicate toast.
    expect(toastMock).not.toHaveBeenCalled();
  });

  it('no alert line at count 0; the money line still runs', async () => {
    vi.mocked(listDepositTrackers).mockResolvedValue(makeResponse({
      warnings: { cvOverdueCount: 0, unrefundedTotal: 7_000_000 },
    }));
    renderPage();
    await waitFor(() => expect(document.querySelector('.deposit-tracker-warnings')).toBeTruthy());
    expect(document.querySelector('.deposit-tracker-warnings__item--danger')).toBeNull();
    expect(document.querySelector('.deposit-tracker-warnings__dismiss')).toBeNull();
    expect(document.querySelector('.deposit-tracker-warnings')!.textContent).toContain('Chưa hoàn cược số tiền');
  });

  it('dismiss hides only the alert line and persists per session', async () => {
    vi.mocked(listDepositTrackers).mockResolvedValue(makeResponse({
      warnings: { cvOverdueCount: 2, unrefundedTotal: 4_000_000 },
    }));
    renderPage();
    await waitFor(() => expect(document.querySelector('.deposit-tracker-warnings__dismiss')).toBeTruthy());
    fireEvent.click(document.querySelector('.deposit-tracker-warnings__dismiss')!);
    expect(document.querySelector('.deposit-tracker-warnings__item--danger')).toBeNull();
    expect(document.querySelector('.deposit-tracker-warnings__dismiss')).toBeNull();
    expect(document.querySelector('.deposit-tracker-warnings')!.textContent).toContain('Chưa hoàn cược số tiền');
    expect(sessionStorage.getItem(DISMISS_KEY)).toBe('1');
    expect(toastMock).not.toHaveBeenCalled();
  });

  it('remount in the same session stays dismissed', async () => {
    // Simulates the dismissal having happened earlier in this browser session.
    sessionStorage.setItem(DISMISS_KEY, '1');
    vi.mocked(listDepositTrackers).mockResolvedValue(makeResponse({
      warnings: { cvOverdueCount: 2, unrefundedTotal: 4_000_000 },
    }));
    renderPage();
    await waitFor(() => expect(document.querySelector('.deposit-tracker-warnings')).toBeTruthy());
    expect(document.querySelector('.deposit-tracker-warnings__item--danger')).toBeNull();
    expect(toastMock).not.toHaveBeenCalled();
  });
});
