import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

let lastRenderForm: ((p: Record<string, unknown>) => ReactNode) | null = null;

vi.mock('../../components/config/CrudTable', async () => {
  const React = await import('react');
  return {
    CrudTable: (props: { renderForm: (p: Record<string, unknown>) => ReactNode }) => {
      lastRenderForm = props.renderForm;
      return React.createElement('div', { 'data-testid': 'crud-table' });
    },
  };
});

vi.mock('../../hooks/animations', () => ({
  usePageAnimations: () => ({ rootRef: { current: null } }),
}));

const vehicleClasses = [
  { id: 11, code: '1.25T', name: 'Xe 1.25 tấn', isContainer: false, sortOrder: 1 },
  { id: 12, code: '5T', name: 'Xe 5 tấn', isContainer: false, sortOrder: 4 },
  { id: 13, code: 'CONT20', name: 'Container 20 feet', isContainer: true, sortOrder: 8 },
];

vi.mock('../../hooks/useCatalogQueries', () => ({
  useAllCustomers: () => ({ data: [{ id: 7, name: 'Khách A', shortName: 'A' }], isError: false, isLoading: false, refetch: vi.fn() }),
  useRoutesDropdown: () => ({ data: [{ id: 3, name: 'Tuyến X', shortName: 'X' }], isError: false, isLoading: false, refetch: vi.fn() }),
  useContainerTypes: () => ({ data: [{ id: 21, code: '20DC', name: "20'DC" }], isError: false, isLoading: false, refetch: vi.fn() }),
  useVehicleSizeClasses: () => ({ data: vehicleClasses, isError: false, isLoading: false, refetch: vi.fn() }),
}));

import PricingTablesConfigPage from './PricingTablesConfigPage';

function renderPageAndForm(formProps: Record<string, unknown> = {}) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <PricingTablesConfigPage />
    </QueryClientProvider>,
  );
  if (!lastRenderForm) throw new Error('renderForm not captured');
  // The form renders through a portal-free host beside the mocked table.
  render(
    <QueryClientProvider client={new QueryClient()}>
      {lastRenderForm({ saving: false, onCancel: vi.fn(), ...formProps }) as ReactNode}
    </QueryClientProvider>,
  );
}

/** Open a UUI combobox by its trigger label and pick an option by text. */
async function pickOption(triggerLabel: RegExp, optionName: RegExp | string) {
  fireEvent.click(screen.getByRole('button', { name: triggerLabel }));
  fireEvent.click(await screen.findByRole('option', { name: optionName }), undefined);
}

function priceInput(): HTMLInputElement {
  const input = document.querySelector('[data-config-form] input[type="number"]') as HTMLInputElement | null;
  if (!input) throw new Error('price input not found');
  return input;
}

describe('FB090-05 PricingTablesConfigPage — structured Loại xe selector', () => {
  it('saves vehicleSizeClassId (not a free-text key) when a class is chosen', async () => {
    const onSave = vi.fn();
    renderPageAndForm({ onSave });
    await pickOption(/Khách hàng/, 'A');
    await pickOption(/Tuyến đường/, 'X');
    await pickOption(/Loại xe/, /5T — Xe 5 tấn/);
    fireEvent.change(priceInput(), { target: { value: '1500000' } });
    fireEvent.click(screen.getByRole('button', { name: /Thêm/ }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      customerId: 7,
      routeId: 3,
      price: 1500000,
      vehicleSizeClassId: 12,
      rateKey: null,
      containerTypeId: null,
    }));
  });

  it('keeps the container axis exclusive with the vehicle class', async () => {
    const onSave = vi.fn();
    renderPageAndForm({ onSave });
    await pickOption(/Khách hàng/, 'A');
    await pickOption(/Tuyến đường/, 'X');
    await pickOption(/Loại xe/, /5T — Xe 5 tấn/);
    // Picking a container afterwards clears the vehicle class.
    await pickOption(/Loại container/, /20DC/);
    fireEvent.change(priceInput(), { target: { value: '1500000' } });
    fireEvent.click(screen.getByRole('button', { name: /Thêm/ }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      vehicleSizeClassId: null,
      containerTypeId: 21,
      rateKey: null,
    }));
  });

  it('links a legacy rate-key row to the matching catalog class on edit-save', async () => {
    const onSave = vi.fn();
    // Legacy row: rateKey '5T', no id link — the class select preselects 5T.
    renderPageAndForm({
      onSave,
      item: {
        id: 99, customerId: 7, routeId: 3, price: '1000000', containerTypeId: null,
        rateKey: '5T', vehicleSizeClassId: null, effectiveDate: '2026-01-01',
        createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', deletedAt: null,
      },
    });
    fireEvent.change(priceInput(), { target: { value: '1600000' } });
    fireEvent.click(screen.getByRole('button', { name: /Cập nhật/ }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      vehicleSizeClassId: 12,
      rateKey: null,
      containerTypeId: null,
    }));
  });

  it('preserves an unmatched legacy free-text key when no selector is chosen', async () => {
    const onSave = vi.fn();
    renderPageAndForm({
      onSave,
      item: {
        id: 100, customerId: 7, routeId: 3, price: '1000000', containerTypeId: null,
        rateKey: 'SPECIAL7', vehicleSizeClassId: null, effectiveDate: '2026-01-01',
        createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', deletedAt: null,
      },
    });
    fireEvent.change(priceInput(), { target: { value: '1700000' } });
    fireEvent.click(screen.getByRole('button', { name: /Cập nhật/ }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      vehicleSizeClassId: null,
      rateKey: 'SPECIAL7',
    }));
  });
});
