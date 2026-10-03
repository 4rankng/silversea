import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ContainerTypeCellPicker } from './ContainerTypeCellPicker';

const OPTIONS = [
  { id: 20, code: '20DC', name: "20'DC" },
  { id: 40, code: '40HC', name: "40'HC" },
];

describe('ContainerTypeCellPicker — commit pin (20260918_11)', () => {
  it('picking an option commits its id through onChange', async () => {
    const onChange = vi.fn();
    render(
      <ContainerTypeCellPicker value="" onChange={onChange} options={OPTIONS} fieldId="probe-type" saving={false} />,
    );

    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Loại container' })).toBeTruthy());
    fireEvent.click(screen.getByRole('combobox', { name: 'Loại container' }));

    const option = await screen.findByRole('option', { name: '20DC' });
    fireEvent.click(option);

    await waitFor(() => expect(onChange).toHaveBeenCalledWith('20'));
  });

  it('keyboard path (ArrowDown + Enter) commits the highlighted id', async () => {
    const onChange = vi.fn();
    render(
      <ContainerTypeCellPicker value="" onChange={onChange} options={OPTIONS} fieldId="probe-type-kbd" saving={false} />,
    );

    const combo = screen.getByRole('combobox', { name: 'Loại container' });
    fireEvent.click(combo);
    await screen.findByRole('option', { name: '20DC' });
    fireEvent.keyDown(combo, { key: 'ArrowDown' });
    fireEvent.keyDown(combo, { key: 'Enter' });
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('20'));
  });

  it('typing right after keyboard focus opens the suggestions and filters (20260921_1)', async () => {
    const onChange = vi.fn();
    render(
      <ContainerTypeCellPicker value="" onChange={onChange} options={OPTIONS} fieldId="probe-type-tab" saving={false} />,
    );

    const combo = screen.getByRole('combobox', { name: 'Loại container' });
    // Tab-in lands focus; the very first typed character must surface the
    // suggestion list (no mouse click in this flow). Real .focus() (not the
    // synthetic event) so document.activeElement actually moves — RAC's
    // menu-trigger machinery checks it.
    combo.focus();
    fireEvent.change(combo, { target: { value: '4' } });

    expect(await screen.findByRole('option', { name: '40HC' })).toBeTruthy();
    expect(screen.queryByRole('option', { name: '20DC' })).toBeNull();
  });

  it('ArrowDown + Enter commits after the menu was opened by typing', async () => {
    const onChange = vi.fn();
    render(
      <ContainerTypeCellPicker value="" onChange={onChange} options={OPTIONS} fieldId="probe-type-tab-kbd" saving={false} />,
    );

    const combo = screen.getByRole('combobox', { name: 'Loại container' });
    combo.focus();
    fireEvent.change(combo, { target: { value: '4' } });
    await screen.findByRole('option', { name: '40HC' });
    fireEvent.keyDown(combo, { key: 'ArrowDown' });
    fireEvent.keyDown(combo, { key: 'Enter' });
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('40'));
  });
});

describe('ContainerTypeCellPicker — paired-field Tab hand-off (card 20261002_272)', () => {
  it('bare focus never opens the menu (the 2026-09-21 focus-trigger rejection stands)', () => {
    render(
      <ContainerTypeCellPicker value="" onChange={vi.fn()} options={OPTIONS} fieldId="probe-type-bare" saving={false} />,
    );

    const combo = screen.getByRole('combobox', { name: 'Loại container' });
    combo.focus();
    expect(document.querySelector('[role=listbox]')).toBeNull();
  });

  it('Tab leaving the paired Số container field opens the menu exactly once; pass-through stays closed', async () => {
    const openApiRef = { current: null as { open: () => void } | null };
    render(
      <div>
        {/* The paired field, wired exactly as ShipmentCreateContainerRow wires it. */}
        <input
          aria-label="Số container"
          onKeyDown={(event) => {
            if (event.key === 'Tab' && !event.shiftKey) {
              window.setTimeout(() => openApiRef.current?.open(), 0);
            }
          }}
        />
        <ContainerTypeCellPicker value="" onChange={vi.fn()} options={OPTIONS} fieldId="probe-type-handoff" saving={false} openApiRef={openApiRef} />
      </div>,
    );

    // Before any Tab the handle exists but nothing is open — bare focus (a
    // pass-through tab lands here too) must stay closed.
    const combo = screen.getByRole('combobox', { name: 'Loại container' });
    combo.focus();
    expect(document.querySelector('[role=listbox]')).toBeNull();

    // Tab on the paired field: focus lands on the picker, then the hand-off
    // opens the menu exactly once.
    fireEvent.keyDown(screen.getByLabelText('Số container'), { key: 'Tab' });
    await waitFor(() => expect(document.querySelector('[role=listbox]')).toBeTruthy());
  });
});
