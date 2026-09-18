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
});
