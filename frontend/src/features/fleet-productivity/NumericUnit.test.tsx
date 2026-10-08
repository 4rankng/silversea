// Card 071026141600 — LEAD RULING (user 2026-10-08): the reported class
// (a percent cell breaking between value and sign — "66.\n67%", "100\n%")
// must be IMPOSSIBLE BY CONSTRUCTION. The construction: every percent or
// count token renders as ONE text node inside ONE nowrap unit
// (NumericUnit.tsx + `.fleet-num-unit`), the '%' sign bound to its digits in
// the same node, and every column header carries its full label as `title`.
//
// The lane's browser rung measured 1 line at 12 widths (not reproducible at
// HEAD) but is shape-blind — its bite-check proved the old `.fleet-pct`
// guard inert. These pins target the DOM shape that rung's own rect dump
// exposed ("66.67" and "%" as two rects / two text nodes): they FAIL on the
// old JSX `{value}%` shape and pass only on the bound-unit construction.
//
// Query note: every query is scoped to the render's own container because a
// single `it` may mount both views, and prose pins read `textContent` —
// RTL's getByText only sees DIRECT text-node children, which is exactly the
// node-boundary shape this contract governs.
import { render, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DailyProductivityView } from './DailyProductivityView';
import { MonthlyProductivityView } from './MonthlyProductivityView';

const { getMonthly, getDaily, getMonthlyExportBlob } = vi.hoisted(() => ({
  getMonthly: vi.fn(),
  getDaily: vi.fn(),
  getMonthlyExportBlob: vi.fn(),
}));
vi.mock('../../api/fleetProductivityClient', () => ({
  fleetProductivityClient: { getMonthly, getDaily, getMonthlyExportBlob },
}));
vi.mock('../../components/shared/Toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));

// Decimals + integers + zero so the pin covers "66.67%", "100%" and "0%".
const monthly = {
  year: 2026,
  month: 10,
  activeInternalTrucks: 3,
  totalInternalTrucks: 5,
  trucks: [{
    truckId: 9,
    licensePlate: '15C-123.45',
    driverName: 'Nguyễn Văn An',
    breakdown: {
      totalTrips: 12,
      kepTrips: 8,
      pctKep: 66.67,
      ketHopTrips: 2,
      pctKetHop: 16.67,
      layLeTrips: 1,
      pctLayLe: 8.33,
      donTrips: 1,
      pctDon: 8.33,
      highEfficiencyPct: 100,
    },
  }],
  fleetBreakdown: {
    totalTrips: 25,
    kepTrips: 0,
    pctKep: 0,
    ketHopTrips: 25,
    pctKetHop: 100,
    layLeTrips: 0,
    pctLayLe: 0,
    donTrips: 0,
    pctDon: 0,
    highEfficiencyPct: 100,
  },
};

const daily = {
  date: '2026-10-08',
  activeInternalTrucks: 3,
  totalInternalTrucks: 5,
  trucks: [{
    truckId: 9,
    licensePlate: '15C-123.45',
    driverName: null,
    breakdown: {
      totalTrips: 12,
      kepTrips: 8,
      pctKep: 66.67,
      ketHopTrips: 2,
      pctKetHop: 16.67,
      layLeTrips: 1,
      pctLayLe: 8.33,
      donTrips: 1,
      pctDon: 8.33,
      highEfficiencyPct: 100,
    },
    tripCodes: ['T-001', 'T-002'],
  }],
  fleetBreakdown: {
    totalTrips: 25,
    kepTrips: 0,
    pctKep: 0,
    ketHopTrips: 25,
    pctKetHop: 100,
    layLeTrips: 0,
    pctLayLe: 0,
    donTrips: 0,
    pctDon: 0,
    highEfficiencyPct: 100,
  },
};

function renderMonthly() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MonthlyProductivityView />
    </QueryClientProvider>,
  );
}

function renderDaily() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <DailyProductivityView />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  getMonthly.mockResolvedValue(monthly);
  getDaily.mockResolvedValue(daily);
});

const PCT = /^\d+(\.\d+)?%$/;
const TOKEN = /^(?:\d+(?:\.\d+)?%|\d+)$/;

function descendantTextNodes(el: Element): Text[] {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const out: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.textContent?.trim()) out.push(node as Text);
  }
  return out;
}

describe('fleet-productivity numeric law — percent/count tokens are ONE nowrap unit (card 071026141600)', () => {
  it('every numeric unit holds exactly one text node — value (+ sign) bound in that same node', async () => {
    for (const renderView of [renderMonthly, renderDaily]) {
      const { container } = renderView();
      await within(container).findByText(/Tổng chuyến trong ngày|Tổng chuyến trong tháng/);

      const units = Array.from(container.querySelectorAll('.fleet-num-unit'));
      expect(units.length).toBeGreaterThan(0);
      for (const unit of units) {
        expect(unit.children, `unit ${JSON.stringify(unit.textContent)} must not nest elements`).toHaveLength(0);
        const texts = Array.from(unit.childNodes).filter(
          (n): n is Text => n.nodeType === Node.TEXT_NODE && !!n.textContent?.trim(),
        );
        expect(texts, `unit ${JSON.stringify(unit.textContent)} must be ONE text node`).toHaveLength(1);
        const text = texts[0].textContent!;
        expect(text, `unit ${JSON.stringify(text)} must be a percent or count token`).toMatch(TOKEN);
      }
    }
  });

  it('binds value and sign in one text node everywhere — no "%" can ever ride its own line-box (space/sign binding)', async () => {
    for (const renderView of [renderMonthly, renderDaily]) {
      const { container } = renderView();
      await within(container).findByText(/Tổng chuyến trong ngày|Tổng chuyến trong tháng/);

      // Value surfaces only — KPI labels ("% Kẹp ghép TB") and headers
      // ("% Kẹp") carry '%' as prose, never as a numeric token.
      const surfaces = container.querySelectorAll(
        '.fleet-productivity-table tbody, .fleet-productivity-table tfoot, .fleet-kpi-card__value',
      );
      const pctNodes = Array.from(surfaces).flatMap((surface) =>
        descendantTextNodes(surface).filter((n) => n.textContent!.includes('%')),
      );
      expect(pctNodes.length).toBeGreaterThan(0);
      for (const node of pctNodes) {
        // A standalone "%", "%)" or " %" node — or a node that keeps a space
        // between digits and sign — is exactly the class QA reported.
        expect(node.textContent).toMatch(PCT);
      }
    }
  });

  it('percent cells render ONE text node holding the whole "66.67%" token', async () => {
    const { container } = renderMonthly();
    const scope = within(container);
    await scope.findByText('Tổng chuyến trong tháng');

    const row = container.querySelector('.fleet-productivity-table tbody tr')!;
    const boldPct = row.querySelector('td.fleet-pct')!;
    const texts = descendantTextNodes(boldPct);
    expect(texts, 'the % Năng suất cao cell is one text node').toHaveLength(1);
    expect(texts[0].textContent).toBe('100%');

    for (const badge of row.querySelectorAll('.fleet-badge')) {
      const badgeTexts = descendantTextNodes(badge);
      expect(badgeTexts, 'a percent badge is one text node').toHaveLength(1);
      expect(badgeTexts[0].textContent).toMatch(PCT);
    }

    const foot = container.querySelector('tfoot')!;
    for (const cell of foot.querySelectorAll('td.fleet-pct')) {
      const cellTexts = descendantTextNodes(cell);
      expect(cellTexts, 'each footer percent cell is one text node').toHaveLength(1);
      expect(cellTexts[0].textContent).toMatch(PCT);
    }
  });

  it('daily count+percent badges keep "8 (66.67%)" — count bound, single space before "(", sign glued to value', async () => {
    const { container } = renderDaily();
    await within(container).findByText('Tổng chuyến trong ngày');

    const row = container.querySelector('.fleet-productivity-table tbody tr')!;
    const badge = row.querySelector('.fleet-badge')!;
    expect(badge.textContent).toBe('8 (66.67%)');
    expect(badge.textContent).toMatch(/^\d+ \(\d+(\.\d+)?%\)$/);
  });

  it('count cells render bare numbers through the same nowrap unit (same-screen sweep)', async () => {
    for (const renderView of [renderMonthly, renderDaily]) {
      const { container } = renderView();
      await within(container).findByText(/Tổng chuyến trong ngày|Tổng chuyến trong tháng/);

      const tables = container.querySelectorAll('.fleet-productivity-table');
      expect(tables.length).toBe(1);
      const cells = tables[0].querySelectorAll('tbody td, tfoot td');
      let bareCountCells = 0;
      for (const cell of cells) {
        const text = cell.textContent!.trim();
        if (!/^\d+$/.test(text)) continue;
        bareCountCells += 1;
        const units = cell.querySelectorAll('.fleet-num-unit');
        expect(units, `count cell ${text} must render through a nowrap unit`).toHaveLength(1);
        expect(units[0].textContent).toBe(text);
      }
      expect(bareCountCells).toBeGreaterThan(0);
    }
  });

  it('KPI metric values are nowrap units; mixed prose keeps its words and spaces exactly', async () => {
    {
      const { container } = renderMonthly();
      await within(container).findByText('Tổng chuyến trong tháng');
      for (const value of container.querySelectorAll('.fleet-kpi-card__value')) {
        const units = value.querySelectorAll('.fleet-num-unit');
        expect(units, 'each KPI value is exactly one nowrap unit').toHaveLength(1);
        expect(units[0].textContent).toMatch(TOKEN);
      }
      // textContent pins (not getByText): the counts live inside spans now,
      // and the exact composed text is the whitespace contract of the
      // rewrite — "Hoạt động: 3 / 5 xe", "25 chuyến".
      const subs = Array.from(container.querySelectorAll('.fleet-kpi-card__sub'));
      expect(subs.some((el) => el.textContent === 'Hoạt động: 3 / 5 xe')).toBe(true);
      expect(subs.some((el) => el.textContent === '25 chuyến')).toBe(true);
    }
    {
      const { container } = renderDaily();
      await within(container).findByText('Tổng chuyến trong ngày');
      // The risky rewrite site: the footer sentence must stay word-identical
      // with both counts bound as units ("3 xe lăn bánh / 5 xe").
      const footCells = Array.from(container.querySelectorAll('tfoot td'));
      const sentence = footCells.find((el) => el.textContent!.includes('xe lăn bánh'));
      expect(sentence?.textContent).toBe('3 xe lăn bánh / 5 xe');
      expect(sentence!.querySelectorAll('.fleet-num-unit')).toHaveLength(2);
    }
  });

  it('every column header carries its full label as title — the "% Năng suất cao" header can never be ambiguous', async () => {
    {
      const { container } = renderMonthly();
      await within(container).findByText('Tổng chuyến trong tháng');
      const headers = Array.from(container.querySelectorAll('thead th'));
      expect(headers).toHaveLength(13);
      for (const th of headers) {
        expect(th.getAttribute('title'), `header ${JSON.stringify(th.textContent)} needs its full label as title`).toBe(th.textContent);
      }
      const last = headers[headers.length - 1];
      expect(last.textContent).toBe('% Năng suất cao');
      expect(last.getAttribute('title')).toBe('% Năng suất cao');
    }
    {
      const { container } = renderDaily();
      await within(container).findByText('Tổng chuyến trong ngày');
      const headers = Array.from(container.querySelectorAll('thead th'));
      expect(headers).toHaveLength(10);
      for (const th of headers) {
        expect(th.getAttribute('title')).toBe(th.textContent);
      }
    }
  });
});
