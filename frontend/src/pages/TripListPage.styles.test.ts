import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const tableCss = readFileSync(resolve(process.cwd(), 'src/pages/trip-list/table.css'), 'utf8');

describe('trips table width contract (card _23)', () => {
  it('sizes the grid to its intrinsic floor so ≥1440 viewports never scroll', () => {
    // Content floor = fixed columns (124+116+116+112+112+100+100 = 780px)
    // + minmax floors (200+250+104 = 554px) + nine 10px gaps (90px) = 1424px.
    // The 1438px card frame at ≥1440 viewports must stay larger than this or
    // the TRẠNG THÁI column edge clips behind a pointless 22px scrollbar.
    expect(tableCss).not.toContain('min-width: 1460px');
    expect(tableCss.match(/min-width: 1424px/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it('keeps the ten-column template with its minmax floors so the floor math holds', () => {
    const template = 'grid-template-columns: minmax(200px, 1.3fr) 124px minmax(250px, 1.45fr) minmax(104px, 0.6fr) 116px 116px 112px 112px 100px 100px;';
    expect(tableCss.match(new RegExp(template.replaceAll('(', '\\(').replaceAll(')', '\\)'), 'g'))?.length).toBeGreaterThanOrEqual(2);
  });
});

describe('quick-row-error contract (card _44)', () => {
  it('error message renders as plain wrapped text, no pill, no clip', () => {
    const rule = tableCss.match(/\.trip-list-page \.quick-row-error \{[\s\S]*?\}/)?.[0];
    expect(rule).toBeDefined();
    expect(rule).not.toMatch(/border-radius|background:|border:|max-width|text-overflow|overflow: hidden/);
    expect(rule).toContain('overflow-wrap: anywhere');
    expect(rule).toContain('white-space: normal');
  });
});

// ── Compact desktop (1024–1439): column priority (QA-2026-09-22-03) ────────
// Law §4 reserves horizontal scroll for token tables; /trips is a data table,
// so below the wide-desktop threshold (Layout WIDE_DESKTOP_MIN_WIDTH = 1440)
// the analytic columns yield their tracks instead of scrolling. The 1280 fit
// is asserted as arithmetic over the compact template, not as a snapshot of
// the old overflow behavior.
describe('trips table compact-desktop contract (QA-2026-09-22-03)', () => {
  // Scrollport budget constants, each cited to its rule:
  const RAIL = 48;        // collapsed sidebar rail below 1440 (Layout.tsx WIDE_DESKTOP_MIN_WIDTH)
  const PAD_X = 40;       // --app-body-pad-x 20px × 2 in the 1024–1280 media (app-shell.css)
  const CARD_BORDER = 2;  // .table-card 1px border × 2 (table.css)
  const SCROLLBAR = 15;   // classic vertical scrollbar reserve in .app-body (scrollbar-gutter: stable)
  const GAP = 10;         // .table-head/.table-row gap (table.css)
  const CELL_PAD = 32;    // .table-head/.table-row horizontal padding 14px 16px (table.css)
  const budgetAt1280 = 1280 - RAIL - PAD_X - CARD_BORDER - SCROLLBAR; // 1175

  const compactStart = tableCss.indexOf('@media (max-width: 1439px)');
  const compact = compactStart === -1 ? '' : tableCss.slice(compactStart);

  const trackFloors = (template: string): number[] =>
    template
      .replace(/,\s+/g, ',')
      .split(/\s+/)
      .filter(Boolean)
      .map((part) => {
        const minmax = part.match(/^minmax\((\d+)px/);
        return minmax ? Number(minmax[1]) : parseInt(part, 10);
      });

  it('yields the analytic columns below 1440 (head + row cells hidden)', () => {
    expect(compact).toMatch(/\.trip-list-page \.col-consumption,\s*\.trip-list-page \.col-road \{[\s\S]*?display: none;/);
  });

  it('pins the 8-column compact template on head and row with whole-token/money floors fitting the 1280 scrollport', () => {
    const template = 'minmax(120px, 1.3fr) 104px minmax(120px, 1.45fr) 88px 112px 92px 92px 100px;';
    expect(compact).toContain('.trip-list-page .table-head,\n  .trip-list-page .table-row {');
    expect(compact.split(template).length - 1).toBe(1);

    const floors = trackFloors(template);
    // Content floors: trip code ≈82px, plate chip ≈98px, route wraps, container
    // token ≈86px, revenue incl. D2 "Thiếu giá 15T" chip ≈110px, money ≈75px,
    // header "TỔNG CHI PHÍ" ≈89px, status pill + hover chevron ≈71px.
    expect(floors).toEqual([120, 104, 120, 88, 112, 92, 92, 100]);
    const width = floors.reduce((a, b) => a + b, 0) + (floors.length - 1) * GAP + CELL_PAD;
    expect(width).toBeLessThanOrEqual(budgetAt1280);
  });

  it('releases the wide floor in the compact band (min-width 0 on the shared head/row rule)', () => {
    expect(compact.split('min-width: 0;').length - 1).toBe(1);
  });
});
