import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const masterCss = readFileSync(resolve(process.cwd(), 'src/features/dispatch/master-plan/MasterPlanGrid.css'), 'utf8');
const detailedCss = readFileSync(resolve(process.cwd(), 'src/features/dispatch/detailed-plan/DetailedPlanGrid.css'), 'utf8');

/**
 * Card 20261003_315 — PM report: "fix bug when I hover mouse the row has jumping color very irritating"
 *
 * Contract:
 * 1. ONE uniform, stable hover background for the entire row across all cells.
 * 2. Cells paint the hover tint directly so the global Table.css wash and cell boundaries never create a two-tone jump.
 * 3. Background transition is disabled on row & cells so moving between cells doesn't re-trigger transitions or flicker.
 * 4. No per-cell or allocation trigger hover backgrounds break the row into different tones.
 */
describe('dispatch grids row hover stability (card 20261003_315)', () => {
  describe('MasterPlanGrid', () => {
    it('paints uniform cell hover background across all cells', () => {
      expect(masterCss).toContain('.master-plan-grid tbody > .master-plan-grid__row:hover > .master-plan-grid__cell');
      expect(masterCss).toMatch(
        /\.master-plan-grid tbody > \.master-plan-grid__row:hover > \.master-plan-grid__cell\s*\{\s*background:\s*color-mix\(in srgb, var\(--fg-1\) 2%, var\(--surface\)\);/
      );
    });

    it('disables background transition on row and cells to eliminate hover retrigger flicker', () => {
      const block = masterCss.match(/\.master-plan-grid__row,\s*\.master-plan-grid__cell\s*\{[^}]*\}/)?.[0];
      expect(block).toBeTruthy();
      expect(block).toContain('transition: none !important;');
    });

    it('does not paint accent hover background on cell--action or allocation trigger', () => {
      expect(masterCss).not.toContain('.master-plan-grid__cell--action:hover');
      const allocTrigger = masterCss.match(/\.master-plan-grid__allocation-trigger:hover\s*\{[^}]*\}/)?.[0];
      expect(allocTrigger).toBeTruthy();
      expect(allocTrigger).toContain('background: transparent;');
    });
  });

  describe('DetailedPlanGrid', () => {
    it('paints uniform cell hover background across all cells', () => {
      expect(detailedCss).toContain('.detailed-plan-grid tbody > .detailed-plan-grid__row:hover > .detailed-plan-grid__cell');
      expect(detailedCss).toMatch(
        /\.detailed-plan-grid tbody > \.detailed-plan-grid__row:hover > \.detailed-plan-grid__cell\s*\{\s*background:\s*color-mix\(in srgb, var\(--fg-1\) 2%, var\(--surface\)\);/
      );
    });

    it('disables background transition on row and cells to eliminate hover retrigger flicker', () => {
      const block = detailedCss.match(/\.detailed-plan-grid__row,\s*\.detailed-plan-grid__cell\s*\{[^}]*\}/)?.[0];
      expect(block).toBeTruthy();
      expect(block).toContain('transition: none !important;');
    });
  });
});
