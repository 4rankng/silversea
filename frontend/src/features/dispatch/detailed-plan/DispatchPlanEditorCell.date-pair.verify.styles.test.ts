import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Card 20260925_6 — site-wide pairing sweep verify-only check on the
 * dispatch assignment dialog (DispatchPlanEditorCell). The time pair
 * (Điều phối / Kết thúc) renders inside `.dispatch-assignment-dialog__issue-times`,
 * a 2-col internal grid. At desktop the two cells stay aligned; at
 * ≤640px the rule explicitly stacks them so the cell does not clip its
 * value.
 */

const css = readFileSync(resolve(process.cwd(), 'src/features/dispatch/detailed-plan/DispatchPlanEditorCell.css'), 'utf8');
const source = readFileSync(resolve(process.cwd(), 'src/features/dispatch/detailed-plan/DispatchPlanEditorCell.tsx'), 'utf8');

describe('DispatchPlanEditorCell pair regression guard (card 20260925_6 verify)', () => {
  it('the time pair is a 2-col grid container, not two independent flex items', () => {
    expect(css).toMatch(/\.dispatch-assignment-dialog__issue-times\s*\{[^}]*display:\s*grid;/);
    expect(css).toMatch(/\.dispatch-assignment-dialog__issue-times\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/);
  });

  it('the time pair stacks on phones — no value clipping', () => {
    expect(css).toMatch(/@media \(max-width:\s*640px\)\s*\{[\s\S]*?\.dispatch-assignment-dialog__issue-times\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);/);
  });

  it('no panel / shadow chrome on the time pair shell', () => {
    const block = css.match(/\.dispatch-assignment-dialog__issue-times\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(block).not.toMatch(/box-shadow/);
    // We allow border (the dialog is its own panel; the time pair rides
    // the dialog surface, no second chrome layer).
    expect(block).not.toMatch(/border-radius/);
  });
});
