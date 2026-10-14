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
    // two rows at ANY width — the pre-R22 shape).
    const groupRule = editorCss.match(/\.dispatch-assignment-cell__vehicle-group\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
    expect(groupRule).toContain('flex-wrap: wrap');
    const pairRule = editorCss.match(/\.dispatch-assignment-cell__vehicle-group \.dispatch-assignment-cell__plate,\n\.dispatch-assignment-cell__vehicle-group \.dispatch-assignment-cell__driver\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
    expect(pairRule).toContain('display: inline');
  });
});
