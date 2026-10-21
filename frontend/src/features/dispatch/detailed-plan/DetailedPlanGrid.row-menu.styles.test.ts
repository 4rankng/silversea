import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * DIS-09 (card 211026130015) — the row menu's open list must survive the
 * grid's overflow:hidden cell band (`.detailed-plan-grid__cell-body`): the
 * list portals to body with FIXED viewport coordinates. An absolutely
 * positioned list inside the cell gets clipped and the action goes invisible
 * again — the exact defect class this card fixes.
 */
const css = readFileSync(resolve(process.cwd(), 'src/features/dispatch/detailed-plan/DetailedPlanGrid.css'), 'utf8');
const component = readFileSync(resolve(process.cwd(), 'src/features/dispatch/detailed-plan/DispatchRowActionsMenu.tsx'), 'utf8');

describe('DIS-09 row menu placement contract', () => {
  it('the open list never positions absolutely inside the clipping cell band', () => {
    const menuBlock = css.match(/\.dispatch-row-menu__list\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(menuBlock).not.toContain('position: absolute');
    expect(menuBlock).not.toContain('position:absolute');
  });

  it('the component portals the list to body with fixed coordinates', () => {
    expect(component).toContain('createPortal');
    expect(component).toContain("position: 'fixed'");
    expect(component).toContain('useDropdownDismiss');
  });
});
