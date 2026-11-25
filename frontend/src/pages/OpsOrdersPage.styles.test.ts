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
