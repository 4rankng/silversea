// QA 28/11 layout targets — /dispatch-detail row-density contract.
// Staging measured the first data row 42% down the 768px viewport with
// 90–92px rows (fewer than 5 visible); the target is ≥6 complete populated
// rows. The budget is paid by dead air only: td/assignment-cell vertical
// padding 4px → 3px, fact lines flush (gap 0), the note stack at 1px, and
// the status chip sharing the SĐT line — every existing text line still
// renders (SIL-515 no-truncation law untouched). Populated-row budget:
//   24 (carrier tap floor) + 1 (cell gap) + 13.8 (plate 12px×1.15)
//   + 12.65 (driver 11px×1.15) + 13.8 (phone/chip line) + 6 (padding)
//   + 1 (border) ≈ 72px — down from 90–92.
// The watchlist banner above the grid defaults to a ONE-LINE compact
// summary (count + worst severity) with the full list behind the expand
// toggle, so its rows stop stealing a plan row by default.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const gridCss = readFileSync(resolve(process.cwd(), 'src/features/dispatch/detailed-plan/DetailedPlanGrid.css'), 'utf8');
const editorCss = readFileSync(resolve(process.cwd(), 'src/features/dispatch/detailed-plan/DispatchPlanEditorCell.css'), 'utf8');
const editorTsx = readFileSync(resolve(process.cwd(), 'src/features/dispatch/detailed-plan/DispatchPlanEditorCell.tsx'), 'utf8');
const bannerTsx = readFileSync(resolve(process.cwd(), 'src/features/dispatch/StuckTripsBanner.tsx'), 'utf8');
const bannerCss = readFileSync(resolve(process.cwd(), 'src/features/dispatch/StuckTripsBanner.css'), 'utf8');

function ruleBody(css: string, selector: RegExp): string {
  return css.match(selector)?.[1] ?? '';
}

describe('DetailedPlanGrid row-density budget (QA 28/11 layout targets)', () => {
  it('the grid td pays a 3px vertical beat — the row budget has no spare dead air', () => {
    const tdRule = ruleBody(gridCss, /\.detailed-plan-grid td \{([^}]*)\}/);
    expect(tdRule, 'the td rule must exist').not.toBe('');
    expect(tdRule).toContain('padding: 3px var(--space-sm);');
    expect(tdRule).not.toMatch(/height:\s*\d/);
  });

  it('the note stack rides the 1px dense rhythm — no line hidden', () => {
    const notesBody = ruleBody(gridCss, /\.detailed-plan-grid__cell-body--notes\s*\{([^}]*)\}/);
    expect(notesBody).toContain('gap: 1px;');
    const noteEntry = ruleBody(gridCss, /\.detailed-plan-grid__note-entry\s*\{([^}]*)\}/);
    expect(noteEntry).toContain('gap: 1px;');
    // The clamp stays the standing 2-line law (existing, not a new cut).
    expect(gridCss).toMatch(/\.detailed-plan-grid__note-preview\s*\{[^}]*-webkit-line-clamp:\s*2/);
  });

  it('the assignment cell compacts: 3px padding, flush fact lines, no chip row', () => {
    const cellRule = ruleBody(editorCss, /\.dispatch-assignment-cell \{([^}]*)\}/);
    expect(cellRule, 'the assignment cell rule must exist').not.toBe('');
    expect(cellRule).toContain('padding: 3px 8px;');
    expect(cellRule).toContain('gap: 1px;');

    const groupRule = ruleBody(editorCss, /\.dispatch-assignment-cell__vehicle-group\s*\{([^}]*)\}/);
    expect(groupRule).toContain('display: grid');
    expect(groupRule).toContain('gap: 0;');
    expect(groupRule).toContain('min-width: 0');

    const actionsRule = ruleBody(editorCss, /\.dispatch-assignment-cell__actions\s*\{([^}]*)\}/);
    expect(actionsRule).toContain('margin-top: 0;');
  });

  it('the status chip shares the SĐT line in a wrapping phone-row (no cut)', () => {
    const phoneRow = ruleBody(editorCss, /\.dispatch-assignment-cell__phone-row\s*\{([^}]*)\}/);
    expect(phoneRow, 'the phone-row rule must exist').not.toBe('');
    expect(phoneRow).toContain('display: flex');
    // The chip wraps BELOW the phone when the column is tight — never
    // ellipsized, never clipped into the neighbouring cell.
    expect(phoneRow).toContain('flex-wrap: wrap');
    expect(phoneRow).toContain('min-width: 0');
    expect(phoneRow).not.toContain('nowrap');
    expect(phoneRow).not.toContain('overflow: hidden');

    // The markup: the chip rides inside the phone-row, the wrapper renders
    // whenever a phone or a non-UNASSIGNED status exists (UNASSIGNED renders
    // no chip — the carrier line already says the state), and the actions
    // div mounts only when it has content.
    expect(editorTsx).toContain('className="dispatch-assignment-cell__phone-row"');
    expect(editorTsx).toMatch(/assignedDriverPhone \|\| issueStatus !== 'UNASSIGNED'/);
    const phoneRowIdx = editorTsx.indexOf('dispatch-assignment-cell__phone-row');
    const chipIdx = editorTsx.indexOf('<DispatchIssueStatusChip status={issueStatus} />');
    const actionsIdx = editorTsx.indexOf('dispatch-assignment-cell__actions');
    expect(phoneRowIdx).toBeGreaterThan(-1);
    expect(chipIdx, 'chip renders inside the phone-row').toBeGreaterThan(phoneRowIdx);
    expect(chipIdx).toBeLessThan(actionsIdx);
    expect(editorTsx).toMatch(/\{\(row\.lotFullyPlated && !currentPlate\) && \(\s*\n\s*<div className="dispatch-assignment-cell__actions">/);
  });

  it('the watchlist banner defaults to a one-line compact summary — count visible, rows behind the toggle', () => {
    // Collapsed default.
    expect(bannerTsx).toMatch(/useState\(false\)/);
    // The list renders ONLY when expanded; the collapsed default renders no
    // rows and no overflow line.
    expect(bannerTsx).toMatch(/const items = expanded \? data\.items : \[\];/);
    expect(bannerTsx).toMatch(/\{expanded && \(\s*\n\s*<ul className="stuck-trips-banner__list">/);
    expect(bannerTsx).not.toContain('COLLAPSED_ROW_CAP');
    expect(bannerTsx).not.toContain("stuck-trips-banner__row--more");
    // The count stays visible in the head, and the worst severity rides it.
    expect(bannerTsx).toContain('({data.items.length})');
    expect(bannerTsx).toContain('stuck-trips-banner__worst');
    expect(bannerTsx).toMatch(/activeHandoff == null \|\| trip\.activeHandoff\.handlerId == null/);
    // The expand affordance keeps its state contract.
    expect(bannerTsx).toContain("'Thu gọn danh sách chuyến kẹt' : 'Mở rộng danh sách chuyến kẹt'");
    expect(bannerTsx).toMatch(/aria-expanded=\{expanded\}/);
    // The severity half is tokened warning text — no pill (§1 law).
    const worstRule = ruleBody(bannerCss, /\.stuck-trips-banner__worst\s*\{([^}]*)\}/);
    expect(worstRule, 'the worst-severity rule must exist').not.toBe('');
    expect(worstRule).toContain('var(--warning-text');
    expect(worstRule).not.toMatch(/border-radius/);
  });
});
