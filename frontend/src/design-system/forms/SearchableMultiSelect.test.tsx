import { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it,  } from 'vitest';
import { SearchableMultiSelect } from './SearchableMultiSelect';

const CARRIERS = [
  { value: 'OWN', label: 'Xe SilverSea' },
  { value: 'UNASSIGNED', label: 'Chưa điều xe' },
  { value: 'EXT-1', label: 'Công ty Vận Tải A', chipLabel: 'A' },
  { value: 'EXT-2', label: 'Công ty Vận Tải B', chipLabel: 'B' },
];

describe('SearchableMultiSelect', () => {
  it('renders the placeholder when nothing is selected', () => {
    render(
      <SearchableMultiSelect id="carriers" values={[]} onChange={() => {}} options={CARRIERS} />,
    );
    expect(screen.getByRole('button', { name: /chọn nhiều mục/i })).toBeTruthy();
  });

  it('renders selected chips inside the trigger and exposes remove buttons', () => {
    function Controlled() {
      const [values, setValues] = useState<string[]>(['OWN', 'EXT-1']);
      return (
        <SearchableMultiSelect id="carriers" values={values} onChange={setValues} options={CARRIERS} />
      );
    }
    render(<Controlled />);
    expect(screen.getByRole('button', { name: 'Xóa Xe SilverSea' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Xóa A' })).toBeTruthy();
  });

  it('toggles a value via the option row click without closing the popover', async () => {
    function Controlled() {
      const [values, setValues] = useState<string[]>([]);
      return (
        <SearchableMultiSelect id="carriers" values={values} onChange={setValues} options={CARRIERS} />
      );
    }
    render(<Controlled />);
    fireEvent.click(screen.getByRole('button', { name: /chọn nhiều mục/i }));
    fireEvent.click(screen.getByRole('option', { name: 'Xe SilverSea' }));
    await waitFor(() => expect(screen.getByRole('option', { name: 'Xe SilverSea' })).toHaveAttribute('aria-selected', 'true'));
    // The popover stays open (option still in the DOM), and a chip-remove button
    // for the newly-selected option appears in the trigger.
    expect(screen.getByRole('button', { name: 'Xóa Xe SilverSea' })).toBeTruthy();
  });

  it('removes a chip via the inline × button', () => {
    function Controlled() {
      const [values, setValues] = useState<string[]>(['OWN', 'EXT-1']);
      return (
        <SearchableMultiSelect id="carriers" values={values} onChange={setValues} options={CARRIERS} />
      );
    }
    render(<Controlled />);
    fireEvent.click(screen.getByRole('button', { name: 'Xóa A' }));
    expect(screen.queryByRole('button', { name: 'Xóa A' })).toBeNull();
  });

  it('clears all selections via the footer action', () => {
    function Controlled() {
      const [values, setValues] = useState<string[]>(['OWN', 'EXT-1']);
      return (
        <SearchableMultiSelect
          id="carriers"
          values={values}
          onChange={setValues}
          options={CARRIERS}
        />
      );
    }
    render(<Controlled />);
    // The trigger exposes its count via aria-label so it has a stable
    // accessible name distinct from the chip-remove buttons.
    fireEvent.click(screen.getByRole('button', { name: '2 đã chọn' }));
    fireEvent.click(screen.getByTestId('carriers-clear-all'));
    expect(screen.queryByRole('button', { name: 'Xóa Xe SilverSea' })).toBeNull();
  });

  it('disables the footer clear action when nothing is selected', () => {
    render(
      <SearchableMultiSelect id="carriers" values={[]} onChange={() => {}} options={CARRIERS} />,
    );
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByTestId('carriers-clear-all')).toBeDisabled();
  });
});
