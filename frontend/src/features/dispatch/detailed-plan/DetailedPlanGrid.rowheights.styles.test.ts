// SIL-515 (owner 26/10 — "CẤM truncate TOÀN BẢNG"): the column-floor +
// wrap contract of the grid Điều vận Chi tiết. The 23/10 one-line/ellipsis
// law is REVOKED: the table keeps its horizontal rail (fixed layout +
// min-width floor + the wrapper's overflow rail) but every VALUE cell now
// WRAPS its full text — ellipsis, clipping overflow and -webkit-line-clamp
// are banned table-wide, and a nowrap line in a fixed-layout column is the
// exact mechanism that painted "Ngày giao 23/10/2026" over the next
// column. SIL-686 (06/11, FB-063) revokes the wrap allowance for HEADERS:
// a header is ALWAYS one line, paid by the SIL-686 share rebalance; value
// cells keep wrapping. Actions live in ONE sticky-right column.
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

describe('DetailedPlanGrid column-floor + compact-row contract (owner redesign 23/10 / SIL-755)', () => {
  it('gives the table a responsive layout that shrinks within its container at 1440px', () => {
    expect(css).toMatch(/\.detailed-plan-grid\s*\{[^}]*width:\s*100%;/);
    expect(css).toMatch(/\.detailed-plan-grid\s*\{[^}]*max-width:\s*100%;/);
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

  it('keeps balanced column shares summing to 100% for 1440px viewport', () => {
    const names = ['schedule', 'route', 'ports', 'documents', 'container', 'declaration', 'assignment', 'classification', 'notes', 'actions'];
    const shares = names.map((name) => columnShare(name));
    // The ports class covers both port columns (two <col> elements share it).
    const total = shares.reduce((sum, share) => sum + share, 0) + columnShare('ports');
    expect(total).toBe(100);
    expect(columnShare('route')).toBeGreaterThanOrEqual(10);
    expect(columnShare('assignment')).toBeGreaterThanOrEqual(14);
    // SIL-795: the floors the shares must still pay at the 1420px table
    // floor — notes keeps its wrap budget, schedule PAYS its one-line
    // header (the ≤12.5 cap of the 1440-no-scroll era is retired: the rail
    // scrolls on purpose now, so the cap can no longer be paid honestly).
    expect(columnShare('notes')).toBeGreaterThanOrEqual(9);
    expect(columnShare('actions')).toBeGreaterThanOrEqual(6.5);
    expect(columnShare('schedule')).toBeGreaterThanOrEqual(12); // 192px >= the 180px one-line header floor at the 1600 rail
    expect(columnShare('route')).toBeGreaterThanOrEqual(11.5); // 184px >= the 175px header floor
    expect(css).toMatch(/\.detailed-plan-grid\s*\{[^}]*min-width:\s*1600px;/); // SIL-795 measured floors: documents 118px, declaration 128px, container 101px
  });

  it('SIL-686 (FB-063): every header is ONE line — the th carries the nowrap', () => {
    const thRule = css.match(/\.detailed-plan-grid thead th \{([^}]*)\}/)?.[1] ?? '';
    expect(thRule, 'the header rule must exist').not.toBe('');
    expect(thRule).toContain('white-space: nowrap');
    expect(thRule).not.toContain('white-space: normal');
    // An oversized single token overflows visibly instead of chopping
    // mid-token (the shared table-sort.css law).
    expect(thRule).toContain('overflow-wrap: normal');
    expect(thRule).toContain('word-break: normal');
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

  it('SIL-589: the LCL group tag is TEXT-ONLY (no pill) and the Phân loại column holds its header on one line', () => {
    // The old emerald pill (border-radius: 999px + fill + border) wrapped its
    // label vertically ("Lẻ ·"/"Ghép"/"(1/2)") and overflowed the column —
    // §1 text-only law: a VALUE renders as plain text.
    const tag = css.match(/\.detailed-plan-grid__lcl-group-tag\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(tag, 'the group tag rule must exist').not.toBe('');
    expect(tag).not.toContain('border-radius: 999px');
    expect(tag).not.toMatch(/background:\s*var\(--app-accent-emerald-soft/);
    expect(tag).not.toMatch(/border:\s*1px/);
    // The duplicated "Lẻ" prefix is gone from the copy (TSX pin lives with
    // the grid tests); the cell keeps ONE "Lẻ" (the classification span).
    expect(css).not.toContain("'Lẻ · Ghép (");
    expect(css).not.toContain('"Lẻ · Ghép (');
    // 6.5% ≈ 92px at the 1420px floor — "PHÂN LOẠI" fits one line (SIL-795
    // rebalance; the measured one-line label is 85px, the SIL-686 6% share
    // could not pay it once the pane's 1144px floor proved too narrow).
    expect(columnShare('classification')).toBe(6.5);
    // The 0.5% came off notes, keeping the sum at exactly 100.
    const names = ['schedule', 'route', 'ports', 'documents', 'container', 'declaration', 'assignment', 'classification', 'notes', 'actions'];
    const total = names.map((name) => columnShare(name)).reduce((sum, share) => sum + share, 0) + columnShare('ports');
    expect(total).toBe(100);
  });

  it('pins the Thao tác column sticky-right — one action rail, no inline sprawl', () => {
    expect(css).toMatch(/th\.detailed-plan-grid__th--actions,\s*\n\s*\.detailed-plan-grid td\.detailed-plan-grid__cell--actions\s*\{[^}]*position:\s*sticky;[^}]*right:\s*0;/);
    expect(css).toMatch(/td\.detailed-plan-grid__cell--actions\s*\{[^}]*background:\s*var\(--surface\);/);
    // SIL-588 (owner 27/10): the rail STACKS its buttons vertically — the
    // compact primary on top, the ⋯ trigger below — so a narrow 4% column
    // can host both without wrapping sideways into the neighbour (no
    // overlap). The old one-line flex wrap is gone with the pill.
    const rail = css.match(/\.detailed-plan-grid__row-actions\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(rail, 'the row-actions rule must exist').not.toBe('');
    expect(rail).toContain('flex-direction: column');
    expect(rail).not.toContain('flex-wrap');
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

  it('SIL-755 (round 2): actions column fits THAO TÁC header and vertically stacked actions in 74-88px width', () => {
    const actionCellRule = css.match(/\.detailed-plan-grid th\.detailed-plan-grid__th--actions,\s*\n\s*\.detailed-plan-grid td\.detailed-plan-grid__cell--actions\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(actionCellRule).toContain('width: 78px');
    expect(actionCellRule).toContain('min-width: 74px');
    expect(actionCellRule).toContain('max-width: 88px');
    expect(actionCellRule).toContain('white-space: nowrap');

    const stackRule = css.match(/\.detailed-plan-grid__row-actions\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(stackRule).toContain('flex-direction: column');
    expect(stackRule).toContain('align-items: center');
  });

  it('SIL-756: container number and declaration number do not wrap mid-string (white-space: nowrap + overflow-wrap: normal)', () => {
    // Container serial numbers are single-token ISO identifiers (e.g. QACU2000507)
    expect(css).toMatch(/\.detailed-plan-grid__cell--container \.ops-container-line\s*\{[^}]*white-space:\s*nowrap/);
    expect(css).toMatch(/\.detailed-plan-grid__cell--container \.ops-container-line\s*\{[^}]*overflow-wrap:\s*normal/);

    // Declaration numbers are also single-token codes (e.g. TK1108R002)
    expect(css).toMatch(/\.detailed-plan-grid__decl-value\s*\{[^}]*white-space:\s*nowrap/);
    expect(css).toMatch(/\.detailed-plan-grid__decl-value\s*\{[^}]*overflow-wrap:\s*normal/);
  });
});
