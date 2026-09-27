import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Case QA-2026-09-27-02 / card 20260927_2 — the dispatch master-plan date
 * filter is now a single `DateRangePopover` trigger (one picker for Từ +
 * Đến) replacing the previous two `BufferedUuiDateInput` controls. The
 * 3-track "1fr | separator | 1fr" grid pattern from card 20260925_6 is
 * retired; the new contract is one BEM slot owned by a component that
 * ships its own popover and trigger sizing.
 */

const css = readFileSync(resolve(process.cwd(), 'src/features/dispatch/master-plan/MasterPlanGrid.css'), 'utf8');

describe('MasterPlanGrid date-range regression guard (case QA-2026-09-27-02)', () => {
  it('the dispatch date filter renders as a single DateRangePopover slot', () => {
    // BEM slot still exists so the drawer layout grid places the new
    // popover trigger at the same rhythm as other filter fields.
    expect(css).toMatch(/\.master-plan-filters__date-range\s*\{/);
    const block = css.match(/\.master-plan-filters__date-range\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(block).toContain('display: block');
    // The retired 3-track input grid and the side-by-side field/label
    // cell are gone — there is exactly ONE date control, not two.
    expect(css).not.toMatch(/\.master-plan-filters__date-inputs\s*\{/);
    expect(css).not.toMatch(/\.master-plan-filters__date-input\s*\{/);
    expect(css).not.toMatch(/\.master-plan-filters__date-sep\s*\{/);
  });

  it('the slot rides the surface — no shadow / no background on the cell', () => {
    const block = css.match(/\.master-plan-filters__date-range\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(block).not.toMatch(/box-shadow/);
    expect(block).not.toMatch(/background/);
  });
});
