import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

// Capture the form renderer so we can render it in isolation and assert on
// validation behaviour (same harness as FuelNormsConfigPage.test.tsx).
type SaveSpy = ReturnType<typeof vi.fn> & ((data: Record<string, unknown>) => void);
let lastRenderForm: ((p: Record<string, unknown>) => ReactNode) | null = null;
let lastOnSave: SaveSpy | null = null;

vi.mock('../../components/config/CrudTable', () => ({
  CrudTable: (_: Record<string, unknown>) => null,
}));
// CrudTable is imported as a named export and used as <CrudTable />; intercept
// the JSX path by replacing the component module before the page imports it.
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
  useVehicleSizeClasses: () => ({
    data: [
      { id: 1, code: 'CONT40', name: 'Container 40 feet' },
      { id: 2, code: '5T', name: 'Xe 5 tấn' },
    ],
    isError: false,
    isLoading: false,
    refetch: () => Promise.resolve({} as never),
  }),
}));

import FuelConsumptionNormsConfigPage from './FuelConsumptionNormsConfigPage';

function renderPage() {
  return render(
    <MemoryRouter>
      <FuelConsumptionNormsConfigPage />
    </MemoryRouter>,
  );
}

/** Render the captured form component with a known onSave. */
function renderForm() {
  if (!lastRenderForm) throw new Error('renderForm not captured — render the page first');
  const onSave = vi.fn() as SaveSpy;
  const onCancel = vi.fn();
  lastOnSave = onSave;
  return render(
    <div data-testid="form-host">
      {lastRenderForm({ saving: false, onSave, onCancel }) as ReactNode}
    </div>,
  );
}

describe('FuelConsumptionNormsConfigPage — R31 freight-01 validation', () => {
  it('shows Vietnamese errors per field and does not call onSave when fields are empty', async () => {
    renderPage();
    const formHost = renderForm();
    const litersInput = formHost.container.querySelector('input[type="number"]') as HTMLInputElement;
    const dateInput = screen.getByLabelText('Ngày hiệu lực') as HTMLInputElement;

    fireEvent.change(dateInput, { target: { value: '' } });
    fireEvent.change(litersInput, { target: { value: '' } });
    // Loại xe stays at placeholder option 0 (chưa chọn)
    fireEvent.click(screen.getByRole('button', { name: /Thêm/ }));

    await waitFor(() => {
      expect(screen.getByText('Chọn loại xe trước khi lưu')).toBeTruthy();
      expect(screen.getByText('Định mức lít/km phải lớn hơn 0')).toBeTruthy();
      expect(screen.getByText('Ngày hiệu lực là bắt buộc')).toBeTruthy();
    });
    expect(lastOnSave).not.toHaveBeenCalled();
  });

  it('rejects zero liters/km with the Vietnamese message', async () => {
    renderPage();
    const formHost = renderForm();
    const litersInput = formHost.container.querySelector('input[type="number"]') as HTMLInputElement;

    fireEvent.change(litersInput, { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: /Thêm/ }));

    await waitFor(() => {
      expect(screen.getByText('Định mức lít/km phải lớn hơn 0')).toBeTruthy();
    });
    expect(lastOnSave).not.toHaveBeenCalled();
  });

  it('calls onSave with vehicleSizeClassId + litersPerKm when valid', async () => {
    renderPage();
    const formHost = renderForm();
    const litersInput = formHost.container.querySelector('input[type="number"]') as HTMLInputElement;
    const dateInput = screen.getByLabelText('Ngày hiệu lực') as HTMLInputElement;

    // UuiSelectField with <5 options renders the plain listbox variant —
    // press the trigger, then pick the CONT40 option (same React Aria drive
    // pattern as UserForm.test.tsx).
    fireEvent.click(screen.getByRole('button', { name: /Loại xe/i }));
    fireEvent.click(screen.getByRole('option', { name: 'Container 40 feet' }));

    fireEvent.change(litersInput, { target: { value: '0.35' } });
    fireEvent.change(dateInput, { target: { value: '01/08/2026' } });
    fireEvent.click(screen.getByRole('button', { name: /Thêm/ }));

    await waitFor(() => {
      expect(lastOnSave).toHaveBeenCalledTimes(1);
    });
    const payload = lastOnSave!.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.vehicleSizeClassId).toBe(1);
    expect(payload.litersPerKm).toBe('0.35');
    expect(payload.effectiveDate).toBe('2026-08-01');
  });
});
