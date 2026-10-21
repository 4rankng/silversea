import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

// Grid rows mount the plan editor, which pulls the task-tag pool — pin it so
// this suite stays provider-light (same pattern as DetailedPlanGrid.test.tsx).
vi.mock('./useDispatchTaskTags', () => ({
  useDispatchTaskTags: () => ({ tags: [], isLoading: false, error: null }),
  useCreateDispatchTaskTag: () => ({ createTag: vi.fn(), isCreating: false }),
}));

import { DetailedPlanGrid } from './DetailedPlanGrid';
import { EMPTY_DETAILED_PLAN_FILTERS } from './useDispatchDetailPlan';
import { MonthProvider } from '../../../hooks/useMonth';
import type { DispatchDetailPlanRow } from '../../../api/dispatchPlanningClient';

/**
 * Card 191026100010 (B.5) — /dispatch-detail typography contract, re-pinning
 * the landed card 20261005_361 (REQ-02): dispatchers scan the CONTAINER CODE
 * first, so it rides the cell's primary weight on one line, while the
 * Cảng nâng / Cảng hạ (Nâng hàng / Trả hàng) values dropped to the normal
 * supporting line — a port must never shout as loud as the cont number.
 * Both halves are asserted: the class the grid RENDERS and the CSS rule that
 * turns that class into weight.
 */
const row = (overrides: Partial<DispatchDetailPlanRow> = {}): DispatchDetailPlanRow => ({
  fulfillmentId: 201,
  version: 3,
  shipmentId: 21,
  shipmentVersion: 5,
  shipmentCode: 'SS-000205',
  fulfillmentType: 'FCL_CONTAINER',
  cargoMode: 'FCL',
  taskStatus: 'READY',
  time: { deliveryDate: '2026-08-20', runHour: 8 },
  customerRoute: { customerName: 'Công ty ABC', factoryName: 'Nhà máy XYZ', deliveryPoint: null, routeName: 'LH — Biên Hòa' },
  docs: { billNumber: 'BL-2026-B5', tradeDirection: 'EXPORT', declarationNumbers: [] },
  container: { containerNumber: 'MSCU7654321', containerTypeLabel: '40HC', cargoWeightKg: '21500.00' },
  notes: { vehicleNote: null, customerNote: null },
  dispatch: { carrierType: 'OWN', carrierName: 'SilverSea', externalCarrierId: null, externalCarrierVehicleId: null, assignedPlate: null },
  ports: {
    pickupPortId: 11, pickupPortName: 'Bãi lấy container A', pickupPortShortName: 'Bãi A',
    dropoffPortId: 12, dropoffPortName: 'Cảng hạ container B', dropoffPortShortName: 'Cảng B',
  },
  isCombined: false,
  estimates: { plannedRevenue: null, plannedCarrierCost: null },
  lotFullyPlated: false,
  ...overrides,
} as DispatchDetailPlanRow);

function renderGrid(items: DispatchDetailPlanRow[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <MonthProvider>
          <DetailedPlanGrid
            filters={EMPTY_DETAILED_PLAN_FILTERS}
            onFilterChange={vi.fn()}
            loadDeliveryPointFacets={vi.fn().mockResolvedValue([])}
            loadPickupPortFacets={vi.fn().mockResolvedValue([])}
            loadDropoffPortFacets={vi.fn().mockResolvedValue([])}
            items={items}
            loading={false}
            error={null}
            onRetry={vi.fn()}
            assignmentError={null}
            lotBanner={null}
            onClearLotBanner={vi.fn()}
            presence={null}
            zones={[]}
            sortKey={null}
            sortDirection="asc"
            onToggleSort={vi.fn()}
            onAtomicSave={vi.fn()}
            onOpenTripReassign={vi.fn()}
            onCompleteExternalTrip={vi.fn()}
            onIssueOrder={vi.fn()}
          />
        </MonthProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('DetailedPlanGrid — B.5 container/port weight (card 191026100010, REQ-02 of 20261005_361)', () => {
  it('renders the container number on the strong line carrying the shared identity class, and BOTH port columns without any strong line', () => {
    const { container } = renderGrid([row()]);

    const contCell = container.querySelector('[data-label="Container"]') as HTMLElement;
    const contLine = contCell.querySelector('.detailed-plan-grid__line') as HTMLElement;
    expect(contLine.classList.contains('detailed-plan-grid__line--strong')).toBe(true);
    expect(contLine.textContent).toContain('MSCU7654321');
    // DIS-08 (card 211026180428): the weight rides the SHARED ops class so
    // every dispatch table bolds its container lines from one rule.
    expect(contLine.classList.contains('ops-container-line')).toBe(true);

    for (const label of ['Nâng hàng', 'Trả hàng']) {
      const portCell = container.querySelector(`[data-label="${label}"]`) as HTMLElement;
      expect(portCell, `${label} cell must render`).toBeTruthy();
      const strongLines = portCell.querySelectorAll('.detailed-plan-grid__line--strong');
      expect(strongLines, `${label} must carry no bold/primary line`).toHaveLength(0);
    }
  });

  it('the CSS keeps the container line one-line (nowrap) with the weight carried by the shared ops class', () => {
    const css = readFileSync(
      resolve(process.cwd(), 'src/features/dispatch/detailed-plan/DetailedPlanGrid.css'),
      'utf8',
    );
    const opsCss = readFileSync(
      resolve(process.cwd(), 'src/styles/operational-table-typography.css'),
      'utf8',
    );

    const containerRule = css.match(/\.detailed-plan-grid__cell--container \.detailed-plan-grid__line--strong \{[^}]*\}/);
    expect(containerRule, 'the container strong rule must exist').toBeTruthy();
    expect(containerRule![0]).toContain('white-space: nowrap');
    // The page rule no longer pins a weight: the rendered `.ops-container-line`
    // class owns the container weight law (the base `--strong` rule keeps its
    // own weight declaration for the other strong lines of this grid).
    expect(containerRule![0]).not.toContain('font-weight');
    const opsRule = opsCss.match(/\.ops-container-line,\s*\.ops-table \.ops-container-line\s*\{([^}]*)\}/)?.[1];
    expect(opsRule, 'the shared container identity rule must exist').toBeTruthy();
    expect(opsRule).toContain('font-weight: var(--ops-table-primary-weight)');

    // No rule anywhere raises a port-cell line to a bold/primary weight: the
    // ports render the plain `.detailed-plan-grid__line` only.
    const portRules = css.match(/\.detailed-plan-grid__cell--ports[^{]*\{[^}]*font-weight[^}]*\}/g) ?? [];
    expect(portRules, `port rules must not set a weight: ${portRules.join(' | ')}`).toHaveLength(0);
  });
});
