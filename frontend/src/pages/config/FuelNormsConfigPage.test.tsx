import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

// Capture the form renderer so we can render it in isolation and assert on
// validation behaviour. The CrudTable mock stashes the renderForm callback
// into `lastRenderForm` whenever the page renders.
type SaveSpy = ReturnType<typeof vi.fn> & ((data: Record<string, unknown>) => void);
let lastRenderForm: ((p: Record<string, unknown>) => ReactNode) | null = null;
let lastOnSave: SaveSpy | null = null;

vi.mock('../../components/config/CrudTable', () => ({
  CrudTable: (_: Record<string, unknown>) => null,
}));
// CrudTable is imported as a named export and used as <CrudTable />; intercept
// the JSX path by replacing the component module before the page imports it.
// (The vi.mock above handles this; we re-export here for the spy below.)
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
  useRoutesDropdown: () => ({
    data: [
      { id: 1, name: 'Hải Phòng – Hà Nội' },
      { id: 2, name: 'Hà Nội – Hải Phòng' },
    ],
  }),
}));

// Hook the form by capturing onSave via a render of the form itself.
// We render the page once (so lastRenderForm is captured), then render the
// form into a separate container with a known onSave spy.
import FuelNormsConfigPage from './FuelNormsConfigPage';

function renderPage() {
  return render(
    <MemoryRouter>
      <FuelNormsConfigPage />
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

describe('FuelNormsConfigPage — TC-M12-01-02 validation', () => {
  it('shows Vietnamese errors and does not call onSave when fields are empty', async () => {
    renderPage();
    const formHost = renderForm();
    // Find all number inputs and the date input
    const inputs = formHost.container.querySelectorAll('input');
    const loadedInput = Array.from(inputs).find(i => (i.placeholder || '').includes('30')) as HTMLInputElement;
    const emptyInput = Array.from(inputs).find(i => (i.placeholder || '').includes('25')) as HTMLInputElement;
    const dateInput = screen.getByLabelText('Ngày hiệu lực') as HTMLInputElement;

    // Clear the date (default is today — clear it to trigger required error)
    fireEvent.change(dateInput, { target: { value: '' } });
    // Leave loaded/empty empty
    fireEvent.change(loadedInput, { target: { value: '' } });
    fireEvent.change(emptyInput, { target: { value: '' } });

    fireEvent.click(screen.getByRole('button', { name: /Thêm/ }));

    await waitFor(() => {
      // Three Vietnamese error messages appear next to the fields.
      expect(screen.getByText('Ngày hiệu lực là bắt buộc')).toBeTruthy();
      expect(screen.getByText('Định mức có hàng phải lớn hơn 0')).toBeTruthy();
      expect(screen.getByText('Định mức không hàng phải lớn hơn 0')).toBeTruthy();
    });
    expect(lastOnSave).not.toHaveBeenCalled();
  });

  it('rejects zero litres with Vietnamese messages and blocks negative litres with field validity', async () => {
    renderPage();
    const formHost = renderForm();
    const inputs = formHost.container.querySelectorAll('input');
    const loadedInput = Array.from(inputs).find(i => (i.placeholder || '').includes('30')) as HTMLInputElement;
    const emptyInput = Array.from(inputs).find(i => (i.placeholder || '').includes('25')) as HTMLInputElement;

    fireEvent.change(loadedInput, { target: { value: '0' } });
    fireEvent.change(emptyInput, { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: /Thêm/ }));

    await waitFor(() => {
      expect(screen.getByText('Định mức có hàng phải lớn hơn 0')).toBeTruthy();
      expect(screen.getByText('Định mức không hàng phải lớn hơn 0')).toBeTruthy();
    });
    expect(lastOnSave).not.toHaveBeenCalled();

    fireEvent.change(loadedInput, { target: { value: '30' } });
    fireEvent.change(emptyInput, { target: { value: '-5' } });
    fireEvent.click(screen.getByRole('button', { name: /Thêm/ }));
    expect(emptyInput.validity.rangeUnderflow).toBe(true);
    expect(emptyInput).toHaveFocus();
    expect(lastOnSave).not.toHaveBeenCalled();
  });

  it('calls onSave with effectiveDate when all fields are valid', async () => {
    renderPage();
    const formHost = renderForm();
    const inputs = formHost.container.querySelectorAll('input');
    const loadedInput = Array.from(inputs).find(i => (i.placeholder || '').includes('30')) as HTMLInputElement;
    const emptyInput = Array.from(inputs).find(i => (i.placeholder || '').includes('25')) as HTMLInputElement;
    const dateInput = screen.getByLabelText('Ngày hiệu lực') as HTMLInputElement;

    fireEvent.change(loadedInput, { target: { value: '30' } });
    fireEvent.change(emptyInput, { target: { value: '25' } });
    fireEvent.change(dateInput, { target: { value: '01/08/2026' } });
    fireEvent.click(screen.getByRole('button', { name: /Thêm/ }));

    await waitFor(() => {
      expect(lastOnSave).toHaveBeenCalledTimes(1);
    });
    const payload = lastOnSave!.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.effectiveDate).toBe('2026-08-01');
    expect(payload.loadedLitersPer100Km).toBe('30');
    expect(payload.emptyLitersPer100Km).toBe('25');
  });
});
