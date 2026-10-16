import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getBootstrap, listOperationalSites } = vi.hoisted(() => ({ getBootstrap: vi.fn(), listOperationalSites: vi.fn() }));
vi.mock('../../../api/tripClient', () => ({ tripClient: { getBootstrap } }));
vi.mock('../../../api/shipmentClient', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../api/shipmentClient')>(),
  listOperationalSites,
}));

import { ToastProvider } from '../../../components/shared/Toast';
import { ShipmentCreateWorkspace } from './ShipmentCreateWorkspace';

/**
 * FB-048 (card 141026003600) — "bấm Tạo lô hàng với các trường bắt buộc để
 * trống: KHÔNG có viền đỏ ở Khách hàng, Hình thức XNK, Số Bill/Booking, Loại
 * container. Chỉ ô ngày/giờ nhập dở mới có viền đỏ."
 *
 * The cause was ordering, not paint: `save()` ran a native-constraint pre-gate
 * first and returned, so a partially-typed date/time field (which sets
 * customValidity on its segments) stopped the app-owned validation pass from
 * EVER running — `issueByField` stayed empty and no other required field had
 * anything to paint. The component-level danger-paint pins
 * (`form-control-boundaries.test.ts`) could not see it: they render a field in
 * isolation, never a submit.
 *
 * These cases drive the real submit.
 */
function renderWorkspace() {
  return render(
    <MemoryRouter initialEntries={['/shipments/new']}>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ToastProvider>
          <ShipmentCreateWorkspace />
        </ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

/** The house danger paint: the control boundary carries an invalid signal —
 *  `aria-invalid` (native inputs, combobox) or `data-invalid` (the UUI select
 *  trigger) — and the global QA-AUDIT-UI57 rule turns that into the red
 *  border. Checking the paint at REST is the whole point: a field that only
 *  reddens on focus/open is what the card reported. */
function isPaintedRed(fieldId: string): boolean {
  const field = document.querySelector(`[data-field-id="${fieldId}"]`);
  return field?.querySelector('[aria-invalid="true"], [data-invalid="true"]') != null;
}

async function submitEmptyForm() {
  fireEvent.click(await screen.findByRole('button', { name: 'Tạo lô hàng' }));
  await screen.findByText(/Cần bổ sung/);
}

/** The first container row's Loại container cell — its `data-field-id` carries
 *  the generated row key, so match the suffix the validator uses. */
function containerTypeIsPaintedRed(): boolean {
  const cell = [...document.querySelectorAll('[data-field-id$="-type"]')][0];
  return cell?.querySelector('[aria-invalid="true"], [data-invalid="true"]') != null;
}

describe('create-lot submit paints every invalid required field (FB-048, card 141026003600)', { timeout: 20000 }, () => {
  beforeEach(() => {
    getBootstrap.mockReset();
    getBootstrap.mockResolvedValue({
      customers: [{ id: 1, name: 'KH A' }],
      routes: [{ id: 7, name: 'Route A' }],
      containerTypes: [{ id: 3, code: '20DC', name: '20DC' }],
    });
    listOperationalSites.mockReset();
    listOperationalSites.mockResolvedValue([{ id: 12, siteType: 'WAREHOUSE', name: 'Kho A', shortName: 'Kho A' }]);
  });

  it('marks the required identity + cargo fields invalid on an all-empty submit', async () => {
    renderWorkspace();
    await submitEmptyForm();

    expect(isPaintedRed('shipment-customer')).toBe(true);
    expect(isPaintedRed('shipment-trade-direction')).toBe(true);
    expect(containerTypeIsPaintedRed()).toBe(true);
  });

  // The card's second step, and the regression: a half-typed appointment used
  // to short-circuit validation, so these fields stayed neutral while only the
  // date cell showed red.
  it('still paints the other required fields when a date/time draft is partial', async () => {
    renderWorkspace();
    await screen.findByRole('button', { name: 'Tạo lô hàng' });
    // Only the time half — the draft is incomplete invalid input.
    fireEvent.change(document.querySelector<HTMLInputElement>('input[id$="-customer-appointment-time"]')!, { target: { value: '09:00' } });

    fireEvent.click(screen.getByRole('button', { name: 'Tạo lô hàng' }));

    // The app-owned pass ran: its issues reached the fields (the summary panel
    // lists them too), which is what the danger paint keys off.
    await waitFor(() => expect(isPaintedRed('shipment-customer')).toBe(true));
    expect(isPaintedRed('shipment-trade-direction')).toBe(true);
    // The partial draft keeps its own precise message rather than the
    // field-level fallback.
    expect(document.querySelector('.split-datetime__error')?.textContent).toBe('Nhập đủ giờ và ngày hợp lệ.');
  });
});