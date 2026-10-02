import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { deriveMonthlyFinanceChart } from './finance-derived';
import { RevenueTrendChart, revenueTrendDomain } from '../components/charts/RevenueTrendChart';
import { intersectChartTooltipClip, placeChartTooltip } from '../components/charts/useChartTooltipPosition';
import fixture from './finance-recognized-reports.fixture.json';
import { DashboardMonthlyFinanceChart } from './DashboardPage';

describe('QA-AUDIT-FIN-02 recognized monthly finance chart', () => {
  it('uses actual report values and retains negative-cost months without operational freight', () => {
    const chart = deriveMonthlyFinanceChart(fixture.reports, 10);
    expect(chart.months).toEqual(['T3', 'T4', 'T5', 'T6', 'T7', 'T8', 'T9', 'T10']);
    expect(chart.revenue).toEqual([0, 0, 0, 0, 0, 0, 0, 4.5]);
    expect(chart.gross).toEqual(fixture.reports.slice(2, 10).map(report => report.grossProfit / 1_000_000));
    expect(chart.currentIdx).toBe(7);
    expect(chart.completedTripCount).toBe(3);
    expect(chart.hasChartData).toBe(true);
    expect(chart.revenue.at(-1)).toBe(4.5);
    expect(chart.gross.at(-1)).toBe(2.85);
  });

  it('keeps actual expenses visible even when their reports contain no completed trips', () => {
    const chart = deriveMonthlyFinanceChart(fixture.reports.slice(0, 8), 8);
    expect(chart.completedTripCount).toBe(0);
    expect(chart.hasChartData).toBe(true);
    expect(chart.gross.at(-1)).toBe(-68.37342);
  });

  it('distinguishes missing and actual zero-value monthly sources from nonzero series', () => {
    expect(deriveMonthlyFinanceChart([], 10)).toMatchObject({ months: [], hasChartData: false, completedTripCount: 0 });
    expect(deriveMonthlyFinanceChart([fixture.reports[0], null, fixture.reports[1]], 1)).toMatchObject({ months: [], hasChartData: false, completedTripCount: 0 });
  });

  it('contains every real positive and negative value inside the shared chart domain', () => {
    const chart = deriveMonthlyFinanceChart(fixture.reports, 10);
    const domain = revenueTrendDomain(chart.revenue, chart.gross);
    expect(domain.min).toBeLessThanOrEqual(-68.37342);
    expect(domain.max).toBeGreaterThanOrEqual(4.5);
    for (const value of [...chart.revenue, ...chart.gross]) {
      const position = (value - domain.min) / (domain.max - domain.min);
      expect(position).toBeGreaterThanOrEqual(0);
      expect(position).toBeLessThanOrEqual(1);
    }
    expect(revenueTrendDomain([], []).max).toBeGreaterThan(revenueTrendDomain([], []).min);
  });

  it('renders real recorded loss points inside the actual SVG instead of below it', () => {
    const chart = deriveMonthlyFinanceChart(fixture.reports, 10);
    const html = renderToStaticMarkup(createElement(RevenueTrendChart, chart));
    const svg = new DOMParser().parseFromString(html, 'text/html').querySelector('svg')!;
    const paths = Array.from(svg.querySelectorAll('path[fill="none"]'));
    expect(paths).toHaveLength(2);
    for (const path of paths) {
      const yValues = Array.from(path.getAttribute('d')!.matchAll(/[ML]([-\d.]+)\s+([-\d.]+)/g), match => Number(match[2]));
      expect(yValues).toHaveLength(chart.months.length);
      for (const y of yValues) {
        expect(y).toBeGreaterThanOrEqual(14);
        expect(y).toBeLessThanOrEqual(250);
      }
    }
    expect(svg.textContent).toContain('-');
  });

  it('offers only the report-backed monthly chart and describes its period', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/pages/FinancePage.tsx'), 'utf8');
    expect(source).not.toContain('setChartView');
    expect(source).not.toContain('dailyChartData');
    expect(source).toContain('Doanh thu và lợi nhuận gộp theo tháng');
    expect(source).toContain('Số liệu ghi nhận theo từng tháng');
    expect(source).toContain('!hasChartData && completedTripCount === 0');
  });
});

describe('QA-AUDIT-UI-76 Dashboard recognized monthly chart', () => {
  const documentFor = (reports: typeof fixture.reports | null[], month: number) => {
    const html = renderToStaticMarkup(createElement(DashboardMonthlyFinanceChart, {
      reports, month, year: 2026, onViewReport: () => undefined,
    }));
    return new DOMParser().parseFromString(html, 'text/html');
  };

  it('renders the same recognized monthly amounts as P&L and an honest calendar-year period', () => {
    const document = documentFor(fixture.reports, 10);
    expect(document.querySelector('h2')?.textContent).toBe('Doanh thu và lợi nhuận gộp theo tháng');
    expect(document.body.textContent).toContain('Số liệu ghi nhận theo từng tháng · Năm 2026');
    expect(document.querySelector('svg desc')?.textContent).toContain('Kỳ gần nhất T10: doanh thu 4,5 Tr, lợi nhuận gộp 2,9 Tr.');
    expect(Array.from(document.querySelectorAll('svg text')).map(element => element.textContent)).toEqual(expect.arrayContaining(['T3', 'T4', 'T8', 'T10']));
    expect(Array.from(document.querySelectorAll('button')).map(button => button.textContent?.trim())).toEqual(['Xem báo cáo']);
    expect(document.querySelectorAll('svg path[fill="none"]')).toHaveLength(2);
  });

  it('renders actual loss-only reports without requiring a completed trip or positive total', () => {
    const document = documentFor(fixture.reports.slice(0, 8), 8);
    expect(document.querySelector('svg desc')?.textContent).toContain('Kỳ gần nhất T8: doanh thu 0,0 Tr, lợi nhuận gộp -68,4 Tr.');
    expect(document.body.textContent).not.toContain('Chưa có dữ liệu trong kỳ');
    expect(document.querySelectorAll('svg path[fill="none"]')).toHaveLength(2);
  });

  it('uses the existing empty surface for missing or actual zero-value report periods', () => {
    for (const reports of [[], [null], fixture.reports.slice(0, 2)]) {
      const document = documentFor(reports, 1);
      expect(document.body.textContent).toContain('Chưa có dữ liệu trong kỳ');
      expect(document.body.textContent).toContain('Biểu đồ xuất hiện khi báo cáo ghi nhận doanh thu hoặc lợi nhuận gộp trong năm.');
      expect(document.querySelector('svg[role="img"]')).toBeNull();
    }
  });
});

describe('QA-AUDIT-UI-98 measured chart tooltip containment', () => {
  const viewport = { left: 0, top: 0, right: 390, bottom: 900 };
  const card = { left: 9, top: 271.1875, right: 381, bottom: 557.5859375 };
  const clip = intersectChartTooltipClip(viewport, [{ rect: card, x: true, y: true }]);
  const size = { width: 192, height: 98.6484375 };

  it('keeps the actual near-right September popup whole instead of centering it outside the card', () => {
    const placed = placeChartTooltip({ x: 313.28125, y: 451.859375 }, size, clip, 'center');
    expect(placed.left).toBe(185);
    expect(placed.top).toBeCloseTo(341.2109375);
    expect(placed.left + size.width).toBeLessThanOrEqual(card.right - 4);
    expect(placed.fits).toBe(true);
  });

  it('preserves contained first/last positions and clamps a near-left interior point', () => {
    expect(placeChartTooltip({ x: 63, y: 451.859375 }, size, clip, 'start').left).toBe(63);
    expect(placeChartTooltip({ x: 355, y: 447.9375 }, size, clip, 'end').left).toBe(163);
    expect(placeChartTooltip({ x: 104.7109375, y: 451.859375 }, size, clip, 'center').left).toBe(13);
  });

  it('uses the natural wider box and repositions after an actual clip budget changes', () => {
    const wider = { width: 310, height: 120 };
    const placed = placeChartTooltip({ x: 313.28125, y: 451.859375 }, wider, clip, 'center');
    expect(placed.left).toBe(67);
    expect(placed.left + wider.width).toBe(377);
    expect(placed.fits).toBe(true);
    const resized = intersectChartTooltipClip(viewport, [{ rect: { ...card, right: 361 }, x: true, y: true }]);
    expect(placeChartTooltip({ x: 313.28125, y: 451.859375 }, size, resized, 'center').left).toBe(165);
  });

  it('intersects horizontal and vertical clipping ancestors and flips only when above cannot fit', () => {
    const nested = intersectChartTooltipClip(viewport, [
      { rect: { left: 20, top: 0, right: 370, bottom: 900 }, x: true, y: false },
      { rect: { left: 0, top: 300, right: 390, bottom: 600 }, x: false, y: true },
    ]);
    expect(nested).toEqual({ left: 20, top: 300, right: 370, bottom: 600 });
    const placed = placeChartTooltip({ x: 50, y: 330 }, size, nested, 'center');
    expect(placed).toEqual({ left: 24, top: 342, fits: true });
  });

  it('does not falsely mark an impossible natural box contained or change its financial text', () => {
    const tooNarrow = { left: 20, top: 300, right: 180, bottom: 600 };
    expect(placeChartTooltip({ x: 150, y: 450 }, size, tooNarrow, 'center').fits).toBe(false);
    const chart = deriveMonthlyFinanceChart(fixture.reports, 10);
    expect(chart.gross.at(-2)).toBe(-0.11);
    expect(chart.gross.at(-1)).toBe(2.85);
    expect(chart.revenue.at(-1)).toBe(4.5);
  });
});
