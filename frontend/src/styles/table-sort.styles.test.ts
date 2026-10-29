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

// SIL-571/SIL-578 (2026-10-29 rework): /shipments sortable headers own their
// one-line width through the TABLE's min-width plus floor-proportional
// percentage column shares — `min-width` on <col> is not part of the table
// layout algorithms (QA's engine ignored it entirely; Chromium honored it
// only partially), so the floors must live on properties every engine
// resolves. The viewport scrolls horizontally ONLY where the worksheet
// container is narrower than the floored table (a container query, not a
// media query: the real canvas is not a function of window width — the
// pinned sidebar eats ~296px at ≥1440), so the pinned-thead law
// (card 20260926_49) keeps binding the app-body scrollport everywhere the
// table fits.
describe('/shipments sort-header column floors (SIL-571/SIL-578)', () => {
  const shipments = readFileSync(resolve(process.cwd(), 'src/pages/ShipmentsPage.css'), 'utf8');

  it('floors the table at the one-line header sum and shares columns proportionally to those floors', () => {
    const band = shipments.match(/@media \(min-width: 1024px\) \{[\s\S]*?\.cus-dashboard-table col\.cus-dashboard-col--status[^}]*\}\n\}/)?.[0] ?? '';
    expect(band, 'band exists').not.toBe('');
    // The col min-width approach is banned: column boxes only honor `width`.
    expect(band).toMatch(/\.cus-dashboard-table\s*\{[^}]*min-width:\s*1189px;/);
    expect(band).toMatch(/col--customer \{ width: 16\.785%; \}/);
    expect(band).toMatch(/col--documents \{ width: 14\.755%; \}/);
    expect(band).toMatch(/col--classification \{ width: 16\.093%; \}/);
    expect(band).toMatch(/col--cargo \{ width: 15\.883%; \}/);
    expect(band).toMatch(/col--schedule \{ width: 15\.167%; \}/);
    expect(band).toMatch(/col--notes \{ width: 11\.272%; \}/);
    expect(band).toMatch(/col--status \{ width: 10\.045%; \}/);
    // Shares must sum to 100% and each must resolve ≥ its exact floor at the
    // 1189px table floor (floor/1188.7 of the used width).
    const shares = [...band.matchAll(/width: ([\d.]+)%/g)].map((m) => Number(m[1]));
    expect(shares.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 2);
  });

  it('never returns to inert min-width pinning on the col elements', () => {
    expect(shipments).not.toMatch(/cus-dashboard-col--\w+ \{ min-width:/);
  });

  it('scopes the horizontal scroll to canvases narrower than the floored table', () => {
    const scrollBand = shipments.match(/@container \(max-width: 1188\.5px\) \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(scrollBand).toMatch(/\.cus-dashboard-viewport\s*\{[^}]*overflow-x:\s*auto;/);
    // The resting viewport must stay a non-scroll container (sticky-thead law).
    expect(shipments).toMatch(/\.cus-dashboard-viewport\s*\{[^}]*overflow-x:\s*clip;/);
  });
});
