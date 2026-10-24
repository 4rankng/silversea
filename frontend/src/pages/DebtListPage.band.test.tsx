/**
 * SIL-469 — the /debt summary band: total + risk chips + proportional aging
 * bar + four bucket filters in ONE 88–96px band. The spec's QA clause asks
 * the band figures to reconcile with the aging totals; the row contract pins
 * the merged Tổng-nợ status suffix and the bucket-coloured overdue badge.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getCustomerAging = vi.fn();
const getBlob = vi.fn();
const getPhoiPhieuReport = vi.hoisted(() => vi.fn());

vi.mock('../api/financialClient', () => ({
  financialClient: { getCustomerAging: (...args: unknown[]) => getCustomerAging(...args) },
}));

vi.mock('../api/phoiPhieuClient', () => ({
  getPhoiPhieuReport: (...args: unknown[]) => getPhoiPhieuReport(...args),
}));

vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({ user: { userId: 7, role: 'ACCOUNTANT' } }),
}));

vi.mock('../lib/api', () => ({
  api: { getBlob: (...args: unknown[]) => getBlob(...args) },
}));

vi.mock('../components/shared/Toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock('../hooks/animations', () => ({
  usePageAnimations: () => ({ rootRef: { current: null } }),
  useListAnimations: () => ({ rootRef: { current: null } }),
  useCounterAnimation: () => ({ animateCounters: vi.fn() }),
}));

vi.mock('../hooks/usePrefersReducedMotion', () => ({
  usePrefersReducedMotion: () => true,
}));

import DebtListPage from './DebtListPage';

// Shape mirrors the server envelope (totals are full-set, server-computed).
const customer = (id: number, name: string, totalOutstanding: number, overrides: Record<string, unknown> = {}) => ({
  customerId: id,
  customerName: name,
  contactInfo: null,
  linkedSupplierId: null,
  linkedSupplierApBalance: 0,
  netBalance: totalOutstanding,
  totalOutstanding,
  aging: { current: totalOutstanding, d30: 0, d60: 0, over90: 0 },
  maxOverdueDays: 0,
  ...overrides,
});

// The spec's own review figures — the band must print them unchanged
// (no API/number change is in scope).
const totals = {
  total: 4_408_097_935,
  current: 3_007_273_111,
  d30: 981_572_224,
  d60: 396_388_600,
  over90: 22_864_000,
  currentCusts: 17,
  d30Custs: 9,
  d60Custs: 9,
  over90Custs: 4,
  overdueCount: 17,
  highRiskCount: 12,
};

const envelope = {
  customers: [customer(1, 'Công ty A', 12_000_000), customer(2, 'Công ty B', 8_000_000)],
  page: 1,
  limit: 25,
  total: 2,
  totalPages: 1,
  totals,
};

function renderPage(entry = '/') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[entry]}>
        <DebtListPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  getCustomerAging.mockReset().mockResolvedValue(envelope);
  getBlob.mockReset();
  getPhoiPhieuReport.mockReset().mockResolvedValue({ rows: [], grand: null });
});

describe('DebtListPage summary band (SIL-469)', () => {
  it('renders one band with the full total, the two risk chips and the four bucket figures', async () => {
    renderPage();
    await screen.findAllByText('Công ty A');

    const band = screen.getByRole('region', { name: 'Tổng quan công nợ phải thu' });
    // The total prints the server figure in full (hero money parts, no compact
    // short form — the page pins `compact = false`).
    expect(within(band).getByText('Tổng công nợ phải thu')).toBeTruthy();
    expect(within(band).getByText('4.408.097.935')).toBeTruthy();
    // Quiet chips carry the two risk counts.
    expect(within(band).getByText('17 quá hạn')).toBeTruthy();
    expect(within(band).getByText('12 rủi ro cao')).toBeTruthy();
    // The four bucket figures reconcile with the aging totals.
    expect(within(band).getByText('3.007.273.111')).toBeTruthy();
    expect(within(band).getByText('981.572.224')).toBeTruthy();
    expect(within(band).getByText('396.388.600')).toBeTruthy();
    expect(within(band).getByText('22.864.000')).toBeTruthy();
    // d30 and d60 both carry 9 customers — two buckets share the count.
    expect(within(band).getAllByText('· 9 KH')).toHaveLength(2);
    expect(within(band).getByText('· 4 KH')).toBeTruthy();
    // The former rail/disclosure surfaces are gone from the page.
    expect(document.querySelector('.summary-rail')).toBeNull();
    expect(document.querySelector('.debt-aging-grid')).toBeNull();
    expect(document.querySelector('.financial-aging-disclosure')).toBeNull();
  });

  it('sizes the aging bar segments proportionally to the bucket money', async () => {
    renderPage();
    await screen.findAllByText('Công ty A');

    const bar = document.querySelector('.debt-band__bar') as HTMLElement;
    expect(bar).not.toBeNull();
    const segs = [...bar.querySelectorAll<HTMLElement>('.aging-bar__seg')];
    expect(segs).toHaveLength(4);
    const agingTotal = totals.current + totals.d30 + totals.d60 + totals.over90;
    const expected = [totals.current, totals.d30, totals.d60, totals.over90]
      .map((v) => (v / agingTotal) * 100);
    segs.forEach((seg, i) => {
      const width = parseFloat(seg.style.width);
      expect(Math.abs(width - expected[i])).toBeLessThan(0.01);
    });
    // Bucket order shares the bar's color ladder (ok → t1 → t2 → t4).
    expect(segs.map((s) => s.className)).toEqual([
      'aging-bar__seg aging-bar__seg--ok',
      'aging-bar__seg aging-bar__seg--t1',
      'aging-bar__seg aging-bar__seg--t2',
      'aging-bar__seg aging-bar__seg--t4',
    ]);
  });

  it('keeps the bucket figures as working filters (click → bucket param, active state)', async () => {
    renderPage();
    await screen.findAllByText('Công ty A');

    const band = screen.getByRole('region', { name: 'Tổng quan công nợ phải thu' });
    fireEvent.click(within(band).getByRole('button', { name: /Quá hạn 1–30: / }));

    await waitFor(() => expect(getCustomerAging.mock.calls.some((c) => (c[0] as { bucket?: string }).bucket === 'd30')).toBe(true));

    // Re-render with the filter applied → the matching bucket is pressed.
    getCustomerAging.mockClear().mockResolvedValue(envelope);
    renderPage('/?filter=d30');
    await screen.findAllByText('Công ty A');
    const pressed = document.querySelector('.debt-band__bucket.is-active[aria-pressed="true"]') as HTMLElement;
    expect(pressed?.getAttribute('aria-label')).toContain('Quá hạn 1–30');
  });

  it('colors the row overdue badge by bucket and folds the status into the total cell', async () => {
    getCustomerAging.mockResolvedValue({
      ...envelope,
      customers: [
        customer(11, 'Nhẹ 5 ngày', 1_000_000, { maxOverdueDays: 5 }),
        customer(12, 'Vàng 45 ngày', 1_000_000, { maxOverdueDays: 45 }),
        customer(13, 'Cam 75 ngày', 1_000_000, { maxOverdueDays: 75 }),
        customer(14, 'Đỏ 120 ngày', 1_000_000, { maxOverdueDays: 120 }),
        customer(15, 'Không quá hạn', 1_000_000, { maxOverdueDays: 0 }),
      ],
      total: 5,
    });
    renderPage();
    await screen.findAllByText('Nhẹ 5 ngày');

    const badgeBand = (name: string) => {
      const cell = [...document.querySelectorAll('td[data-label="Khách hàng"]')]
        .find((td) => td.textContent?.includes(name));
      const row = cell?.closest('tr')!;
      return {
        badge: row.querySelector('.debt-overdue-badge')?.className,
        text: row.querySelector('td[data-label="Quá hạn"]')?.textContent,
        total: row.querySelector('td[data-label="Tổng nợ"]')?.textContent,
      };
    };

    expect(badgeBand('Nhẹ 5 ngày').badge).toContain('debt-overdue-badge--ok');
    expect(badgeBand('Vàng 45 ngày').badge).toContain('debt-overdue-badge--warn');
    expect(badgeBand('Cam 75 ngày').badge).toContain('debt-overdue-badge--deep');
    expect(badgeBand('Đỏ 120 ngày').badge).toContain('debt-overdue-badge--danger');
    // Every overdue row keeps the digit-space-unit badge text.
    expect(badgeBand('Đỏ 120 ngày').text).toContain('120 ngày');
    // The former name sub-line is gone; the status rides the total cell.
    expect(badgeBand('Đỏ 120 ngày').total).toContain('· Nợ quá hạn');
    expect(badgeBand('Không quá hạn').badge).toBeUndefined();
    expect(badgeBand('Không quá hạn').text).not.toContain('ngày');
    expect(badgeBand('Không quá hạn').total).toContain('· Trong hạn');
  });
});
