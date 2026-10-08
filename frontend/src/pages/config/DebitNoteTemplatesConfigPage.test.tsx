/**
 * Card 20261004_333 — `/config/debit-note-templates` fetch-error regression.
 *
 * Before the fix the list coalesced `data ?? []` and branched on `isLoading`
 * only, so a failed fetch fell through to "0 mẫu Excel" + "Chưa có mẫu nào" —
 * indistinguishable from a genuinely empty catalog. The error state names the
 * failure and offers "Thử lại" → refetch.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ConfigClientModule from '../../api/configClient';

const { getDebitNoteTemplatesMock } = vi.hoisted(() => ({
  getDebitNoteTemplatesMock: vi.fn(),
}));

vi.mock('../../api/configClient', async (importOriginal) => {
  const actual = await importOriginal<typeof ConfigClientModule>();
  return {
    ...actual,
    configClient: { ...actual.configClient, getDebitNoteTemplates: getDebitNoteTemplatesMock },
  };
});

vi.mock('../../hooks/animations', () => ({
  usePageAnimations: () => ({ rootRef: { current: null } }),
}));

vi.mock('../../hooks/useBackShortcut', () => ({ useBackShortcut: vi.fn() }));

import DebitNoteTemplatesConfigPage from './DebitNoteTemplatesConfigPage';
import { ToastProvider } from '../../components/shared/Toast';

const template = {
  id: 1,
  name: 'Mẫu A',
  titleText: 'GIẤY BÁO NỢ',
  isDefault: false,
  accentColor: '#123456',
  columns: [{ width: 10 }],
  groupingMode: 'flat',
  orientation: 'portrait',
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter>
          <DebitNoteTemplatesConfigPage />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  getDebitNoteTemplatesMock.mockReset().mockResolvedValue([template]);
});

describe('DebitNoteTemplatesConfigPage fetch-error states (card 20261004_333)', () => {
  it('shows the fetch-error state with retry instead of the empty catalog when the list query fails', async () => {
    getDebitNoteTemplatesMock.mockRejectedValueOnce(new Error('500'));
    renderPage();

    expect(await screen.findByText('Không thể tải danh sách mẫu giấy báo nợ', undefined, { timeout: 3000 })).toBeVisible();
    // Never the true-empty copy while the query errors.
    expect(screen.queryByText(/Chưa có mẫu nào/)).not.toBeInTheDocument();

    getDebitNoteTemplatesMock.mockResolvedValue([template]);
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    expect(await screen.findByText('Mẫu A')).toBeVisible();
    expect(getDebitNoteTemplatesMock.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('keeps the true-empty state only when the query succeeded with zero items', async () => {
    getDebitNoteTemplatesMock.mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText(/Chưa có mẫu nào/)).toBeVisible();
    expect(screen.queryByText('Không thể tải danh sách mẫu giấy báo nợ')).not.toBeInTheDocument();
  });
});
