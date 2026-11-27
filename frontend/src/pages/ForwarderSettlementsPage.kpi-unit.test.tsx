import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { apiGet, animateCounters } = vi.hoisted(() => {
  // The counter hook writes the animated value into the element's textContent.
  // This mock replays that end state (prefix + rounded number + suffix), so
  // the DOM shows exactly what the running animation leaves behind — including
  // a unit the page injected through `suffix`.
  const animateCounters = vi.fn((targets: Array<{
    el: HTMLElement | null;
    value: number;
    prefix?: string;
    suffix?: string;
    locale?: string;
    format?: (v: number) => string;
  }>) => {
    for (const target of targets) {
      if (!target.el) continue;
      target.el.textContent = target.format
        ? target.format(target.value)
        : `${target.prefix ?? ''}${Math.round(target.value).toLocaleString(target.locale ?? 'vi-VN')}${target.suffix ?? ''}`;
    }
  });
  return { apiGet: vi.fn(), animateCounters };
});

vi.mock('../lib/api', async (importOriginal) => ({
  ...await importOriginal<typeof import('../lib/api')>(),
  api: { get: apiGet, post: vi.fn() },
}));

vi.mock('../hooks/animations', () => ({
  usePageAnimations: () => ({ rootRef: { current: null } }),
  useListAnimations: () => ({ rootRef: { current: null } }),
  useCounterAnimation: () => ({ animateCounters }),
}));

import ForwarderSettlementsPage from './ForwarderSettlementsPage';

const SETTLEMENTS_URL = '/forwarder/me/advance-settlements';

const ENVELOPE = {
  items: [
    {
      id: 1,
      code: 'TT-0001',
      forwarderId: 9,
      totalExpenseAmount: '12345678',
      refundAmount: '0',
      status: 'RECORDED',
      checkedBy: null,
      checkedAt: null,
      approvedBy: null,
      approvedAt: null,
      note: null,
      createdAt: '2026-11-20T02:00:00.000Z',
    },
  ],
  page: 1,
  limit: 25,
  pageSize: 25,
  total: 8,
  totalPages: 1,
  statusCounts: { DRAFT: 3, RECORDED: 5 },
  totals: { totalExpenseAmount: 12345678, pendingCount: 3 },
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

/** The KPI cards of the hero row: one wide amount card + the two mini cards. */
function heroCards(container: HTMLElement) {
  return {
    amount: container.querySelector<HTMLElement>('.hero-kpi-card'),
    minis: Array.from(container.querySelectorAll<HTMLElement>('.hero-kpi-mini')),
  };
}

function miniCardParts(card: HTMLElement) {
  return {
    value: card.querySelector<HTMLElement>('.hero-kpi-mini__value')?.textContent ?? '',
    label: card.querySelector<HTMLElement>('.hero-kpi-mini__label')?.textContent ?? '',
    text: card.textContent ?? '',
  };
}

describe('/my-settlements KPI cards write their unit exactly once (SIL-1201)', () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiGet.mockImplementation((url: string) => {
      if (url.startsWith(SETTLEMENTS_URL)) return Promise.resolve(ENVELOPE);
      if (url.startsWith('/catalogs/bootstrap')) return Promise.resolve({ forwarderExpenseTypes: [] });
      return Promise.resolve({ items: [] });
    });
  });

  it('keeps the unit in the label line only — the animated number carries no unit text', async () => {
    const { container } = renderPage();

    await waitFor(() => expect(container.querySelector('.hero-kpi-row')).not.toBeNull());
    await waitFor(() => expect(animateCounters).toHaveBeenCalled());

    const { minis } = heroCards(container);
    expect(minis).toHaveLength(2);

    const parts = minis.map(miniCardParts);
    // "8" + "phiếu" and "3" + "chờ xử lý": the unit is written ONCE per card.
    expect(parts.map((p) => [p.value, p.label])).toEqual([
      ['8', 'phiếu'],
      ['3', 'chờ xử lý'],
    ]);
    for (const part of parts) {
      expect(part.value).not.toContain(part.label);
      expect(part.text.split(part.label)).toHaveLength(2); // exactly one occurrence
      expect(part.value).toMatch(/^\d[\d.\s]*$/); // digits only — no unit text
    }
  });

  it('writes the currency once on the amount card — the digits stay unit-free', async () => {
    const { container } = renderPage();

    await waitFor(() => expect(container.querySelector('.hero-kpi-row')).not.toBeNull());
    await waitFor(() => expect(animateCounters).toHaveBeenCalled());

    const { amount } = heroCards(container);
    const amountEl = amount!.querySelector<HTMLElement>('.hero-kpi-card__amount')!;
    const digits = amount!.querySelector<HTMLElement>('.hero-kpi-card__amount > span:first-child')!;

    // The ₫ rides the amount line beside the digits — exactly one copy.
    expect(amountEl.textContent?.split('₫')).toHaveLength(2);
    expect(digits.textContent).toBe('12.345.678');
    expect(digits.textContent).not.toContain('₫');
  });
});
