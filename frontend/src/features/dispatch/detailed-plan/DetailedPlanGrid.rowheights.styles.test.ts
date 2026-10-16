// Ticket 141026001010 (Muse round-17 sweep): /dispatch-detail row heights went
// uneven again. Root cause: card 091026091550's one-line-header rebalance cut
// the Điều phối column from 12% to 7.5% (~85px at the 1129px table), so every
// plate·driver pair and the status/action row wrapped onto extra lines —
// assigned rows towered at 164-198px beside 97px unassigned rows, regressing
// the R22 compact-row contract (case QA-2026-10-03-R22).
//
// This styles contract pins the rebalance law the live measurement produced
// (1041px worst-case canvas, sort-button chrome included):
//   - the assignment column holds its pre-regression 12% share;
//   - every donor column stays above its measured one-line label floor
//     (schedule 16.62%, route 17.2%, notes 5.84%);
//   - the shares still sum to exactly 100 so no column collapses.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(process.cwd(), 'src/features/dispatch/detailed-plan/DetailedPlanGrid.css'), 'utf8');
// The assignment cell's inner layout lives with its editor component.
const editorCss = readFileSync(resolve(process.cwd(), 'src/features/dispatch/detailed-plan/DispatchPlanEditorCell.css'), 'utf8');

function columnWidth(name: string): number {
  const match = css.match(new RegExp(`\\.detailed-plan-grid__col--${name}\\s*\\{\\s*width:\\s*(\\d+(?:\\.\\d+)?)%;\\s*\\}`));
  expect(match, `${name} column must own an explicit percentage width`).toBeTruthy();
  return Number(match?.[1] ?? 0);
}

describe('DetailedPlanGrid row-height column contract (ticket 141026001010)', () => {
  it('keeps the assignment column at its pre-regression 12% so its pairs do not stack', () => {
    // 7.5% measured 85px at the live 1129px table: the plate·driver pair and
    // the action row each wrapped to two lines, inflating assigned rows to
    // 164-198px beside 97px unassigned rows.
    expect(columnWidth('assignment')).toBe(12);
  });

  it('keeps every rebalanced donor above its measured one-line header floor', () => {
    // Floors measured on the live 1041px worst-case canvas (1440 viewport,
    // expanded sidebar), sort-button chrome included: schedule 16.62%, route
    // 17.2%, notes 5.84%. A donor under its floor re-wraps the header and
    // re-opens the 091026091550 defect this rebalance must not trade back.
    expect(columnWidth('schedule')).toBeGreaterThanOrEqual(16.62);
    expect(columnWidth('route')).toBeGreaterThanOrEqual(17.2);
    expect(columnWidth('notes')).toBeGreaterThanOrEqual(5.84);
  });

  it('keeps the fixed colgroup complete — the shares sum to exactly 100', () => {
    const names = ['schedule', 'route', 'ports', 'documents', 'container', 'assignment', 'classification', 'notes'];
    // The ports class covers both port columns (two <col> elements share it).
    const total = names.reduce((sum, name) => sum + columnWidth(name), 0) + columnWidth('ports');
    expect(total).toBe(100);
  });

  it('keeps the vehicle facts one-line capable — the pair rides an inline run inside the wrap group', () => {
    // The compact-row budget depends on the pair being able to share one
    // line when the column is wide enough: the plate/driver spans must stay
    // inline inside the vehicle group (stacking display:block spans forces
    // two rows at ANY width — the pre-R22 shape). The base rule keeps wrap
    // for the card bands; FB-043's desktop band pins the pair to one line
    // outright (nowrap + the cell's own ellipsis law).
    const groupRules = editorCss.match(/\.dispatch-assignment-cell__vehicle-group\s*\{([\s\S]*?)\n\}/g) ?? [];
    const base = groupRules.find((rule) => rule.includes('flex-wrap: wrap'));
    expect(base, 'card/base vehicle group keeps flex-wrap: wrap').toBeTruthy();
    const desktopBand = editorCss.match(/@container\s*\(min-width:\s*901px\)\s*\{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(desktopBand).toMatch(/\.dispatch-assignment-cell__vehicle-group\s*\{[^}]*flex-wrap:\s*nowrap;/);
    const pairRule = editorCss.match(/\.dispatch-assignment-cell__vehicle-group \.dispatch-assignment-cell__plate,\n\.dispatch-assignment-cell__vehicle-group \.dispatch-assignment-cell__driver\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
    expect(pairRule).toContain('display: inline');
  });
});

// ── FB-043 (2026-10-14): the uniform row-height contract ────────────────────
// The colgroup pins above stay (they decide WHAT ellipsizes), but the system
// fix is structural: the component bounds the row itself, so column
// starvation can no longer produce uneven rows. These pins guard the
// contract that ends the regression class.
describe('DetailedPlanGrid uniform row-height contract (FB-043)', () => {
  it('bounds every cell body to one fixed height that clips', () => {
    expect(css).toMatch(/--dpg-row-h:\s*84px;/);
    const bodyRule = css.match(/@container\s*\(min-width:\s*901px\)\s*\{[\s\S]*?\.detailed-plan-grid__cell-body\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(bodyRule).toContain('height: var(--dpg-row-h)');
    expect(bodyRule).toContain('overflow: hidden');
  });

  it('renders every value line as one ellipsized line inside the table band', () => {
    const band = css.match(/@container\s*\(min-width:\s*901px\)\s*\{([\s\S]*?)(?=\n\/\*|\n@container|$)/)?.[1] ?? '';
    const lineRule = band.match(/\.detailed-plan-grid__line,\n\s*\.detailed-plan-grid \.ops-schedule__datetime\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(lineRule).toContain('white-space: nowrap');
    expect(lineRule).toContain('text-overflow: ellipsis');
    expect(lineRule).toContain('overflow: hidden');
  });

  it('keeps the row action clickable — the note stack flexes, the actions never clip', () => {
    const band = css.match(/@container\s*\(min-width:\s*901px\)\s*\{([\s\S]*?)(?=\n\/\*|\n@container|$)/)?.[1] ?? '';
    expect(band).toMatch(/\.detailed-plan-grid__note-stack\s*\{[^}]*min-height:\s*0;/);
    expect(band).toMatch(/\.detailed-plan-grid__note-actions\s*\{[^}]*flex:\s*0 0 auto;/);
  });

  it('draws cell padding from the spacing scale, not raw pixels', () => {
    expect(css).toMatch(/\.detailed-plan-grid td\s*\{[^}]*padding:\s*var\(--space-sm\) var\(--space-sm\);/);
  });

  it('joins the assignment cell to the contract with its own full-row budget', () => {
    const band = editorCss.match(/@container\s*\(min-width:\s*901px\)\s*\{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(band).toMatch(/\.dispatch-assignment-cell\s*\{[^}]*height:\s*calc\(var\(--dpg-row-h\) \+ \(var\(--space-sm\) \* 2\)\);/);
    expect(band).toMatch(/\.dispatch-assignment-cell__plate,[\s\S]*?\.dispatch-assignment-cell__driver,[\s\S]*?\{[\s\S]*?text-overflow:\s*ellipsis;/);
  });

  it('scopes the assignment-cell band above the base rules it must beat', () => {
    // FB-043 re-report (card 141026001010): the desktop band declared
    // nowrap/ellipsis on bare class names — (0,1,0), exactly equal to the
    // card-band base rules later in the file. Later source order won, so the
    // band was dead code and the value lines wrapped and hard-clipped. The
    // row height stayed correct (the parent clips at a fixed height), which
    // is exactly why every pre-existing pin stayed green through the
    // regression. Assert the band actually outranks what it overrides.
    const band = editorCss.match(/@container\s*\(min-width:\s*901px\)\s*\{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(band).toMatch(/\.dispatch-assignment-cell \.dispatch-assignment-cell__plate,/);
    expect(band).toMatch(/\.dispatch-assignment-cell \.dispatch-assignment-cell__vehicle-group\s*\{[^}]*flex-wrap:\s*nowrap;/);
    // Guard the regression directly: a bare-name selector in the band is the
    // defect, so fail if one comes back.
    expect(band).not.toMatch(/^\s*\.dispatch-assignment-cell__plate,/m);
    expect(band).not.toMatch(/^\s*\.dispatch-assignment-cell__vehicle-group\s*\{/m);
  });

  it('mounts the cell body from the component — every column renders through it', () => {
    const tsx = readFileSync(resolve(process.cwd(), 'src/features/dispatch/detailed-plan/DetailedPlanGrid.tsx'), 'utf8');
    // One cell-body per data column: schedule, route, both ports, documents,
    // container, classification, notes (the editable cell joins via its own
    // component's budget rule instead of a wrapper).
    const bodies = tsx.match(/detailed-plan-grid__cell-body/g) ?? [];
    expect(bodies.length).toBeGreaterThanOrEqual(8);
  });
});
