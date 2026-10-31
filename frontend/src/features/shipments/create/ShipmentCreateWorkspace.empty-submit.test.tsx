import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getBootstrap } = vi.hoisted(() => ({ getBootstrap: vi.fn() }));
vi.mock('../../../api/tripClient', () => ({
  tripClient: { getBootstrap },
}));
vi.mock('./FreightPreviewCard', () => ({ FreightPreviewCard: () => null }));

import { ToastProvider } from '../../../components/shared/Toast';
import { ShipmentCreateWorkspace } from './ShipmentCreateWorkspace';

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

describe('shipment create empty submit feedback', { timeout: 30000 }, () => {
  beforeEach(() => {
    getBootstrap.mockReset();
    getBootstrap.mockResolvedValue({
      customers: [{ id: 1, name: 'KH A' }],
      routes: [],
    });
  });

  it('opts out of native constraint validation so the app summary owns empty submits', async () => {
    renderWorkspace();
    await screen.findByRole('button', { name: 'Tạo lô hàng' });
    // The workspace carries its own zod-driven summary + per-field errors;
    // native bubbles must never intercept the submit (same contract as the
    // treasury drawer).
    expect(document.querySelector('form.csc-workspace')).toHaveAttribute('novalidate');
  });

  it('keeps any missing-info banner absent on a pristine open (SIL-627: the banner is retired)', async () => {
    renderWorkspace();
    await screen.findByRole('button', { name: 'Tạo lô hàng' });

    // The live readiness knows the form is empty, but nothing may throw
    // itself at the operator before any create attempt — and since SIL-627
    // the summary banner never comes back at all.
    await waitFor(() => expect(document.querySelector('.csc-topline__progress')?.textContent).toContain('Bắt buộc: 0/'));
    expect(screen.queryByText(/Cần bổ sung/)).toBeNull();
    expect(document.querySelector('.csc-validation-summary')).toBeNull();
  });

  it('empty submit paints the per-field errors and moves focus to the first missing field (banner retired, SIL-627)', async () => {
    renderWorkspace();
    const createButton = await screen.findByRole('button', { name: 'Tạo lô hàng' });
    fireEvent.click(createButton);

    // `Tạo lô hàng` is the FULL-intake validation intent (the partial
    // customer-only save is `Lưu nháp`). SIL-627 removed the "Cần bổ sung N
    // thông tin" banner — the summary `.csc-validation-summary` must never
    // render — and the per-field paint carries the same messages.
    await waitFor(() => expect(document.querySelector('.csc-validation-summary')).toBeNull());
    expect(screen.queryByText(/Cần bổ sung/)).toBeNull();
    await waitFor(() => {
      const paint = document.querySelectorAll(
        '.csc-container-cell--error, [data-uui-control][aria-invalid="true"], input[aria-invalid="true"], .csc-searchable-field--error',
      );
      expect(paint.length).toBeGreaterThan(0);
    });

    // …and focusShipmentCreateIssue moves focus into the customer field.
    await waitFor(() => {
      const wrap = document.querySelector('[data-field-id="shipment-customer"]');
      expect(wrap?.contains(document.activeElement)).toBe(true);
    }, { timeout: 2000 });
  });
});
