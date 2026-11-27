import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// SIL-990 — the scroll wrapper IS the query container, so it cannot drop its
// own frame when the rows collapse into cards: the frame stayed and every
// row card ended up INSIDE a second frame (card in card — KB V32 / doctrine
// 7, audit tablet 25/11 Mục 7.2). The frame now rides the TABLE (a
// descendant of the container), so the card band can strip it and the row
// cards stand on the page background alone.
const css = readFileSync(resolve(process.cwd(), 'src/pages/OpsOrdersPage.css'), 'utf8');

function ruleBody(selector: string, source = css): string {
  const pattern = new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`);
  const match = source.match(pattern);
  expect(match, `expected a rule for ${selector}`).toBeTruthy();
  return match![1];
}

describe('OpsOrdersPage — the panel frame is never nested inside the row cards (SIL-990)', () => {
  it('keeps the scroll wrapper frameless — it is the query container', () => {
    const scroll = ruleBody('.ops-orders__scroll');
    expect(scroll).not.toMatch(/border:/);
    expect(scroll).not.toMatch(/border-radius:/);
    expect(scroll).not.toMatch(/background:/);
    expect(scroll).toMatch(/container-type:\s*inline-size/);
  });

  it('carries the frame on the table instead', () => {
    const table = ruleBody('.ops-orders__table');
    expect(table).toMatch(/border:\s*1px solid var\(--line\)/);
    expect(table).toMatch(/border-radius:\s*12px/);
  });

  it('drops that frame in the card band, where the rows are the frames', () => {
    const band = css.slice(css.indexOf('@container (max-width: 900px)'));
    const table = ruleBody('.ops-orders__table', band);
    expect(table).toMatch(/border:\s*0/);
    expect(table).toMatch(/border-radius:\s*0/);
    expect(table).toMatch(/background:\s*transparent/);
  });

  it('spans the action cell so the expense button sits on the card edge', () => {
    const band = css.slice(css.indexOf('@container (max-width: 900px)'));
    const actions = ruleBody('.ops-orders__table .ops-orders__row > .col-actions', band);
    expect(actions).toMatch(/grid-column:\s*1 \/ -1/);
    expect(actions).toMatch(/justify-content:\s*flex-end/);
  });
});

describe('OpsOrdersPage — the document is the single vertical scroller (SIL-1195)', () => {
  it('clips horizontally without ever becoming a scroll container', () => {
    const scroll = ruleBody('.ops-orders__scroll').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(scroll).toMatch(/overflow-x:\s*clip/);
    expect(scroll).toMatch(/overflow-y:\s*visible/);
    expect(scroll).not.toMatch(/overflow:\s*auto/);
    expect(scroll).not.toMatch(/max-height/);
    expect(scroll).toMatch(/container-type:\s*inline-size/);
  });

  it('never clips the table — overflow: hidden would become the scrollport and disable the sticky thead', () => {
    // Strip comments first: the rule's rationale mentions the banned value.
    const table = ruleBody('.ops-orders__table').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(table).not.toMatch(/overflow:\s*hidden/);
    // The corner clipper moved onto the pinned header cells.
    const band = css.slice(css.indexOf('@container (min-width: 901px)'));
    expect(band).toMatch(/thead th:first-child \{ border-top-left-radius: 12px; \}/);
    expect(band).toMatch(/thead th:last-child \{ border-top-right-radius: 12px; \}/);
  });

  it('pins an opaque header band flush under the topbar via the shared token', () => {
    const band = css.slice(css.indexOf('@container (min-width: 901px)'));
    expect(band).toMatch(/\.ops-orders \.ops-orders__table thead th\s*\{\s*position:\s*sticky;\s*top:\s*var\(--sticky-thead-top, -24px\);\s*z-index:\s*3;\s*background:\s*var\(--surface-2\);\s*border-bottom:\s*1px solid var\(--line-strong\);\s*\}/);
    // Seams ride borders — the flat-surface reset nulls box-shadow.
    expect(band).not.toMatch(/box-shadow/);
  });
});
