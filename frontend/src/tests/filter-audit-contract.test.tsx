import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FilterBar } from '../design-system/FilterBar';

/**
 * Card 20260930_229: the two-row filter law is STRUCTURAL, so its contract
 * test asserts against the BAND, not the audit script's source text.
 *
 * Until the band existed the law lived forensically: `ui-filter-audit-20260927.mjs`
 * grepped the rendered DOM after the fact, this file pinned the script's
 * regexes character-by-character (a test of a test of a missing module), and
 * the script's two carve-outs were the only escape hatches:
 *   - `rowExempt` — a bar over the row floor with NO `Bộ lọc` trigger had
 *     nothing to fold into, so the row law could only exempt it
 *     (`/customers`@640 was the one case);
 *   - `anchor n/a` — an inline bar has no panel to anchor (still true, and
 *     still the healthy state).
 *
 * Both carve-outs are now properties of the band itself: a `fold` slot ALWAYS
 * mounts the affordance (`FilterDropdown`), and the fold only opens when the
 * measured mode leaves the bar. What remains for the script is styling drift.
 * These tests pin that replacement — if someone turns the fold slot back into
 * criteria the page wires itself, or re-grows the forensic row law, they fail.
 */
const band = readFileSync(resolve(process.cwd(), 'src/design-system/FilterBar.tsx'), 'utf8');
const engine = readFileSync(resolve(process.cwd(), 'src/design-system/filter-bar-mode.ts'), 'utf8');
const alias = readFileSync(resolve(process.cwd(), 'src/components/ListFilterBar.tsx'), 'utf8');
const audit = readFileSync(
  resolve(process.cwd(), '../testplan/qa/scripts/ui-filter-audit-20260927.mjs'),
  'utf8',
);

describe('the band owns the two-row law by construction', () => {
  it('mounts the fold affordance itself for every fold slot — no page-wired trigger', () => {
    // The structural core of the card: the band renders FilterDropdown for a
    // fold slot, and the inline/dialog verdict is the band's own measurement.
    // A consumer cannot mount criteria that exceed the budget without a
    // trigger — the shape `rowExempt` used to excuse is unreachable.
    expect(band).toMatch(/\{fold && \(\s*<FilterDropdown/);
    expect(band).toMatch(/inlineWhenRoom=\{!fold\.neverInline\}/);
    // The landed call carries the wide-surface budget curve (card 20261002_282:
    // 3 rows where the surface opts in, 2 elsewhere — the default stays law).
    expect(band).toContain('useFilterBarFit(barRef, wideBudget ? 3 : 2)');
  });

  it('measures against a TWO-line budget — the default is the law, not a parameter pages tune', () => {
    expect(engine).toMatch(/useFilterBarFit\([^)]*maxLines = 2\)/);
    expect(engine).toMatch(/countLines\(bar\)\s*<=\s*maxLines/);
    // The verdict is width-deterministic (no per-frame flapping between the
    // inline and folded shapes).
    expect(engine).toMatch(/new ResizeObserver\(measure\)/);
  });

  it('keeps exactly ONE bar implementation — ListFilterBar is the alias, not a second bar', () => {
    // The staged-cutover rule: the alias re-exports the band and holds no
    // implementation of its own. A JSX-bearing ListFilterBar would fork the
    // law this card just centralized.
    expect(alias).toMatch(/export \{ FilterBar as ListFilterBar \}/);
    expect(alias).not.toMatch(/return\s*\(/);
    expect(alias).not.toMatch(/className=/);
  });
});

describe('the band behaviour the carve-outs used to excuse', () => {
  it('a fold slot over the budget always has its trigger — the rowExempt shape is unreachable', () => {
    // `neverInline` is the strongest case (criteria that can never fit): the
    // trigger exists at every width, and the applied count rides the trigger's
    // accessible name — the one place a folded criterion announces itself.
    render(
      <FilterBar
        fold={{
          criteria: <div>Kế hoạch</div>,
          count: 2,
          onReset: () => {},
          ariaLabel: 'Bộ lọc',
          neverInline: true,
        }}
      />,
    );
    expect(screen.getByRole('button', { name: 'Bộ lọc, 2 đang áp dụng' })).toBeTruthy();
  });

  it('an inline bar has no trigger and no panel — anchor n/a stays the healthy state, not a gap', () => {
    // Outside a measurable layout (jsdom lays nothing out) the engine's
    // no-measure safety keeps the strip inline: criteria are plain bar items,
    // there is nothing to anchor, and one copy of each criterion exists.
    const onReset = vi.fn();
    const { container } = render(
      <FilterBar
        fold={{
          criteria: <div data-testid="criterion">Khu vực</div>,
          count: 0,
          onReset,
          ariaLabel: 'Bộ lọc',
        }}
      />,
    );
    expect(screen.getByTestId('criterion').parentElement).toBe(
      container.querySelector('.filter-bar.list-filter-bar'),
    );
    expect(screen.queryByRole('button', { name: /^Bộ lọc/ })).toBeNull();
  });

  it('the fold opens on demand and resets exactly its own criteria', () => {
    const onReset = vi.fn();
    render(
      <FilterBar
        fold={{
          criteria: <div data-testid="criterion">Loại báo cáo</div>,
          count: 1,
          onReset,
          ariaLabel: 'Bộ lọc',
          neverInline: true,
        }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Bộ lọc, 1 đang áp dụng' }));
    const dialog = screen.getByRole('dialog');
    expect(screen.getByTestId('criterion')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Đặt lại' }));
    expect(onReset).toHaveBeenCalledTimes(1);
    expect(dialog).toBeTruthy();
  });
});

describe('the audit script keeps only styling drift', () => {
  it('no longer carries a two-row verdict or an exemption — that law is the band\'s', () => {
    expect(audit).not.toMatch(/twoRowViolation/);
    expect(audit).not.toMatch(/rowExempt\s*=/);
    expect(audit).not.toMatch(/EXPT/);
    // The rows it still records are INFORMATION, explicitly not a verdict.
    expect(audit).toMatch(/not a verdict/);
  });

  it('still judges what no structural guarantee covers: family caps, overflow, anchor geometry', () => {
    expect(audit).toMatch(/overflowCaps/);
    expect(audit).toMatch(/outsideBar/);
    expect(audit).toMatch(/pageOverflow/);
    expect(audit).toMatch(/const anchored = \(gapBelow >= -1 && gapBelow <= 8\) \|\| \(gapAbove >= -1 && gapAbove <= 8\);/);
  });

  it('still fails the run on a real hole — an unmeasured surface is never a pass', () => {
    expect(audit).toMatch(/process\.exitCode = flagged\.length \|\| unverified\.length \? 1 : 0;/);
    expect(audit).toMatch(/UNVERIFIED — these are NOT passes/);
    expect(audit).toMatch(/PREFLIGHT FAILED/);
  });
});
