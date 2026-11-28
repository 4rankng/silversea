/**
 * SIL-1221 — /my-settlements at 360/390px: the settlement card's per-lot
 * money broke onto two lines — "350.000" on the first, the "₫" alone on the
 * second (measured in the browser: line 1 = 48px, line 2 = 8px, the "₫"
 * only).
 *
 * The defect is a LAYOUT contract, so it is pinned in two halves: the amount
 * renders as ONE text node inside the nowrap element (the component half),
 * and the stylesheet keeps that element on one line at every width (the CSS
 * half — jsdom has no layout, so the stylesheet is the only place the wrap
 * can be ruled out).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ApiModule from '../lib/api';

const { apiGet, animateCounters } = vi.hoisted(() => ({
  apiGet: vi.fn(),
  animateCounters: vi.fn(),
}));

vi.mock('../lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiModule>()),
  api: { get: apiGet, post: vi.fn() },
}));

vi.mock('../hooks/animations', () => ({
  usePageAnimations: () => ({ rootRef: { current: null } }),
  useListAnimations: () => ({ rootRef: { current: null } }),
  useCounterAnimation: () => ({ animateCounters }),
}));

import ForwarderSettlementsPage from './ForwarderSettlementsPage';

const SETTLEMENTS_URL = '/forwarder/me/advance-settlements';

/** One settlement with one linked expense — the per-lot block the card
 *  renders (identity title + the lot's money). */
const ENVELOPE = {
  items: [
    {
      id: 1,
      code: 'OS-2611-0010',
      forwarderId: 9,
      totalExpenseAmount: '350000',
      refundAmount: '0',
      status: 'RECORDED',
      checkedBy: null,
      checkedAt: null,
      approvedBy: null,
      approvedAt: null,
      note: null,
      createdAt: '2026-11-20T02:00:00.000Z',
      linkedExpenses: [
        {
          id: 11,
          tripId: 21,
          expenseType: 'LIFTING',
          buyAmount: '350000',
          containerNumber: 'MSKU1234570',
          invoiceNumber: null,
          note: null,
          tripCode: null,
          departureDate: '2026-11-21',
          customerName: 'Long Minh',
          shipmentId: 21,
          billRef: 'QATEST-CUOC-001',
          tradeDirection: 'IMPORT',
        },
      ],
    },
  ],
  page: 1,
  limit: 25,
  pageSize: 25,
  total: 1,
  totalPages: 1,
  statusCounts: { RECORDED: 1 },
  totals: { totalExpenseAmount: 350000, pendingCount: 0 },
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ForwarderSettlementsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('/my-settlements — the card amount never breaks (SIL-1221)', () => {
  beforeEach(() => {
    apiGet.mockReset();
    animateCounters.mockReset();
    apiGet.mockImplementation((url: string) => {
      if (url.startsWith(SETTLEMENTS_URL)) return Promise.resolve(ENVELOPE);
      if (url.startsWith('/catalogs/bootstrap')) return Promise.resolve({ forwarderExpenseTypes: [] });
      return Promise.resolve({ items: [] });
    });
  });

  it('prints the lot money as ONE text node inside the nowrap element', async () => {
    const { container } = renderPage();

    const total = await waitFor(() => {
      const element = container.querySelector('.fset-card__group-total');
      expect(element).toBeTruthy();
      return element!;
    });

    expect(total.textContent).toBe('350.000 ₫');
    // ONE text node — the "₫" can never become a second line of its own.
    expect(total.childNodes.length).toBe(1);
    expect(total.childNodes[0]!.nodeType).toBe(Node.TEXT_NODE);
    // The identity title rides the other side of the same line.
    expect(container.querySelector('.fset-card__group-title')?.textContent).toContain('Long Minh');
  });
});

describe('/my-settlements — the card amount CSS keeps it on one line (SIL-1221)', () => {
  const css = readFileSync(resolve(process.cwd(), 'src/pages/ForwarderSettlementsPage.css'), 'utf8');

  function ruleBody(selector: string): string {
    const pattern = new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`);
    const match = css.match(pattern);
    expect(match, `expected a rule for ${selector}`).toBeTruthy();
    return match![1];
  }

  it('keeps the amount on one line and never lets it shrink', () => {
    const total = ruleBody('.fset-card__group-total');
    expect(total).toMatch(/white-space:\s*nowrap/);
    expect(total).toMatch(/flex:\s*none/);
  });

  it('gives the identity title the slack instead of the money', () => {
    const group = ruleBody('.fset-card__group');
    expect(group).toMatch(/display:\s*flex/);
    expect(group).toMatch(/min-width:\s*0/);
    const title = ruleBody('.fset-card__group-title');
    expect(title).toMatch(/min-width:\s*0/);
    // A long bill code breaks instead of running under the money.
    expect(title).toMatch(/overflow-wrap:\s*break-word/);
  });
});
