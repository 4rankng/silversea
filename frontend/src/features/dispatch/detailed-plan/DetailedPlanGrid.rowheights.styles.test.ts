// SIL-515 (owner 26/10 — "CẤM truncate TOÀN BẢNG"): the column-floor +
// wrap contract of the grid Điều vận Chi tiết. The 23/10 one-line/ellipsis
// law is REVOKED: the table keeps its horizontal rail (fixed layout +
// min-width floor + the wrapper's overflow rail) but every cell now WRAPS
// its full text — ellipsis, clipping overflow and -webkit-line-clamp are
// banned table-wide, and a nowrap line in a fixed-layout column is the
// exact mechanism that painted "Ngày giao 23/10/2026" over the next
// column. Headers wrap at spaces without a clamp; actions live in ONE
// sticky-right column.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(process.cwd(), 'src/features/dispatch/detailed-plan/DetailedPlanGrid.css'), 'utf8');
// The assignment cell's inner layout lives with its editor component.
const editorCss = readFileSync(resolve(process.cwd(), 'src/features/dispatch/detailed-plan/DispatchPlanEditorCell.css'), 'utf8');

function columnShare(name: string): number {
  const match = css.match(new RegExp(`\\.detailed-plan-grid__col--${name}\\s*\\{\\s*width:\\s*(\\d+(?:\\.\\d+)?)%;\\s*\\}`));
  expect(match, `${name} column must own an explicit percentage width`).toBeTruthy();
  return Number(match?.[1] ?? 0);
}

const TABLE_MIN_WIDTH = 1340;

describe('DetailedPlanGrid column-floor + compact-row contract (owner redesign 23/10)', () => {
  it('gives the table a min-width floor so every column keeps its one-line budget', () => {
    expect(css).toMatch(/\.detailed-plan-grid\s*\{[^}]*min-width:\s*1340px;/);
    // Master-plan lane fix (same defect class, MP-RD-03 probe): the wrapper
    // is a BOUNDED PANE owning both scrolls — `overflow: auto` + the dvh
    // bound. The old `overflow-x: auto / overflow-y: clip` pair computed to
    // `auto hidden`, and a scroll-container wrapper silently killed the
    // thead's sticky reference (the header rode off-screen with the page);
    // the thead now pins to the pane's own top edge.
    expect(css).toMatch(/\.detailed-plan-grid__wrapper\s*\{[^}]*overflow:\s*auto;/);
    expect(css).toMatch(/\.detailed-plan-grid__wrapper\s*\{[^}]*max-height:\s*calc\(100dvh/);
    expect(css).toMatch(/\.detailed-plan-grid thead th \{[\s\S]*?position:\s*sticky;[\s\S]*?top:\s*0;/);
  });

  it('keeps the owner floors at the table minimum: Khách hàng ≥180px, Điều phối ≥200px, Ghi chú ≥160px', () => {
    // SIL-524 (owner 27/10): the Thao tác rail left the percentage shares —
    // it is a fixed 46px rail (one button wide), so the shares cover the
    // DATA columns only and must still sum to exactly 100.
    const names = ['schedule', 'route', 'ports', 'documents', 'container', 'assignment', 'classification', 'notes'];
    const shares = names.map((name) => columnShare(name));
    // The ports class covers both port columns (two <col> elements share it).
    const total = shares.reduce((sum, share) => sum + share, 0) + columnShare('ports');
    expect(total).toBe(100);
    const width = (name: string) => columnShare(name) * TABLE_MIN_WIDTH / 100;
    expect(width('route')).toBeGreaterThanOrEqual(180);
    expect(width('assignment')).toBeGreaterThanOrEqual(200);
    expect(width('notes')).toBeGreaterThanOrEqual(160);
    expect(width('ports')).toBeGreaterThanOrEqual(110);
    // The actions rail is ONE button wide: trigger 30px + the td's 8px
    // side paddings = 46px (SIL-524; the freed 10.75% share went back to
    // the data columns above — the old SIL-519 pill+trigger 10.75%
    // budget is gone with the inline pill).
    const actionsPx = css.match(/\.detailed-plan-grid__col--actions\s*\{[^}]*width:\s*(\d+(?:\.\d+)?)px/)?.[1];
    expect(actionsPx, 'the actions col must own a fixed px width').toBeTruthy();
    expect(Number(actionsPx)).toBeGreaterThanOrEqual(44);
    expect(Number(actionsPx)).toBeLessThanOrEqual(48);
    // The formerly-fat columns came back to content budgets (owner spec
    // addendum: "cột phình thu lại vừa nội dung").
    expect(columnShare('schedule')).toBeLessThanOrEqual(10.5);
    expect(columnShare('route')).toBeLessThanOrEqual(14);
  });

  it('sizes rows to wrapped content — the FB-043 fixed-height clip is gone and no line truncates (SIL-515)', () => {
    expect(css).not.toContain('--dpg-row-h');
    expect(css).not.toMatch(/\.detailed-plan-grid__cell-body\s*\{[^}]*height:/);
    // SIL-515: every value line WRAPS its full text — the old nowrap +
    // ellipsis law painted "Ngày giao 23/10/2026" over the next column
    // (a nowrap line refuses to shrink below its one-line width) and cut
    // the long port name after "NORIGHTFREIG…". The wrap pair is pinned.
    const lineRule = css.match(/\.detailed-plan-grid__line,\s*\n\s*\.detailed-plan-grid \.ops-schedule__datetime\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(lineRule, 'the value-line rule must exist').not.toBe('');
    expect(lineRule).toContain('white-space: normal');
    expect(lineRule).toContain('overflow-wrap: anywhere');
    expect(lineRule).not.toContain('nowrap');
    expect(lineRule).not.toContain('ellipsis');
    expect(lineRule).not.toContain('overflow: hidden');
    // The note renders in FULL: the 3-line clamp (a truncation) is gone
    // with its class; the note-preview class carries no clip.
    expect(css).not.toContain('-webkit-line-clamp');
    expect(css).not.toContain('detailed-plan-grid__note-clamp');
    expect(css).toMatch(/\.detailed-plan-grid__note-preview\s*\{[^}]*\}/);
    // The note stack no longer hosts actions.
    expect(css).toMatch(/\.detailed-plan-grid__note-stack\s*\{[\s\S]*?min-height:\s*0;/);
    expect(css).not.toContain('.detailed-plan-grid__note-actions');
  });

  it('pins the Thao tác column sticky-right — one vertical action stack, no inline sprawl', () => {
    expect(css).toMatch(/th\.detailed-plan-grid__th--actions,\s*\n\s*\.detailed-plan-grid td\.detailed-plan-grid__cell--actions\s*\{[^}]*position:\s*sticky;[^}]*right:\s*0;/);
    expect(css).toMatch(/td\.detailed-plan-grid__cell--actions\s*\{[^}]*background:\s*var\(--surface\);/);
    // SIL-524 (owner 27/10): the actions stack VERTICALLY — the send
    // icon on top, ⋯ under it — centered in the one-button rail, so a
    // not-yet-sent row keeps the same centered ⋯ slot (no layout jump
    // when send appears) and nothing paints over the neighbouring cell.
    const rail = css.match(/\.detailed-plan-grid__row-actions\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(rail, 'the row-actions rule must exist').not.toBe('');
    expect(rail).toContain('flex-direction: column');
    expect(rail).toContain('align-items: center');
    expect(rail).toMatch(/gap:\s*[456]px/);
    // The inline destructive button treatment is deleted: Xóa lô lives in
    // the ⋯ menu (danger voice), never as a red inline pill again.
    expect(css).not.toContain('.detailed-plan-grid__note-action--delete');
  });

  it('wraps the Điều phối facts — the carrier band never truncates (SIL-515)', () => {
    // Declarations are what compute; comments may narrate the banned past.
    const stripComments = (cssText: string) => cssText.replace(/\/\*[\s\S]*?\*\//g, '');
    const phoneRule = stripComments(editorCss.match(/\.dispatch-assignment-cell__driver-phone\s*\{([^}]*)\}/)?.[1] ?? '');
    expect(phoneRule, 'the SĐT rule must exist').not.toBe('');
    expect(phoneRule).not.toContain('nowrap');
    expect(phoneRule).not.toContain('ellipsis');
    const band = editorCss.match(/\.dispatch-assignment-cell \.dispatch-assignment-cell__carrier,[\s\S]*?\{([^}]*)\}/)?.[1] ?? '';
    // SIL-515: the whole fact band wraps — no ellipsis cut, no hidden
    // overflow; overflow-wrap: anywhere only engages for a token genuinely
    // wider than the ≥200px column (normal phone numbers stay one run).
    expect(band).toContain('white-space: normal');
    expect(band).toContain('overflow-wrap: anywhere');
    expect(band).not.toContain('white-space: nowrap');
    expect(band).not.toContain('text-overflow: ellipsis');
    expect(band).not.toContain('overflow: hidden');
    // SIL-517 (owner 26/10): one fact per line — the group is a single-column
    // grid (plate / driver / SĐT each on its own line under the carrier); no
    // `·` separator may come back (a separator only exists to pack facts onto
    // one line) and no nowrap pin (SIL-515 law).
    const group = editorCss.match(/\.dispatch-assignment-cell__vehicle-group\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(group, 'the vehicle-group rule must exist').not.toBe('');
    expect(group).toContain('display: grid');
    expect(group).toContain('min-width: 0');
    expect(group).not.toContain('nowrap');
    // No `·` separator pseudo-content anywhere in the sheet — a separator
    // only exists to pack facts onto one line (SIL-517).
    expect(editorCss).not.toMatch(/content:\s*'·'/);
  });

  it('renders every table column through the shared cell body (component pin)', () => {
    const tsx = readFileSync(resolve(process.cwd(), 'src/features/dispatch/detailed-plan/DetailedPlanGrid.tsx'), 'utf8');
    const bodies = tsx.match(/detailed-plan-grid__cell-body/g) ?? [];
    expect(bodies.length).toBeGreaterThanOrEqual(8);
  });
});
