// SIL-1192 — the SỐ TỜ KHAI inline editor must stay INSIDE its own column.
//
// Audit 27/11 (staging a8f059c0, /dispatch-detail, 1440px): clicking the
// "Chưa có tờ khai" cell opened a 189px input inside a 166px SỐ TỜ KHAI
// track — it spilled past the track and covered the ĐIỀU PHỐI column's
// plate / driver / status while the operator typed. The editor floats
// through a body portal (SIL-631), so the panel's width is its own content:
// the cap has to live on the editor BAND (the panel's only child), and the
// floating host's font floor (52ch / 16ch — wider than this track) must not
// win over it.
//
// The geometry is derived, not guessed: the board's percentage base is the
// table floor minus its fixed rails, the SỐ TỜ KHAI track is 10% of that
// base, and the panel opens at the cell's content edge (the track's left +
// the cell padding) with 26px of chrome (12+12 padding, 1+1 border).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (file: string) => readFileSync(resolve(process.cwd(), file), 'utf8');
const css = read('src/features/dispatch/detailed-plan/DetailedPlanGrid.css');
const tokens = read('src/styles/tokens.css');
const floatingCss = read('src/components/FloatingCellEditor.css');

/** The floating host's horizontal chrome: 12+12 padding + 1+1 border. */
const PANEL_CHROME = 26;

describe('SIL-1192 — the SỐ TỜ KHAI editor stays inside its own column', () => {
  it('the declaration editor band is capped to the track', () => {
    const band = css.match(/\.detailed-plan-grid__decl-editor--declaration\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(band, 'the capped band rule must exist').not.toBe('');
    expect(band).toMatch(/max-width:\s*124px/);
  });

  it('the floating host font floor does not size this panel — the band owns it', () => {
    const panel = css.match(/\.floating-cell-editor:has\(> \.detailed-plan-grid__decl-editor--declaration\)\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(panel, 'the panel floor override must exist').not.toBe('');
    expect(panel).toMatch(/min-width:\s*0/);
    // The shared host keeps its own floor for every other editor.
    expect(floatingCss).toMatch(/var\(--fce-value-ch, 52ch\)/);
  });

  it('the cap is scoped to THIS editor — the Container column keeps the shared band', () => {
    // A bare `.detailed-plan-grid__decl-editor` cap would shrink the
    // Container column's own editor (DispatchContainerNumberCell) too.
    const bareCap = css.match(/(^|\n)\.detailed-plan-grid__decl-editor\s*\{([^}]*)\}/)?.[2] ?? '';
    expect(bareCap).not.toMatch(/max-width/);
  });

  it('the cap fits the track: the panel edge lands inside the SỐ TỜ KHAI column', () => {
    const floor = Number(css.match(/\.detailed-plan-grid\s*\{[^}]*min-width:\s*(\d+)px/)?.[1] ?? 0);
    const selectableFloor = Number(css.match(/\.detailed-plan-grid--selectable\s*\{[^}]*min-width:\s*(\d+)px/)?.[1] ?? 0);
    const actionRail = Number(css.match(/\.detailed-plan-grid__col--actions\s*\{[^}]*width:\s*(\d+)px/)?.[1] ?? 0);
    const selectRail = Number(css.match(/\.detailed-plan-grid__col--select\s*\{[^}]*width:\s*(\d+)px/)?.[1] ?? 0);
    const trackShare = Number(css.match(/\.detailed-plan-grid__col--declaration\s*\{[^}]*width:\s*([\d.]+)%/)?.[1] ?? 0) / 100;
    const cellPadding = Number(tokens.match(/--space-sm:\s*(\d+)px/)?.[1] ?? 0);
    const band = Number(css.match(/\.detailed-plan-grid__decl-editor--declaration\s*\{[^}]*max-width:\s*(\d+)px/)?.[1] ?? 0);

    expect(floor, 'the board floor must exist').toBeGreaterThan(0);
    expect(selectableFloor, 'the selectable board floor must exist').toBeGreaterThan(0);
    expect(actionRail).toBe(48);
    expect(trackShare).toBeGreaterThan(0);
    expect(band).toBeGreaterThan(0);

    // Normal mode (the THAO TÁC rail only) and selectable mode (the CHỌN
    // rail rides along) share the same percentage base — both are checked.
    const bases = [floor - actionRail, selectableFloor - actionRail - selectRail];
    for (const base of bases) {
      const track = base * trackShare;
      // The panel opens at the cell's content edge → its right edge must stay
      // inside the track, or it covers the next column's facts.
      expect(cellPadding + band + PANEL_CHROME).toBeLessThanOrEqual(track);
    }
  });
});
