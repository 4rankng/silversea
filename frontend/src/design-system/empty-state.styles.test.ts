import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Card _41 — single-source empty-state contract:
 * the design-system primitive is the ONLY empty-state chrome; the retired
 * .empty-state panel and its infinite float animation stay dead, and the
 * reduced-motion guard is part of the primitive's contract.
 */
const uiCss = readFileSync(resolve(process.cwd(), 'src/components/UI.css'), 'utf8');
const dsCss = readFileSync(resolve(process.cwd(), 'src/design-system/EmptyState.css'), 'utf8');

describe('empty-state consolidation (card _41)', () => {
  it('keeps the retired .empty-state chrome and its ttFloat animation dead', () => {
    expect(uiCss).not.toContain('.empty-state {');
    expect(uiCss).not.toContain('ttFloat');
    expect(uiCss).not.toContain('.empty-state:hover');
  });

  it('keeps the reduced-motion guard on the design-system primitive', () => {
    expect(dsCss).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*?animation:\s*none !important;/);
    // No primitive face may define an infinite animation the guard has to
    // chase — motion is opt-in per property, never infinite loops.
    expect(dsCss).not.toMatch(/infinite/);
  });

  it('leaves no import path to the deleted shared EmptyState', () => {
    const src = resolve(process.cwd(), 'src');
    expect(readFileSync(resolve(src, 'pages/driver/DriverPayslipsPage.tsx'), 'utf8')).not.toContain('shared/EmptyState');
    expect(readFileSync(resolve(src, 'design-system/EmptyState.tsx'), 'utf8')).toContain('ds-empty-state');
  });
});
