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

// SIL-794 (id 920, QA 10/11, KB Ch10 10.8.1) retires the SIL-571/578 floor:
// the 1189px table min-width overflowed the real 1440-viewport canvas
// (~1144px after the pinned sidebar) under the viewport's overflow-x: clip
// and cut TRANG THAI off screen. The table is now exactly its canvas: the
// floor-proportional percentage shares remain (every engine resolves them;
// min-width on <col> stays banned - column boxes only honor `width`), fixed
// layout keeps each column at its exact share, cells and headers wrap fully,
// and the container-query scroll lane died with the floor (nothing overflows
// any more). The pinned-thead law (card 20260926_49) keeps binding the
// app-body scrollport on every canvas.
describe('/shipments sort-header column shares (SIL-794 retires the SIL-571/578 floor)', () => {
  const shipments = readFileSync(resolve(process.cwd(), 'src/pages/ShipmentsPage.css'), 'utf8');

  it('drops the table min-width floor so the board always fits its canvas (SIL-794)', () => {
    const band = shipments.match(/@media \(min-width: 1024px\) \{[\s\S]*?col--status \{ width: 10\.045%; \}\n\}/)?.[0] ?? '';
    expect(band, 'band exists').not.toBe('');
    // The floor overflowed the 1144px canvas at a 1440 viewport under the
    // viewport's overflow-x: clip - the rightmost column (TRANG THAI) was
    // cut off screen. The band carries ONLY the col share rules (no bare
    // .cus-dashboard-table rule, no floor declaration anywhere).
    expect(band).not.toMatch(/\.cus-dashboard-table\s*\{/);
    expect(shipments).not.toMatch(/min-width:\s*1189/);
    expect(band).toMatch(/col--customer \{ width: 16\.785%; \}/);
    expect(band).toMatch(/col--documents \{ width: 14\.755%; \}/);
    expect(band).toMatch(/col--classification \{ width: 16\.093%; \}/);
    expect(band).toMatch(/col--cargo \{ width: 15\.883%; \}/);
    expect(band).toMatch(/col--schedule \{ width: 15\.167%; \}/);
    expect(band).toMatch(/col--notes \{ width: 11\.272%; \}/);
    expect(band).toMatch(/col--status \{ width: 10\.045%; \}/);
    // Shares still sum to 100% so every column resolves to its exact share
    // of the real canvas.
    const shares = [...band.matchAll(/width: ([\d.]+)%/g)].map((m) => Number(m[1]));
    expect(shares.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 2);
  });

  it('never returns to inert min-width pinning on the col elements', () => {
    expect(shipments).not.toMatch(/cus-dashboard-col--\w+ \{ min-width:/);
  });

  it('keeps the viewport a non-scroll container at every width - no floor, no overflow lane', () => {
    // The container-query scroll band died with the floor: without
    // min-width the fixed-layout table equals the canvas and cannot
    // overflow, so nothing may re-introduce a horizontal scroll lane.
    expect(shipments).not.toMatch(/@container \(max-width: 1188\.5px\)/);
    expect(shipments).toMatch(/\.cus-dashboard-viewport\s*\{[^}]*overflow-x:\s*clip;/);
  });
});
