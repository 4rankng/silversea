import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(process.cwd(), 'src/pages/ShipmentsPage.css'), 'utf8');

describe('SIL-646 (id 751) — shipments table row height and overflow laws', () => {
  it('enforces border-box sizing across all table elements so borders and padding do not blow out dimensions', () => {
    expect(css).toMatch(
      /\.cus-dashboard-table,\s*\.cus-dashboard-table \*,\s*\.cus-dashboard-table \*::before,\s*\.cus-dashboard-table \*::after\s*\{[\s\S]*?box-sizing:\s*border-box;/,
    );
  });

  it('enforces cell trigger padding alignment with table cells (padding: 6px 10px)', () => {
    const triggerRule = css.match(
      /\.cus-dashboard-cell--editable > \.cus-inline-trigger\s*\{([^}]*)\}/,
    )?.[1] ?? '';
    expect(triggerRule, 'trigger rule exists').not.toBe('');
    expect(triggerRule).toMatch(/min-height:\s*100%;/);
    expect(triggerRule).toMatch(/height:\s*100%;/);
    expect(triggerRule).toMatch(/padding:\s*6px 10px;/);
  });

  it('allows status cell actions to expand row height rather than sticking out below row edge', () => {
    const statusActions = css.match(
      /\.cus-dashboard-table \.cus-row-actions\s*\{([^}]*)\}/,
    )?.[1] ?? '';
    expect(statusActions, 'desktop status actions rule exists').not.toBe('');
    expect(statusActions).toMatch(/min-height:\s*100%;/);
    expect(statusActions).toMatch(/height:\s*auto;/);
    expect(statusActions).not.toMatch(/(?:^|[;\s])height:\s*100%\s*;/);
  });

  it('enforces NO TRUNCATE on status cell signal and prevents horizontal overflow', () => {
    const signalRule = css.match(
      /\.cus-dashboard-table \.cus-row-actions__signal\s*\{([^}]*)\}/,
    )?.[1] ?? '';
    expect(signalRule, 'status signal rule exists').not.toBe('');
    expect(signalRule).toMatch(/white-space:\s*normal;/);
    expect(signalRule).toMatch(/overflow-wrap:\s*anywhere;/);
    expect(signalRule).toMatch(/word-break:\s*break-word;/);
    expect(signalRule).not.toMatch(/white-space:\s*nowrap;/);
    expect(signalRule).not.toMatch(/text-overflow:\s*ellipsis;/);

    // td[data-label='Trạng thái'] handles overflow containment
    const tdStatus = css.match(
      /\.cus-dashboard-table td\[data-label=['"]Trạng thái['"]\]\s*\{([^}]*)\}/,
    )?.[1] ?? '';
    expect(tdStatus, 'td status rule exists').not.toBe('');
    expect(tdStatus).toMatch(/min-width:\s*0;/);
    expect(tdStatus).toMatch(/overflow-wrap:\s*anywhere;/);
  });
});
