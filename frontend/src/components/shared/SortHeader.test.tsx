// SIL-1213 (audit 2026-11-27) — the shared sort control on /shipments-detail:
// the ⇅ icon used to be a SIBLING of the label span, so it was a flex item of
// the button on its own. A label that wraps to two lines ("Khách hàng & lộ
// trình", "Thông số container") then pushed the ⇅ onto a third line: the icon
// orphaned below the title and the header grew to twice the height of a
// one-line header. The icon now lives INSIDE the label span — a flex item of
// the label — so it rides the label's first line and the control's height is
// the label's height. This test pins that DOM contract; the CSS half lives in
// styles/table-sort.styles.test.ts.
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SortHeader } from './SortHeader';
import type { TableSortState } from '../../lib/table-sort';

const renderHeader = (sort: TableSortState | null = null) =>
  render(
    <table>
      <thead>
        <tr>
          <SortHeader
            label="Khách hàng & lộ trình"
            sortKey="customerName"
            sort={sort}
            onSortChange={vi.fn()}
          />
        </tr>
      </thead>
    </table>,
  );

describe('SortHeader', () => {
  it('renders the sort icon INSIDE the label span, never beside it', () => {
    const { container } = renderHeader();
    const label = container.querySelector('.table-sort-button__label');
    expect(label).toBeTruthy();
    // The icon is the label's flex item → it can never land on a line of its own.
    expect(label!.querySelector('svg')).toBeTruthy();
    expect(container.querySelector('.table-sort-button > svg')).toBeNull();
  });

  it('keeps the label text and the accessible sort state', () => {
    const { container } = renderHeader();
    expect(container.querySelector('.table-sort-button__label')!.textContent)
      .toContain('Khách hàng & lộ trình');
    expect(container.querySelector('th')!.getAttribute('aria-sort')).toBe('none');
  });

  it('marks the sorted column ascending / descending', () => {
    const asc = renderHeader({ by: 'customerName', dir: 'asc' });
    expect(asc.container.querySelector('th')!.getAttribute('aria-sort')).toBe('ascending');
    const desc = renderHeader({ by: 'customerName', dir: 'desc' });
    expect(desc.container.querySelector('th')!.getAttribute('aria-sort')).toBe('descending');
  });
});
