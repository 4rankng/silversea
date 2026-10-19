import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

import { DetailedPlanFilters } from './DetailedPlanFilters';
import {
  createDefaultDetailedPlanFilters,
  detailPlanQuery,
  EMPTY_DETAILED_PLAN_FILTERS,
} from './detailPlanFilters';
import { MonthProvider } from '../../../hooks/useMonth';

/**
 * Card 171026154000 — the Loại hàng (cargoMode) scope. Before the fix the
 * filter field did not exist: hàng lẻ lots hid on pages 2–3 behind FCL
 * pagination and the operator read the board as "LCL cannot be
 * group-assigned" (FB-115's report).
 *
 * The page keeps its filters in component state (no URL sync — same as every
 * other detail-plan criterion, including assignmentStatus); the query param
 * this filter drives is the API request's, built by `detailPlanQuery` and
 * passed through `listDispatchDetailPlanRows` unchanged. Both layers are
 * pinned here.
 */

const TEST_ZONES = [{ code: 'LACH_HUYEN', label: 'Lạch Huyện' }];

function renderFilters(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <MonthProvider>{ui}</MonthProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

/** Common props so each test lists only what it varies. */
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

function openFilterDialog() {
  fireEvent.click(screen.getByRole('button', { name: /^Bộ lọc/ }));
  return screen.getByRole('dialog', { name: 'Bộ lọc kế hoạch' });
}

describe('DetailedPlanFilters — Loại hàng scope (card 171026154000)', () => {
  it('rides the quick-filters group beside Điều xe and defaults to Tất cả', () => {
    renderFilters(<DetailedPlanFilters {...baseProps()} />);
    const dialog = openFilterDialog();
    expect(withinDialog(dialog, 'Điều xe: Tất cả')).toBeTruthy();
    expect(withinDialog(dialog, 'Loại hàng: Tất cả')).toBeTruthy();
  });

  it('picking a mode emits the cargoMode patch; Tất cả clears it back to the unfiltered scope', () => {
    const onChange = vi.fn();
    const { rerender } = renderFilters(<DetailedPlanFilters {...baseProps(onChange)} />);
    openFilterDialog();

    fireEvent.click(screen.getByRole('button', { name: 'Loại hàng: Tất cả' }));
    fireEvent.click(screen.getByRole('option', { name: 'Hàng lẻ (LCL)' }));
    expect(onChange).toHaveBeenCalledWith({ cargoMode: 'LCL' });

    // The parent applies the patch — the trigger now shows the active mode.
    rerender(
      <MemoryRouter>
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <MonthProvider>
            <DetailedPlanFilters {...baseProps(onChange)} filters={{ ...EMPTY_DETAILED_PLAN_FILTERS, cargoMode: 'LCL' }} />
          </MonthProvider>
        </QueryClientProvider>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Loại hàng: Hàng lẻ (LCL)' }));
    fireEvent.click(screen.getByRole('option', { name: 'Tất cả' }));
    expect(onChange).toHaveBeenCalledWith({ cargoMode: '' });
  });

  it('a set mode reaches the API request query and the default omits it', () => {
    // The request param layer — what `listDispatchDetailPlanRows` turns into
    // `?cargoMode=LCL` on /dispatch-detail-plan-rows.
    expect(detailPlanQuery({ ...createDefaultDetailedPlanFilters(), cargoMode: 'LCL' }, ''))
      .toEqual(expect.objectContaining({ cargoMode: 'LCL' }));
    expect(detailPlanQuery({ ...createDefaultDetailedPlanFilters(), cargoMode: 'FCL' }, ''))
      .toEqual(expect.objectContaining({ cargoMode: 'FCL' }));
    expect(detailPlanQuery(createDefaultDetailedPlanFilters(), '').cargoMode).toBeUndefined();
  });

  it('Xóa lọc resets an active mode back to the default (unfiltered) state', () => {
    const onChange = vi.fn();
    const { rerender } = renderFilters(
      <DetailedPlanFilters {...baseProps(onChange)} filters={{ ...EMPTY_DETAILED_PLAN_FILTERS, cargoMode: 'LCL' }} />,
    );
    // The active mode is one applied criterion — the reset must be enabled.
    const clear = screen.getByRole('button', { name: 'Xóa lọc' });
    expect(clear).toBeEnabled();
    fireEvent.click(clear);
    expect(onChange).toHaveBeenCalledWith(EMPTY_DETAILED_PLAN_FILTERS);
    expect(EMPTY_DETAILED_PLAN_FILTERS.cargoMode).toBe('');
    // And the reset state produces no cargoMode request param.
    expect(detailPlanQuery(EMPTY_DETAILED_PLAN_FILTERS, '').cargoMode).toBeUndefined();

    rerender(
      <MemoryRouter>
        <QueryClientProvider client={new QueryClient()}>
          <MonthProvider>
            <DetailedPlanFilters {...baseProps()} filters={{ ...EMPTY_DETAILED_PLAN_FILTERS }} />
          </MonthProvider>
        </QueryClientProvider>
      </MemoryRouter>,
    );
    expect(screen.getByRole('button', { name: 'Xóa lọc' })).toHaveAttribute('aria-disabled', 'true');
  });
});

function withinDialog(dialog: HTMLElement, name: string) {
  return within(dialog).queryByRole('button', { name });
}
