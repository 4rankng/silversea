import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
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

import FuelPricePeriodsConfigPage from './FuelPricePeriodsConfigPage';

function renderPage() {
  return render(
    <MemoryRouter>
      <FuelPricePeriodsConfigPage />
    </MemoryRouter>,
  );
}

function renderForm(props: Record<string, unknown> = {}) {
  if (!lastRenderForm) throw new Error('renderForm not captured');
  return render(
    <div data-testid="form-host">
      {lastRenderForm({ saving: false, onSave: vi.fn(), onCancel: vi.fn(), ...props }) as ReactNode}
    </div>,
  );
}

const SAVE = 'Thêm';

function fillFuelForm(host: HTMLElement, date: string, price: string, note: string) {
  fireEvent.change(host.querySelector('input[type="date"]') as HTMLInputElement, { target: { value: date } });
  fireEvent.change(host.querySelector('input[type="number"]') as HTMLInputElement, { target: { value: price } });
  const inputs = host.querySelectorAll('input');
  fireEvent.change(inputs[2], { target: { value: note } });
}

describe('FuelPricePeriodsConfigPage — TC-CUOC-002 fuel price entry', () => {
  it('renders the CrudTable surface', () => {
    renderPage();
    expect(screen.getByTestId('crud-table')).toBeTruthy();
  });

  it('blocks save when date/price empty or price is not positive', () => {
    renderPage();
    const onSave = vi.fn();
    const host = renderForm({ onSave });

    fireEvent.click(screen.getByText(SAVE));
    expect(onSave).not.toHaveBeenCalled();

    fillFuelForm(host.container as HTMLElement, '', '0', '');
    fireEvent.click(screen.getByText(SAVE));
    expect(onSave).not.toHaveBeenCalled();
  });

  it('sends { effectiveFrom, unitPrice number, sourceNote } on save', () => {
    renderPage();
    const onSave = vi.fn();
    const host = renderForm({ onSave });

    fillFuelForm(host.container as HTMLElement, '2026-09-10', '21740', 'Petrolimex 18/7');
    fireEvent.click(screen.getByText(SAVE));

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith({
      effectiveFrom: '2026-09-10',
      unitPrice: 21740,
      sourceNote: 'Petrolimex 18/7',
    });
  });
});

