import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// SIL-584 (2026-10-29 audit): /dispatch-detail @768 — a row's ⋯ trigger was
// measured INSIDE a .ds-pagination__btn. The overlap class is owned by the
// LAYOUT CONTRACT, not by a padding patch: the board lives in a BOUNDED PANE
// (owner redesign 23/10 spec B — overflow:auto + max-height) and the pager
// stays IN FLOW after it (card 20260921_22, pinned in
// src/pages/DispatchPlanPage.test.tsx). Rows scroll INSIDE the pane and can
// never extend into the pager's box; the pane's own cell padding keeps the
// last row's trigger one gutter above the pane's bottom edge. This pin holds
// both halves: a sticky pager or an unbounded wrapper re-opens the defect.
const css = readFileSync(resolve(process.cwd(), 'src/features/dispatch/detailed-plan/DetailedPlanGrid.css'), 'utf8');
const pageCss = readFileSync(resolve(process.cwd(), 'src/pages/DispatchPlanPage.css'), 'utf8');

describe('row actions never reach the pager (SIL-584)', () => {
  it('the board scrolls inside a bounded pane, never the page under the pager', () => {
    const wrapper = css.match(/\.detailed-plan-grid__wrapper\s*\{[^}]*\}/)?.[0] ?? '';
    expect(wrapper, 'pane rule exists').not.toBe('');
    expect(wrapper).toMatch(/overflow:\s*auto;/);
    expect(wrapper).toMatch(/max-height:\s*calc\(/);
    // The phone card list legitimately unbounds (--cards); the TABLE pane may not.
    expect(wrapper).not.toMatch(/max-height:\s*none/);
  });

  it('the workspace pager stays static in flow after the pane', () => {
    const pager = pageCss.match(/__workspace > \.ds-pagination\s*\{[^}]*\}/)?.[0] ?? '';
    expect(pager, 'pager rule exists').not.toBe('');
    expect(pager).toMatch(/position:\s*static;/);
    expect(pager).not.toMatch(/position:\s*(sticky|fixed|absolute)/);
  });
});
