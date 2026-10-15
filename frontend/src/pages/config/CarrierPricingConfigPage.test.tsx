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

vi.mock('../../hooks/useCatalogQueries', () => ({
  useRoutesDropdown: () => ({ data: [{ id: 3, name: 'Tuyến X', shortName: 'X' }], isError: false, isLoading: false, refetch: vi.fn() }),
  useVehicleSizeClasses: () => ({
    data: [
      { id: 12, code: '5T', name: 'Xe 5 tấn', isContainer: false, sortOrder: 4 },
      { id: 13, code: 'CONT20', name: 'Container 20 feet', isContainer: true, sortOrder: 8 },
    ],
    isError: false, isLoading: false, refetch: vi.fn(),
  }),
  useAllSuppliers: () => ({ data: [{ id: 55, name: 'Nhà xe Việt Hưng', shortName: 'Việt Hưng' }], isError: false, isLoading: false, refetch: vi.fn() }),
}));

import CarrierPricingConfigPage from './CarrierPricingConfigPage';

function renderPageAndForm(formProps: Record<string, unknown> = {}) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <CarrierPricingConfigPage />
    </QueryClientProvider>,
  );
  if (!lastRenderForm) throw new Error('renderForm not captured');
  render(
    <QueryClientProvider client={new QueryClient()}>
      {lastRenderForm({ saving: false, onCancel: vi.fn(), ...formProps }) as ReactNode}
    </QueryClientProvider>,
  );
}

async function pickOption(triggerLabel: RegExp, optionName: RegExp | string) {
  fireEvent.click(screen.getByRole('button', { name: triggerLabel }));
  fireEvent.click(await screen.findByRole('option', { name: optionName }), undefined);
}

function priceInput(): HTMLInputElement {
  const input = document.querySelector('[data-config-form] input[type="number"]') as HTMLInputElement | null;
  if (!input) throw new Error('price input not found');
  return input;
}

describe('FB090-05 CarrierPricingConfigPage — bảng giá cước trả nhà xe', () => {
  it('saves a generic (giá chung) row with supplierId null by default', async () => {
    const onSave = vi.fn();
    renderPageAndForm({ onSave });
    await pickOption(/Tuyến đường/, 'X');
    await pickOption(/Loại xe/, /5T — Xe 5 tấn/);
    // Leave "Nhà xe" untouched — the default option is the generic lane.
    fireEvent.change(priceInput(), { target: { value: '2400000' } });
    fireEvent.click(screen.getByRole('button', { name: /Thêm/ }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      routeId: 3,
      vehicleSizeClassId: 12,
      supplierId: null,
      price: 2400000,
    }));
  });

  it('saves a supplier-specific row when a nhà xe is chosen', async () => {
    const onSave = vi.fn();
    renderPageAndForm({ onSave });
    await pickOption(/Tuyến đường/, 'X');
    await pickOption(/Loại xe/, /5T — Xe 5 tấn/);
    await pickOption(/Nhà xe/, /Việt Hưng/);
    fireEvent.change(priceInput(), { target: { value: '2400000' } });
    fireEvent.click(screen.getByRole('button', { name: /Thêm/ }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      vehicleSizeClassId: 12,
      supplierId: 55,
      price: 2400000,
    }));
  });

  it('offers the generic lane as the empty nhà xe option', async () => {
    renderPageAndForm({});
    fireEvent.click(screen.getByRole('button', { name: /Nhà xe/ }));
    expect(await screen.findByRole('option', { name: /Giá chung \(mọi nhà xe\)/ })).toBeTruthy();
  });

  it('marks truck classes as 100% external in the class options', async () => {
    renderPageAndForm({});
    fireEvent.click(screen.getByRole('button', { name: /Loại xe/ }));
    expect(await screen.findByRole('option', { name: /5T — Xe 5 tấn \(100% xe ngoài\)/ })).toBeTruthy();
    expect(screen.getByRole('option', { name: /CONT20 — Container 20 feet$/ })).toBeTruthy();
  });
});
