import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(process.cwd(), 'src/pages/ShipmentsPage.css'), 'utf8');

describe('SIL-633 (id 737) — shipments card typography and component size contract', () => {
  it('enforces shared record-table card eyebrow typography on card cell triggers', () => {
    const triggerBefore = css.match(
      /\.cus-dashboard-table \.cus-inline-trigger::before\s*\{([^}]*)\}/,
    )?.[1] ?? '';

    expect(triggerBefore, 'card trigger eyebrow rule exists').not.toBe('');
    expect(triggerBefore).toContain('font-size: var(--text-label-size)');
    expect(triggerBefore).toContain('font-weight: var(--fw-bold)');
    expect(triggerBefore).toContain('letter-spacing: 0.04em');
    expect(triggerBefore).toContain('text-transform: uppercase');
    expect(triggerBefore).toContain('line-height: var(--ops-table-header-line-height, 1.35)');
    expect(triggerBefore, 'literal 1.3 line box shaves uppercase Vietnamese ink').not.toMatch(/line-height:\s*1\.3\s*;/);
  });

  it('leaves detail button geometry to shared UUI sm button laws without page-owned height or font overrides', () => {
    const detailBlocks = [...css.matchAll(/\.cus-dashboard-detail\s*\{([^}]*)\}/g)].map((m) => m[1]);
    expect(detailBlocks.length, 'paint rules exist for detail button').toBeGreaterThan(0);
    for (const block of detailBlocks) {
      expect(block, `page must not own control geometry/typography: ${block}`).not.toMatch(
        /(?:^|[;\s])(?:height|min-height|font(?:-size)?|line-height)\s*:/,
      );
    }
  });

  it('enforces uniform mobile touch height across all card cell triggers including empty notes', () => {
    const triggerRule = css.match(
      /@media \(max-width:\s*999px\)\s*\{[\s\S]*?\.cus-dashboard-table \.cus-inline-trigger\s*\{([^}]*)\}/,
    )?.[1] ?? '';
    expect(triggerRule, 'card trigger rule exists').not.toBe('');
    expect(triggerRule).toMatch(/min-height:\s*var\(--control-touch-h,\s*40px\);/);

    const emptyNotesRule = css.match(
      /\.cus-dashboard-table \.cus-dashboard-cell--empty-notes \.cus-inline-trigger\s*\{([^}]*)\}/,
    )?.[1] ?? '';
    expect(emptyNotesRule, 'empty notes trigger rule exists').not.toBe('');
    expect(emptyNotesRule).toMatch(/min-height:\s*var\(--control-touch-h,\s*40px\);/);
    expect(emptyNotesRule, 'must not shrink empty notes below touch floor').not.toMatch(/min-height:\s*32px;/);
  });

  it('aligns card status cell horizontal padding with trigger padding for consistent card edge', () => {
    const lastCellRule = css.match(
      /\.cus-dashboard-table tbody > tr > td:last-child\s*\{([^}]*)\}/,
    )?.[1] ?? '';
    expect(lastCellRule, 'last-child cell rule exists').not.toBe('');
    expect(lastCellRule).toMatch(/padding:\s*5px 10px;/);
  });
});
