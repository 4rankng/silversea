/**
 * SIL-1108 (mobile 390px/360px — /dispatch-detail): [Phát lệnh hàng loạt] went
 * missing on phones because DetailedPlanGrid withheld the band controls in
 * card mode (`!isCardMode ? bulkIssueMode : undefined`), so the button text
 * occurred 0 times in the page and the 'Phát lệnh đã chọn (N)' bar could
 * never appear. The commit that ungated the band (band controls ride BOTH
 * layouts; the card list drives the per-card tick) is pinned here:
 *   - the band renders its toggle and the counted release bar whenever the
 *     page wires the mode (behavioral, at the filters strip);
 *   - the grid must NOT gate the band props behind isCardMode and MUST
 *     forward the bulk selection to the phone card list (source contract —
 *     jsdom renders the table branch, so only a source scan can catch the
 *     card-mode gate coming back).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { DetailedPlanFilters } from './DetailedPlanFilters';
import { EMPTY_DETAILED_PLAN_FILTERS } from './useDispatchDetailPlan';
import { MonthProvider } from '../../../hooks/useMonth';

const TEST_ZONES = [{ code: 'LACH_HUYEN', label: 'Lạch Huyện' }];

function renderFilters(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={['/dispatch-detail']}>
      <QueryClientProvider client={client}>
        <MonthProvider>
          {ui}
        </MonthProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

function baseProps(onChange = vi.fn()) {
  return {
    filters: { ...EMPTY_DETAILED_PLAN_FILTERS },
    onChange,
    loadDeliveryPointFacets: vi.fn().mockResolvedValue([]),
    loadPickupPortFacets: vi.fn().mockResolvedValue([]),
    loadDropoffPortFacets: vi.fn().mockResolvedValue([]),
    zones: TEST_ZONES,
  };
}

describe('SIL-1108 — the bulk-release band rides the mobile card mode too', () => {
  it('renders [Phát lệnh hàng loạt] and the counted bar when the mode is wired', () => {
    const onToggleBulkIssueMode = vi.fn();
    renderFilters(
      <DetailedPlanFilters
        {...baseProps()}
        bulkIssueMode
        onToggleBulkIssueMode={onToggleBulkIssueMode}
        bulkIssueCount={2}
        onBulkIssueSelected={vi.fn()}
      />,
    );

    const toggle = screen.getByRole('button', { name: 'Phát lệnh hàng loạt' });
    expect(toggle).toBeTruthy();
    // The bar names the exact pick count — the law QA retested on the phone.
    const bar = screen.getByRole('button', { name: 'Phát lệnh đã chọn (2)' });
    expect(bar).toBeTruthy();

    fireEvent.click(toggle);
    expect(onToggleBulkIssueMode).toHaveBeenCalledTimes(1);
  });

  it('keeps the band reachable without a count (mode ON, nothing picked yet)', () => {
    renderFilters(
      <DetailedPlanFilters
        {...baseProps()}
        bulkIssueMode
        onToggleBulkIssueMode={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: 'Phát lệnh hàng loạt' })).toBeTruthy();
    expect(screen.queryByText(/Phát lệnh đã chọn/)).toBeNull();
  });

  it('source contract — the grid never gates the band behind card mode and wires the card ticks', () => {
    const source = readFileSync(
      path.join(import.meta.dirname, 'DetailedPlanGrid.tsx'),
      'utf8',
    );
    // The exact regression QA caught: `!isCardMode ? bulkIssueMode : undefined`
    // hides the whole mode from phones. Neither band prop may be gated.
    expect(source).not.toMatch(/isCardMode\s*\?\s*bulkIssueMode/);
    expect(source).not.toMatch(/isCardMode\s*\?\s*onToggleBulkIssueMode/);
    // The phone card list receives the bulk selection (per-card ticks).
    expect(source).toContain('onToggleBulkSelection={onToggleBulkSelection}');
    expect(source).toContain('selectedBulkFulfillmentIds={selectedBulkFulfillmentIds}');
  });
});
