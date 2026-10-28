import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(process.cwd(), 'src/styles/table-sort.css'), 'utf8');

describe('shared sort-header button styling', () => {
  it('inherits the th typography contract instead of carrying its own font sizing', () => {
    const button = css.match(/\.table-sort-button\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
    expect(button).toMatch(/font:\s*inherit;/);
    expect(button).toMatch(/color:\s*inherit;/);
    expect(button).not.toMatch(/font-size/);
  });

  it('keeps hover a neutral ink lift, never an accent wash', () => {
    const hover = css.match(/\.table-sort-button:hover\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
    expect(hover).toMatch(/color:\s*var\(--ink\);/);
    expect(css).not.toMatch(/accent-soft|brand-primary/);
  });

  it('quiets the idle direction icon until the column is the active sort', () => {
    const idle = css.match(/\.table-sort-button__icon--idle\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
    // Card 20260922_26: 0.4 rendered the 13px indicator as a stray mark next to
    // the label ("TRẠNG THÁI !"); 0.65 keeps it secondary but legible.
    expect(idle).toMatch(/opacity:\s*0\.65;/);
  });

  it('card 20260922_26: the sort button keeps a 24x24 hit area without changing header density', () => {
    const base = css.match(/\.table-sort-button\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
    expect(base).toMatch(/min-height:\s*24px;/);
    // The matching negative block margin keeps the th's layout height intact.
    expect(base).toMatch(/margin-block:\s*-5px;/);
  });
});

// SIL-571 (2026-10-29): /shipments sortable headers own their one-line width —
// per-column min-width floors at the 1024–1440 bands (2026-09-29 board law:
// the table grows and scrolls instead of columns collapsing), and the
// viewport scrolls horizontally ONLY where the floored table outgrows the
// canvas, so the pinned-thead law (card 20260926_49) keeps binding the
// app-body scrollport at every wider width.
describe('/shipments sort-header column floors (SIL-571)', () => {
  const shipments = readFileSync(resolve(process.cwd(), 'src/pages/ShipmentsPage.css'), 'utf8');

  it('floors every grouped-header column at its one-line header width in the 1024–1440 band', () => {
    const band = shipments.match(/@media \(min-width: 1024px\) and \(max-width: 1440px\) \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(band, 'band exists').not.toBe('');
    expect(band).toMatch(/col--customer \{ min-width: 200px; \}/);
    expect(band).toMatch(/col--documents \{ min-width: 110px; \}/);
    expect(band).toMatch(/col--classification \{ min-width: 192px; \}/);
    expect(band).toMatch(/col--cargo \{ min-width: 190px; \}/);
    expect(band).toMatch(/col--schedule \{ min-width: 182px; \}/);
    expect(band).toMatch(/col--status \{ min-width: 120px; \}/);
  });

  it('scopes the horizontal scroll to the widths where the floored table outgrows the canvas', () => {
    const scrollBand = shipments.match(/@media \(max-width: 1158px\) and \(min-width: 768px\) \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(scrollBand).toMatch(/\.cus-dashboard-viewport\s*\{[^}]*overflow-x:\s*auto;/);
    // The resting viewport must stay a non-scroll container (sticky-thead law).
    expect(shipments).toMatch(/\.cus-dashboard-viewport\s*\{[^}]*overflow-x:\s*clip;/);
  });
});
