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
});
