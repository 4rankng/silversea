// SIL-1189 — the 'Nợ chứng từ' board (both Kế toán and Chứng từ roles): the
// board lives in .doc-debt__scroll (overflow-x: auto over the --border-1
// hairline) and can never crush a column below its floor — per-column
// min-widths keyed by [data-label] on BOTH th and td (the DebtListPage
// attribute-keyed pattern), single-token cells (bill code, received date)
// expand instead of breaking, and a header rule never carries the
// anywhere/break-all mid-word break. These pins guard DocumentDebtPage.css
// and the data-label keys DocumentDebtPage.tsx stamps on every th and td.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(process.cwd(), 'src/pages/DocumentDebtPage.css'), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
);
const tsx = readFileSync(resolve(process.cwd(), 'src/pages/DocumentDebtPage.tsx'), 'utf8');

const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
  selector: m[1].trim(),
  body: m[2],
}));

const COLUMN_FLOORS: Array<[string, string]> = [
  ['Số Bill/Booking', '110px'],
  ['Khách hàng', '104px'],
  ['Lớp 1 · e-POD', '132px'],
  ['Lớp 2 · Bộ hồ sơ chứng từ gốc', '170px'],
  ['Lớp 3 · Phiếu phơi', '132px'],
  ['Người nhận', '100px'],
  ['Ngày nhận thực tế', '124px'],
  ['Thao tác', '76px'],
];

// SIL-1189 R5 (build a22b4bcc, 1440px): the eight floors must sum UNDER the
// measured 1095px lane frame so the whole board — the NGÀY NHẬN THỰC TẾ
// header included — renders complete at default, with the lane's overflow
// kept only for content longer than a floor.
const FLOOR_BUDGET_PX = 1095;

describe('DocumentDebtPage board — SIL-1189 column floors', () => {
  it('every column floors on BOTH th and td via its [data-label] key', () => {
    for (const [label, floor] of COLUMN_FLOORS) {
      const rule = rules.find((r) => r.selector === `.doc-debt__table [data-label='${label}']`);
      if (!rule) throw new Error(`missing [data-label='${label}'] floor rule`);
      expect(rule.body, `floor for ${label}`).toMatch(new RegExp(`min-width:\\s*${floor}`));
    }
  });

  it('the floor sum sits under the measured 1095px lane frame (board reads whole at default)', () => {
    const sum = COLUMN_FLOORS.reduce((total, [, floor]) => total + Number.parseInt(floor, 10), 0);
    expect(sum).toBeLessThan(FLOOR_BUDGET_PX);
  });

  it('header labels wrap at spaces — normal white-space with keep-all, never a mid-token break', () => {
    const rule = rules.find((r) => r.selector === '.doc-debt__table thead th');
    if (!rule) throw new Error('missing thead th wrap rule');
    expect(rule.body).toMatch(/white-space:\s*normal/);
    expect(rule.body).toMatch(/overflow-wrap:\s*normal/);
    expect(rule.body).toMatch(/word-break:\s*keep-all/);
  });

  it('the bill code and received date are single-token cells that expand, never break', () => {
    const rule = rules.find(
      (r) =>
        r.selector.includes("td[data-label='Số Bill/Booking']") &&
        r.selector.includes("td[data-label='Ngày nhận thực tế']"),
    );
    if (!rule) throw new Error('missing single-token cell rule for bill code + date');
    expect(rule.body).toMatch(/white-space:\s*nowrap/);
    expect(rule.body).toMatch(/overflow-wrap:\s*normal/);
    expect(rule.body).toMatch(/word-break:\s*keep-all/);
    expect(rule.body).not.toMatch(/ellipsis|overflow:\s*hidden/);
  });

  it('headers never chop mid-word — a th rule never carries the anywhere/break-all break', () => {
    for (const { selector, body } of rules) {
      if (!/(^|[\s,>+~])th\b/.test(selector)) continue;
      expect(body, `rule ${selector}`).not.toMatch(
        /overflow-wrap:\s*anywhere|word-break:\s*break-all/,
      );
    }
  });

  it("the scroll box stays the board's overflow owner with its hairline seam", () => {
    const rule = rules.find((r) => r.selector === '.doc-debt__scroll');
    if (!rule) throw new Error('missing .doc-debt__scroll rule');
    expect(rule.body).toMatch(/overflow-x:\s*auto/);
    expect(rule.body).toMatch(/var\(--border-1/);
  });
});

describe('DocumentDebtPage board — SIL-1189 keys exist in markup', () => {
  it('every column header and body cell carries the data-label floor key', () => {
    // Static columns stamp the label literally on th and td…
    const STATIC_COLUMN_LABELS = [
      'Số Bill/Booking',
      'Khách hàng',
      'Người nhận',
      'Ngày nhận thực tế',
      'Thao tác',
    ];
    for (const label of STATIC_COLUMN_LABELS) {
      expect(tsx, `data-label key for ${label}`).toContain(`data-label="${label}"`);
    }
    // …while the three layer columns share one label map between their th
    // and tds (th text rendered from the same map, so header and key can
    // never drift apart).
    const LAYER_LABELS = COLUMN_FLOORS.slice(2, 5).map(([label]) => label);
    for (const label of LAYER_LABELS) {
      expect(tsx, `LAYER_COLUMN_LABELS value for ${label}`).toContain(`'${label}'`);
    }
    expect(tsx).toMatch(/data-label=\{LAYER_COLUMN_LABELS\[layerKey\]\}/);
    expect(tsx).toMatch(/data-label=\{columnLabel\}/);
    expect(tsx).toMatch(/data-label="Ngày nhận thực tế">\{formatReceivedOn/);
  });
});
