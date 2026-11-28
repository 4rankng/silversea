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
  ['Khách hàng', '96px'],
  ['Lớp 1 · e-POD', '118px'],
  ['Lớp 2 · Bộ hồ sơ chứng từ gốc', '156px'],
  ['Lớp 3 · Phiếu phơi', '118px'],
  ['Người nhận', '92px'],
  ['Ngày nhận thực tế', '116px'],
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

// SIL-1264 — at 390px the 8-column board (948px of floors) forced ~2.5 clipped
// columns onto a phone; below 999px the page now swaps to the labelled record
// card band (the /shipments + record-table answer): thead drops, each row is
// a card, every td carries its data-label eyebrow, and the bill number leads
// the card full-width and prominent. Desktop is untouched — the desktop pins
// above keep passing unchanged.
describe('DocumentDebtPage board — SIL-1264 mobile card band', () => {
  // The band is the file's last block; slice from its prelude so the rules
  // below can only match inside the media query.
  const mediaStart = css.indexOf('@media (max-width: 999px)');
  const mobile = css.slice(mediaStart);
  const mobileRules = [...mobile.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
    selector: m[1].trim(),
    body: m[2],
  }));

  const rule = (selector: string) => {
    const found = mobileRules.find((r) => r.selector === selector);
    if (!found) throw new Error(`missing mobile rule ${selector}`);
    return found;
  };

  it('the card band fires below 999px', () => {
    expect(mediaStart).toBeGreaterThan(-1);
  });

  it('the lane hands overflow back to the page — the cards are natural-height blocks', () => {
    const body = rule('.doc-debt__scroll').body;
    expect(body).toMatch(/overflow:\s*visible/);
    expect(body).toMatch(/max-height:\s*none/);
  });

  it('the header row drops and each row becomes a bordered card grid', () => {
    expect(rule('.doc-debt__table thead').body).toMatch(/display:\s*none/);
    const tr = rule('.doc-debt__table tbody tr').body;
    expect(tr).toMatch(/display:\s*grid/);
    expect(tr).toMatch(/grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
    expect(tr).toMatch(/border:\s*1px solid var\(--border-1/);
    expect(tr).toMatch(/border-radius:/);
  });

  it('every cell renders its data-label eyebrow — the attr(data-label) card key', () => {
    const body = rule('.doc-debt__table tbody td::before').body;
    expect(body).toMatch(/content:\s*attr\(data-label\)/);
    expect(body).toMatch(/font-weight:\s*700/);
    expect(body).toMatch(/text-transform:\s*uppercase/);
  });

  it('the bill number leads the card: full width, heaviest ink, its own label line', () => {
    const bill = rule(".doc-debt__table tbody td[data-label='Số Bill/Booking']").body;
    expect(bill).toMatch(/grid-column:\s*1\s*\/\s*-1/);
    expect(bill).toMatch(/font-weight:\s*700/);
    expect(bill).toMatch(/font-size:\s*15px/);
    expect(rule(".doc-debt__table tbody td[data-label='Số Bill/Booking']::before").body)
      .toMatch(/display:\s*block/);
  });

  it('the action cell needs no eyebrow on the card', () => {
    expect(rule(".doc-debt__table tbody td[data-label='Thao tác']::before").body)
      .toMatch(/display:\s*none/);
  });

  it('the desktop floors still govern — the band adds a mobile answer, never replaces the board', () => {
    for (const [label, floor] of COLUMN_FLOORS) {
      const rule2 = rules.find((r) => r.selector === `.doc-debt__table [data-label='${label}']`);
      expect(rule2?.body, `desktop floor for ${label}`).toMatch(new RegExp(`min-width:\\s*${floor}`));
    }
  });
});
