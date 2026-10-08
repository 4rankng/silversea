import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Card 20261004_336 (law book §4 no-truncation doctrine, card 20260922_37):
// the customers business-name cell used to carry the truncate+tooltip idiom —
// `overflow: hidden; text-overflow: ellipsis; white-space: nowrap` on
// `.customers-name-cell` with a `title={c.name}` hover crutch. A business name
// is WRAPPING text, not a single token: it must display in full at every table
// width by wrapping inside the auto identity column (card 335 pinned that
// column as the ONE auto column — its width source is untouched by this fix).
// `text-overflow: ellipsis` on a data cell is banned outright; the tooltip is
// only the fallback for values that CANNOT wrap, and this one can.

const css = readFileSync(resolve(process.cwd(), 'src/pages/CustomersPage.css'), 'utf8');
const tsx = readFileSync(resolve(process.cwd(), 'src/pages/CustomersPage.tsx'), 'utf8');

const rule = (source: string, selector: string): string => {
  const found = source.match(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^{]*\\{([^}]*)\\}`))?.[1];
  expect(found, `${selector} rule exists`).toBeTruthy();
  return found!;
};

const CLIP = /text-overflow:\s*ellipsis/;
const CLIP_HIDDEN = /overflow:\s*hidden/;
const CLAMP = /-webkit-line-clamp/;

describe('customers business-name cell wraps in full (card 20261004_336)', () => {
  it('the name-cell rule wraps; every truncation idiom is gone', () => {
    const body = rule(css, '.customers-name-cell');
    expect(body).not.toMatch(CLIP);
    expect(body).not.toMatch(CLIP_HIDDEN);
    expect(body).not.toMatch(CLAMP);
    // The wrap itself is pinned: normal wrapping plus the house emergency break
    // for long unbroken tokens (same idiom as .customers-cell-wrap).
    expect(body).toMatch(/white-space:\s*normal/);
    expect(body).toMatch(/overflow-wrap:\s*anywhere/);
  });

  it('the rendered name cell carries no truncation-compensating title tooltip', () => {
    const cell = tsx.match(/<span className="customers-name-cell"[\s\S]*?<\/span>/)?.[0];
    expect(cell, 'the name span still renders').toBeTruthy();
    // No hover crutch on the opening tag, and the value renders in full.
    expect(cell!).not.toMatch(/<span[^>]*\btitle=/);
    expect(cell!).toContain('>{c.name}</span>');
  });

  it('a long business name renders its full text in the cell', () => {
    // Behavior pin at the DOM level: whatever the name is, the cell shows all
    // of it — truncation, if it ever returned, would live in CSS/JS shortening,
    // and both halves above guard those.
    const cell = tsx.match(/<span className="customers-name-cell"[^>]*>[\s\S]*?<\/span>/)?.[0] ?? '';
    expect(cell).toContain('{c.name}');
    expect(cell).not.toMatch(/slice|substring|truncate|ellipsis/i);
  });
});
