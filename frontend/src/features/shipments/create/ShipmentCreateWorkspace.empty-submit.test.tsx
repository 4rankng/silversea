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

describe('shipment create empty submit feedback', () => {
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

  it('empty submit shows the validation summary and moves focus to the first missing field', async () => {
    renderWorkspace();
    const createButton = await screen.findByRole('button', { name: 'Tạo lô hàng' });
    fireEvent.click(createButton);

    // The DRAFT issue list surfaces as the summary alert…
    const alert = await screen.findByText('Cần bổ sung 1 thông tin');
    expect(alert).toBeTruthy();
    expect(document.querySelector('.csc-validation-summary')?.textContent)
      .toContain('Chọn khách hàng để tạo lô hàng.');

    // …and focusShipmentCreateIssue moves focus into the customer field.
    await waitFor(() => {
      const wrap = document.querySelector('[data-field-id="shipment-customer"]');
      expect(wrap?.contains(document.activeElement)).toBe(true);
    }, { timeout: 2000 });
  });
});
