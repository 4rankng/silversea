// Card 20260929_ivt (redesign) — the board rides the shared record-table base.
//
// This file used to pin the page's own anti-spill skin (table-layout: auto,
// min-width: 1350px, 14 nth-child column floors, a token/token-nowrap split and
// a private @container collapse). That skin was the page-local invention the
// redesign retires: a 14-column board at the 1112px desktop canvas measured
// 1953px wide, i.e. 841px of horizontal scroll, which the shell's
// `overflow-x: hidden` app-body cannot even reach. The board now declares no
// table shape at all — the base owns containment, wrapping and the card band.
//
// jsdom has no layout engine, so this file pins the CONTRACT; the measured
// layout proof lives in qa/2026-09-23_c52-invoice-tracking/layout-harness.mjs
// (per-cell scrollWidth ≤ clientWidth, no horizontal overflow) and was re-run
// for the redesign at 1104/1112/1144/1624px of canvas.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const cwd = process.cwd();
const read = (relativePath: string) => readFileSync(resolve(cwd, relativePath), 'utf8');

const css = read('src/pages/AccountingInvoiceTrackingPage.css');
const tsx = read('src/pages/AccountingInvoiceTrackingPage.tsx');
/** Comments name the retired rules on purpose; only rule bodies are asserted. */
const rules = css.replace(/\/\*[\s\S]*?\*\//g, '');

describe('invoice-tracking board adopts the shared record-table base', () => {
  it('renders the shared recipe — record-table-wrap + `record-table ops-table`, no page skin class', () => {
    expect(tsx).toContain('record-table-wrap');
    expect(tsx).toContain('className="record-table ops-table"');
    expect(tsx).toContain("import '../styles/record-table.css'");
    expect(tsx).toContain("import '../styles/operational-table-typography.css'");
    expect(rules).not.toMatch(/\.invoice-tracking-table/);
  });

  it('keeps no scroll wrapper — the base is overflow: visible so the sticky thead pins to the app scrollport', () => {
    expect(tsx).not.toContain('table-scroll');
    // The container that drives the base's card band is the wrap the base owns.
    expect(rules).not.toMatch(/container-type/);
  });

  it('declares no column floor, no private breakpoint and no private card collapse', () => {
    expect(rules).not.toMatch(/nth-child\(/);
    expect(rules).not.toMatch(/min-width:\s*1350px|min-width:\s*1180px/);
    expect(rules).not.toMatch(/@container/);
    expect(rules).not.toMatch(/@media/);
    expect(rules).not.toMatch(/table-layout/);
  });

  it('never clips or ellipsises a data cell — design law §4 no-truncation doctrine', () => {
    // Only the page's table-cell rules are in scope: the modal's lot-picker list
    // keeps `overflow: hidden` for its own rounded corners, off the board.
    const cellRules = [...rules.matchAll(/([^{}]+)\{([^}]*)\}/g)]
      .filter(([, selector]) => /\b(td|th)\b/.test(selector))
      .map(([, selector, body]) => `${selector.trim()} {${body.trim()}}`);
    expect(cellRules.join('\n')).not.toContain('overflow: hidden');
    expect(cellRules.join('\n')).not.toContain('text-overflow: ellipsis');
  });

  it('carries data-label on every data cell so the container-query cards stay labelled', () => {
    const body = tsx.slice(tsx.indexOf('<tbody>'));
    const cells = body.match(/<td[^>]*>/g) ?? [];
    expect(cells.length).toBeGreaterThan(0);
    for (const cell of cells) {
      expect(cell, `${cell} must carry data-label`).toContain('data-label');
    }
    // The card band prints `attr(data-label)`; a header rename must follow.
    for (const label of ['Lô hàng', 'Nhà cung cấp', 'Hóa đơn', 'Ngày gửi', 'Chênh lệch']) {
      expect(tsx, `${label} cell label`).toContain(`data-label="${label}"`);
    }
  });

  it('marks the money and date cells with the shared numeric class', () => {
    for (const label of ['Ngày', 'Số tiền trả', 'Chênh lệch', 'Ngày gửi']) {
      expect(tsx, `${label} is numeric`).toMatch(new RegExp(`data-label="${label}"[^>]*className="num"`));
    }
  });

  it('keeps the two amount cells off the base break-anywhere so a figure never splits mid-number', () => {
    const amountRule = rules.match(/\.invoice-tracking-page \.record-table td\[data-label="Số tiền trả"\],[\s\S]*?\}/)?.[0] ?? '';
    expect(amountRule).toContain('data-label="Chênh lệch"');
    expect(amountRule).toContain('overflow-wrap: normal');
    expect(amountRule).toContain('word-break: keep-all');
    // Never `nowrap`: the amount may still wrap at its own boundary (digits / ₫).
    expect(amountRule).not.toContain('nowrap');
  });

  it('keeps the action cell on one line — a control pair cannot wrap', () => {
    expect(tsx).toContain('className="invoice-tracking-actions record-table__action"');
    expect(rules).toMatch(/\.invoice-tracking-actions\s*\{[^}]*white-space:\s*nowrap/);
  });
});

describe('invoice-tracking command strip (card 20260929_ivt — shared primitives)', () => {
  const layout = read('src/components/Layout.tsx');

  it('names the screen once, with the sidebar label, through the shared PageHeader', () => {
    const navLabel = layout.match(/path: '\/accounting\/invoice-tracking'[\s\S]{0,40}?/)?.[0] ?? '';
    expect(navLabel).toBeTruthy();
    // The three role navs (admin/accountant/CUS) must agree on the one name.
    const labels = [...layout.matchAll(/label: '([^']+)', path: '\/accounting\/invoice-tracking'/g)].map((m) => m[1]);
    expect(new Set(labels).size, `nav labels disagree: ${labels.join(' | ')}`).toBe(1);

    expect(tsx).toContain('<PageHeader');
    expect(tsx).toContain(`title="${labels[0]}"`);
    // The hand-rolled <header> band and its KPI ribbon are retired.
    expect(tsx).not.toMatch(/invoice-tracking-header/);
    expect(tsx).not.toMatch(/invoice-tracking-kpi/);
    expect(tsx).not.toMatch(/<h1>/);
  });

  it('renders the Σ strip on the shared SummaryRail, not a page-local KPI block', () => {
    expect(tsx).toContain('<SummaryRail');
    expect(tsx).toContain('ariaLabel="Tổng cộng theo kỳ"');
    expect(tsx).toContain("label: 'Hóa đơn'");
    expect(tsx).toContain("label: 'Trả NCC'");
    expect(tsx).toContain("label: 'Chênh lệch'");
    expect(rules).not.toMatch(/\.ivt-money|\.invoice-tracking-kpi/);
  });

  it('header actions are the two shared buttons, not a page-local action row', () => {
    expect(tsx).toContain('Xuất Excel');
    expect(tsx).toContain('downloadCSV');
    expect(tsx).toContain('Thêm chi phí lô hàng');
    expect(rules).not.toMatch(/\.invoice-tracking-header__actions/);
    expect(tsx).not.toMatch(/>Loc<|>Lọc</);
  });

  it('loading and empty render the shared primitives, never a page-local row', () => {
    expect(tsx).toContain('<SkeletonTable');
    expect(tsx).toContain('<EmptyState');
    expect(tsx).toMatch(/context="finance"/);
    expect(tsx).not.toMatch(/invoice-tracking-empty/);
    expect(rules).not.toMatch(/invoice-tracking-empty/);
  });

  it('row 2: the shared bar owns the strip — period fields, quick ranges, search slot, Bộ lọc dialog', () => {
    // Card 20260927_152: the page hands its criteria to the shared bar; the
    // layout (row packing, every filter width) lives in FilterBar.css.
    expect(tsx).toContain('<FilterBar');
    expect(tsx).toContain('<DateRangeFields');
    expect(tsx).toContain('<DateRangePresets');
    expect(tsx).toContain('<FilterDropdown');
    expect(tsx).not.toContain('DateRangePopover');
    expect(tsx).toContain('Tháng này');
    expect(tsx).toContain('Tháng trước');
    expect(tsx).toContain('Quý này');
    expect(tsx).toMatch(/Số HĐ, MST, Lô, Cont/);
    expect(tsx).toContain('Chỉ xem dòng có lệch');
    expect(tsx).toContain('Xóa lọc');
    expect(tsx).toContain('dialogLabel="Bộ lọc hóa đơn"');
  });

  it('the page declares no rule of its own for a filter control — the bar owns every width', () => {
    // Comments name the deleted rules on purpose; only the rule bodies count.
    expect(rules).not.toMatch(/\.invoice-tracking-(filters|range|search|supplier|diff)\b/);
  });

  it('empty state keeps the period copy and the clear-filters sub-link', () => {
    expect(tsx).toContain('Không tìm thấy hóa đơn nào trong kỳ đã chọn');
    expect(tsx).toContain('Xóa bộ lọc ngày');
  });

  it('scrollbar thumb is neutral ink — the green table-scroll thumb is gone', () => {
    const tableCss = read('src/components/Table.css');
    expect(tableCss).not.toMatch(/scrollbar-thumb[^}]*rgba\(0,\s*90,\s*45/);
  });
});
