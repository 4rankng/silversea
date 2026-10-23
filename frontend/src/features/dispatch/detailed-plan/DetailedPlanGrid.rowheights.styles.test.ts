// Owner redesign 23/10 (grid Điều vận Chi tiết, screenshots "UI shitty"):
// the old colgroup-share contract (091026091550 rebalance + FB-043 fixed
// row-height pins) is REPLACED. The new law, per the owner spec:
//   - the table owns a horizontal rail: fixed layout + a min-width floor, so
//     every column keeps its measured one-line budget at ANY canvas;
//   - the two formerly-fat columns (Thời gian 17% / Khách hàng 17.5%) shrank
//     to content budgets — they were the "~230px row, 70% trống" defect;
//   - rows size to their clamped content (~64-88px): the FB-043 fixed-height
//     clip (--dpg-row-h) is GONE — it buried row actions under the note clamp;
//   - headers wrap at spaces up to TWO lines (line-clamp-2), never nowrap,
//     never a "…" cut;
//   - the SĐT line is one nowrap ellipsized line (the "0984/9634/84" per-
//     character shatter is the defect this pins out);
//   - actions live in ONE sticky-right column — no inline red buttons.
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
    const names = ['schedule', 'route', 'ports', 'documents', 'container', 'assignment', 'classification', 'notes', 'actions'];
    const shares = names.map((name) => columnShare(name));
    // The ports class covers both port columns (two <col> elements share it).
    const total = shares.reduce((sum, share) => sum + share, 0) + columnShare('ports');
    expect(total).toBe(100);
    const width = (name: string) => columnShare(name) * TABLE_MIN_WIDTH / 100;
    expect(width('route')).toBeGreaterThanOrEqual(180);
    expect(width('assignment')).toBeGreaterThanOrEqual(200);
    expect(width('notes')).toBeGreaterThanOrEqual(160);
    // Nâng/Trả each fit one short port name; the actions rail fits the menu.
    expect(width('ports')).toBeGreaterThanOrEqual(110);
    expect(width('actions')).toBeGreaterThanOrEqual(70);
    // The formerly-fat columns came back to content budgets (owner spec
    // addendum: "cột phình thu lại vừa nội dung").
    expect(columnShare('schedule')).toBeLessThanOrEqual(10.5);
    expect(columnShare('route')).toBeLessThanOrEqual(14);
  });

  it('sizes rows to clamped content — the FB-043 fixed-height clip is gone', () => {
    expect(css).not.toContain('--dpg-row-h');
    expect(css).not.toMatch(/\.detailed-plan-grid__cell-body\s*\{[^}]*height:/);
    // Every value line still ellipsizes on ONE line (tooltip carries the
    // full value) — the row can never re-inflate through a wrapped line.
    expect(css).toMatch(/\.detailed-plan-grid__line,\s*\n\s*\.detailed-plan-grid \.ops-schedule__datetime\s*\{[^}]*white-space:\s*nowrap;[^}]*text-overflow:\s*ellipsis;/);
    // The note stack keeps its 3-line clamp and no longer hosts actions.
    expect(css).toMatch(/\.detailed-plan-grid__note-stack\s*\{[\s\S]*?min-height:\s*0;/);
    expect(css).not.toContain('.detailed-plan-grid__note-actions');
  });

  it('pins the Thao tác column sticky-right — one action rail, no inline sprawl', () => {
    expect(css).toMatch(/th\.detailed-plan-grid__th--actions,\s*\n\s*\.detailed-plan-grid td\.detailed-plan-grid__cell--actions\s*\{[^}]*position:\s*sticky;[^}]*right:\s*0;/);
    expect(css).toMatch(/td\.detailed-plan-grid__cell--actions\s*\{[^}]*background:\s*var\(--surface\);/);
    // The inline destructive button treatment is deleted: Xóa lô lives in
    // the ⋯ menu (danger voice), never as a red inline pill again.
    expect(css).not.toContain('.detailed-plan-grid__note-action--delete');
  });

  it('keeps the SĐT line one token run — never wraps per character', () => {
    const phoneRule = editorCss.match(/\.dispatch-assignment-cell__driver-phone\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(phoneRule).not.toContain('overflow-wrap: anywhere');
    const band = editorCss.match(/\.dispatch-assignment-cell \.dispatch-assignment-cell__carrier,[\s\S]*?\{([^}]*)\}/)?.[1] ?? '';
    expect(band).toContain('white-space: nowrap');
    expect(band).toContain('text-overflow: ellipsis');
    expect(band).toContain('word-break: keep-all');
  });

  it('renders every table column through the shared cell body (component pin)', () => {
    const tsx = readFileSync(resolve(process.cwd(), 'src/features/dispatch/detailed-plan/DetailedPlanGrid.tsx'), 'utf8');
    const bodies = tsx.match(/detailed-plan-grid__cell-body/g) ?? [];
    expect(bodies.length).toBeGreaterThanOrEqual(8);
  });
});
