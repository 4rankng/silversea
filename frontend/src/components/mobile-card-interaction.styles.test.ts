import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const readCss = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('mobile record interaction contract', () => {
  it('limits record hover washes to fine pointers and keeps touch cards neutral', () => {
    const dataTable = readCss('src/design-system/DataTable.css');
    const panel = readCss('src/components/Panel.css');
    const tripCards = readCss('src/pages/trip-list/mobile-cards.css');
    const dispatchDetail = readCss('src/features/dispatch/detailed-plan/DetailedPlanGrid.css');
    const legacyCards = readCss('src/styles/utilities.css');

    for (const css of [dataTable, panel, tripCards, dispatchDetail]) {
      expect(css).toContain('@media (hover: hover) and (pointer: fine)');
    }
    expect(legacyCards).not.toContain('.m-card:active { background: var(--surface-2); }');
    expect(legacyCards).toContain('-webkit-tap-highlight-color: transparent');
  });
});
