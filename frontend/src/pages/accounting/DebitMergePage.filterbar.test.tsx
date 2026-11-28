/**
 * UX-01 (staging UI audit 2026-11-27) — the Ghép bộ Debit filter toolbar:
 * the 'Bộ lọc' disclosure (≤1023px band) with its live active-filter count,
 * and the query-retention law (toggling the panel never resets a half-typed
 * filter). The panel is ONE DOM for both layouts, so jsdom exercises the
 * exact nodes the phone renders. Plus the UX-02 selection-parity law: the
 * mobile card list and the desktop grid mutate the same selection Set.
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DebitMergeItem } from '@tingting/shared';

const { listMergeBoard, getBootstrap } = vi.hoisted(() => ({
  listMergeBoard: vi.fn(),
  getBootstrap: vi.fn(),
}));

vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({ user: { userId: 9, role: 'ACCOUNTANT' } }),
}));

vi.mock('../../api/accountingDebitClient', () => ({
  listSettlementRounds: vi.fn().mockResolvedValue({ items: [] }),
  createSettlementRound: vi.fn(),
  getDebitNoteRoundPreview: vi.fn(),
  DEBIT_SETTLEMENT_ROUNDS_KEY: ['accounting-debit-settlement-rounds'],
}));
vi.mock('../../api/shipmentDebit', () => ({
  listDebitMergeBoard: listMergeBoard,
  debitMergeKeys: {
    all: ['accounting-debit-merge'] as const,
    board: (team: boolean) => ['accounting-debit-merge', 'board', team] as const,
  },
  createDebitNoteBatch: vi.fn(),
  exportDebitNoteFile: vi.fn(),
  lockShipmentCost: vi.fn(),
  unlockShipmentCost: vi.fn(),
  listPendingShipmentCostAdjustRequests: vi.fn().mockResolvedValue([]),
}));
vi.mock('../../api/tripClient', () => ({
  tripClient: { getBootstrap },
}));

import DebitMergePage from './DebitMergePage';
import { ToastProvider } from '../../components/shared/Toast';

const row = (over: Partial<DebitMergeItem> & Pick<DebitMergeItem, 'shipmentId'>): DebitMergeItem => ({
  code: null,
  customerId: 11,
  customerName: 'Long Minh',
  factoryName: null,
  routeName: null,
  deliveryDate: null,
  billOrBookNumber: null,
  creatorName: null,
  creatorCode: null,
  containers: [],
  revenue: { cuoc: null, lachHuyen: null, phuPhi: null, phatSinh: null, tong: null },
  chiHo: { csht: [], lift: [], drop: [], other: [] },
  noInvoice: { gnFee: null, gnPaid: null, psFee: null, psPaid: null, fees: [] },
  control: { tongTc: null, lockStatus: 'OPEN', lockedAt: null },
  ...over,
});

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/accounting/ghep-bo-debit']}>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ToastProvider>
          <DebitMergePage />
        </ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

const bodyBills = () => [...document.querySelectorAll('tbody td[data-col="lot"]')].map((cell) => cell.textContent);

/** Simulate the phone band for the mobile-card test: the shared hook reads
 *  window.matchMedia, whose jsdom fallback always says false. Only the
 *  (max-width: 767px) query flips — the grid's own compact/phone band
 *  queries stay untouched. */
function stubPhoneBand(enabled: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: enabled && query === '(max-width: 767px)',
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => true,
  })) as unknown as typeof window.matchMedia;
}

const originalMatchMedia = window.matchMedia;

beforeEach(() => {
  window.matchMedia = originalMatchMedia;
  localStorage.clear();
  vi.clearAllMocks();
  getBootstrap.mockResolvedValue({ customers: [], trucks: [] });
  listMergeBoard.mockResolvedValue({
    items: [
      row({ shipmentId: 1, billOrBookNumber: 'BL-SEP-OLD', deliveryDate: '2026-09-01', routeName: 'HN-HP' }),
      row({ shipmentId: 2, billOrBookNumber: 'JJCTCHPDY260305', deliveryDate: '2026-11-02', routeName: 'HCM-QN', containers: [{ id: 1, containerNumber: 'TWCU8170772', containerType: null }] }),
      row({ shipmentId: 3, billOrBookNumber: 'BL-NOV-LATEST', deliveryDate: '2026-11-18', routeName: 'HCM-DL' }),
    ],
    total: 3,
  });
});

describe('DebitMergePage — UX-01 Bộ lọc disclosure', () => {
  it('the disclosure toggles aria-expanded and the panel open state', async () => {
    renderPage();
    await screen.findByText('BL-NOV-LATEST');
    const toggle = screen.getByTestId('debit-merge-filterbar-toggle');
    const panel = screen.getByTestId('debit-merge-filter-panel');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(panel.className).not.toContain('debit-merge-filterbar__panel--open');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(panel.className).toContain('debit-merge-filterbar__panel--open');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(panel.className).not.toContain('debit-merge-filterbar__panel--open');
  });

  it('the badge counts each applied secondary filter (route + date range), live', async () => {
    renderPage();
    await screen.findByText('BL-NOV-LATEST');
    const toggle = screen.getByTestId('debit-merge-filterbar-toggle');
    expect(within(toggle).queryByText('1')).toBeNull();
    fireEvent.change(screen.getByLabelText('Tuyến đường'), { target: { value: 'HCM' } });
    expect(within(toggle).getByText('1')).toBeTruthy();
    // The date range counts as ONE more point once either end is set.
    fireEvent.change(screen.getByLabelText('Từ ngày'), { target: { value: '01/11/2026' } });
    expect(within(toggle).getByText('2')).toBeTruthy();
    // Clearing the route drops the count live; the date point stays until
    // the field itself is cleared (the buffered field owns that gesture).
    fireEvent.change(screen.getByLabelText('Tuyến đường'), { target: { value: '' } });
    expect(within(toggle).getByText('1')).toBeTruthy();
    expect(within(toggle).queryByText('2')).toBeNull();
  });

  it('query retained across open/close: a hidden panel keeps its date filter working', async () => {
    renderPage();
    await screen.findByText('BL-NOV-LATEST');
    const toggle = screen.getByTestId('debit-merge-filterbar-toggle');
    fireEvent.change(screen.getByLabelText('Từ ngày'), { target: { value: '01/11/2026' } });
    expect(bodyBills()).toEqual(['BL-NOV-LATEST', 'JJCTCHPDY260305']);
    // Close (the panel hides at narrow widths) and reopen: same query —
    // the rows stay filtered and the badge still counts the date point.
    fireEvent.click(toggle);
    fireEvent.click(toggle);
    expect(bodyBills()).toEqual(['BL-NOV-LATEST', 'JJCTCHPDY260305']);
    expect(within(toggle).getByText('1')).toBeTruthy();
  });

  it('UX-02 selection parity: in the phone band the card list mounts and mutates the SAME selection Set as the grid', async () => {
    stubPhoneBand(true);
    renderPage();
    await screen.findByTestId('debit-merge-mobile-list');
    expect(screen.getByTestId('debit-merge-mobile-list')).toBeTruthy();
    const pane = document.querySelector('.debit-merge__pane') as HTMLElement;
    const gridPick = within(pane).getByLabelText('Chọn lô JJCTCHPDY260305') as HTMLInputElement;
    fireEvent.click(gridPick);
    expect(gridPick.checked).toBe(true);
    const list = screen.getByTestId('debit-merge-mobile-list');
    const cardPick = within(list).getByLabelText('Chọn lô JJCTCHPDY260305') as HTMLInputElement;
    expect(cardPick.checked).toBe(true);
    // And back: unchecking on the CARD clears the grid's checkbox too.
    fireEvent.click(cardPick);
    expect((within(pane).getByLabelText('Chọn lô JJCTCHPDY260305') as HTMLInputElement).checked).toBe(false);
  });

  it('outside the phone band the card list never mounts (desktop tree stays single-faced)', async () => {
    renderPage();
    await screen.findByText('JJCTCHPDY260305');
    expect(screen.queryByTestId('debit-merge-mobile-list')).toBeNull();
  });
});
