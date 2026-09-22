import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Card 20260922_37 (no-truncation doctrine, law book §4): table data cells never
// clip a value. The banned patterns are `text-overflow: ellipsis`, clipping
// `overflow: hidden`, and `-webkit-line-clamp` — same defect class. Values either
// WRAP (`white-space: normal` + `overflow-wrap: anywhere`) or EXPAND (single-token
// cells keep `white-space: nowrap` and drop every clip, so the column sizes to
// content — card 20260922_22's auto layout; also QA-090's "identifiers stay
// whole" contract). Truncation-justifying comments are an anti-pattern in their
// own right (law book §11) and die with the clip.
//
// Assertions are rule-local (every rule whose selector matches): controls —
// selects, filter triggers, pickers, nav — keep their legal ellipsis untouched.

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

const rules = (css: string, selector: RegExp): string[] =>
  [...css.matchAll(new RegExp(selector.source + String.raw`[\s\S]*?\{([^}]*)\}`, 'g'))].map((m) => m[0]);

const CLIP = /text-overflow:\s*ellipsis/;
const CLIP_HIDDEN = /overflow:\s*hidden/;
const CLAMP = /-webkit-line-clamp/;
const CLIP_INLINE = /textOverflow:\s*'ellipsis'/;

const expectNoClip = (found: string[]) => {
  expect(found.length).toBeGreaterThan(0);
  for (const rule of found) {
    expect(rule).not.toMatch(CLIP);
    expect(rule).not.toMatch(CLIP_HIDDEN);
    expect(rule).not.toMatch(CLAMP);
  }
};

describe('table data cells never truncate (card 20260922_37)', () => {
  it('ancillary-fees invoice cell wraps instead of ellipsizing at maxWidth 110', () => {
    const src = read('src/components/trip/AncillaryFeesCard.tsx');
    expect(src).not.toMatch(CLIP_INLINE);
    expect(src).not.toContain("whiteSpace: 'nowrap', maxWidth: 110");
    expect(src).toContain("overflowWrap: 'anywhere'");
  });

  it('catalogs bank-name cell wraps; its truncation-justifying comment is gone', () => {
    const css = read('src/features/dispatch/catalogs/catalogs.css');
    expectNoClip(rules(css, /td\[data-label="Ngân hàng nhận tiền"\]/));
    expect(rules(css, /td\[data-label="Ngân hàng nhận tiền"\]/)[0]).toMatch(
      /overflow-wrap:\s*anywhere|white-space:\s*normal/,
    );
    expect(css).not.toContain('truncate with an ellipsis');
  });

  it('create-form container cell display wraps; container codes are never clipped mid-token', () => {
    const css = read('src/features/shipments/create/ShipmentContainerCell.css');
    expectNoClip(rules(css, /\.csc-container-cell__display/));
    expect(css).toMatch(/\.csc-container-cell__display[^}]*overflow-wrap:\s*anywhere/);
  });

  it('config identifier cells expand whole (QA-090) without clipping (card 20260922_37)', () => {
    const css = read('src/pages/config/config-list.css');
    const found = rules(css, /\.cfg-customer-table td\[data-label="Mã KH"\]/);
    expectNoClip(found);
    expect(found[0]).toMatch(/white-space:\s*nowrap/);
    expect(found[0]).not.toMatch(/max-width:\s*170px/);
  });

  it('trip-list plate token wraps instead of ellipsizing', () => {
    const css = read('src/pages/trip-list/table.css');
    expectNoClip(rules(css, /\.trip-list-page \.plate/));
    expect(rules(css, /\.trip-list-page \.plate/)[0]).toMatch(
      /overflow-wrap:\s*anywhere|white-space:\s*normal/,
    );
  });

  it('customers record cells wrap; the 2-line clamp and sub-line ellipsis are gone', () => {
    const css = read('src/pages/CustomersPage.css');
    expect(css).not.toContain('customers-clamp-2');
    expectNoClip(rules(css, /\.customers-cell-wrap/));
    expectNoClip(rules(css, /\.customers-cell-sub/));
    expect(css).not.toMatch(CLAMP);
  });

  it('work-inbox table cells wrap: subtitle and facts never ellipsize', () => {
    const css = read('src/components/work-inbox/RoleWorkInbox.css');
    expectNoClip(rules(css, /\.role-work-inbox__subtitle/));
    expectNoClip(rules(css, /\.role-work-inbox__facts dd/));
    expect(css).not.toMatch(CLAMP);
    expect(css).not.toContain('td:nth-child(3) { overflow: hidden; }');
  });

  it('the customers column popover rides the --surface token (hunk carried for card 20260922_36)', () => {
    const css = read('src/pages/CustomersPage.css');
    const popover = rules(css, /\.customers-cols-popover/)[0];
    expect(popover).toContain('background: var(--surface)');
    expect(popover).not.toContain('background: #fff');
  });
});
