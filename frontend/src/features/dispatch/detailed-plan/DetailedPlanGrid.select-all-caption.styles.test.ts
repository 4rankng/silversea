import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(process.cwd(), 'src/features/dispatch/detailed-plan/DetailedPlanGrid.css'), 'utf8');

describe('SIL-909 — bulk select-all header caption in the 48px rail', () => {
  it('stacks the header so the PHÁT LỆNH caption wraps at the word boundary (never clipped mid-word)', () => {
    // The old one-line row (checkbox + nowrap caption) clipped 'PHÁT LỆNH'
    // to 'PHÁT LỆ' — 68px of text in a 48px column.
    expect(css).toMatch(/\.detailed-plan-grid__select-all\s*\{[^}]*flex-direction:\s*column;/);
    expect(css).not.toMatch(/\.detailed-plan-grid__select-all\s*\{[^}]*white-space:\s*nowrap;/);
  });

  it('keeps the select rail a fixed 48px so the reading columns keep their pinned one-line shares', () => {
    // Widening the column would tax the percentage shares (SIL-795 history).
    expect(css).toMatch(/\.detailed-plan-grid__col--select\s*\{\s*width:\s*48px;\s*\}/);
  });

  it('r2: the select th re-enables wrapping so the caption cannot inherit the thead one-line law', () => {
    // r2 root cause: `.detailed-plan-grid thead th { white-space: nowrap }`
    // (FB-063/SIL-686) cascades INTO the caption span — r1 only un-nowrap'd
    // the flex stack, so 'PHÁT LỆNH' stayed one 66.9px line and the 48px
    // rail clipped it to 'HÁT LỆN' (pane edge left, next th's opaque
    // background right). The wrap switch must sit on a selector that
    // outranks the law (the compound `th.` form — bare class loses), carry
    // the SIL-515 pressure valve, and keep the 40px content box so the two
    // caption words (31.7px) wrap at the space without a mid-word break.
    expect(css).toMatch(/\.detailed-plan-grid\s+th\.detailed-plan-grid__th--select\s*\{[^}]*white-space:\s*normal;/);
    expect(css).toMatch(/\.detailed-plan-grid\s+th\.detailed-plan-grid__th--select\s*\{[^}]*overflow-wrap:\s*anywhere;/);
    expect(css).toMatch(/\.detailed-plan-grid\s+th\.detailed-plan-grid__th--select\s*\{[^}]*padding-inline:\s*4px;/);
    // The bare-class form must not come back — its declarations lose the
    // cascade to the thead law and the caption would clip again.
    expect(css).not.toMatch(/^\s*\.detailed-plan-grid__th--select\s*\{/m);
  });
});
