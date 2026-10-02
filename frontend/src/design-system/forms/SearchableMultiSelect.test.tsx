import { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it,  } from 'vitest';
import { SearchableMultiSelect } from './SearchableMultiSelect';
import { FilterDropdown } from '../../components/FilterDropdown';

const CARRIERS = [
  { value: 'OWN', label: 'Xe SilverSea' },
  { value: 'UNASSIGNED', label: 'Chờ phân xe' },
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

  it('renders one compact count trigger with complete selected names and no nested controls', () => {
    function Controlled() {
      const [values, setValues] = useState<string[]>(['OWN', 'EXT-1']);
      return (
        <SearchableMultiSelect id="carriers" values={values} onChange={setValues} options={CARRIERS} />
      );
    }
    render(<Controlled />);
    const trigger = screen.getByRole('button', { name: '2 đã chọn' });
    expect(trigger).toHaveTextContent('2 đã chọn');
    expect(trigger).toHaveAttribute('title', 'Xe SilverSea, Công ty Vận Tải A');
    expect(trigger.querySelector('button')).toBeNull();
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
    // Individual removal stays in the same checked option list.
    expect(screen.getByRole('button', { name: '1 đã chọn' })).toHaveTextContent('1 đã chọn');
    fireEvent.click(screen.getByRole('option', { name: 'Xe SilverSea' }));
    expect(screen.getByRole('option', { name: 'Xe SilverSea' })).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByRole('button', { name: /chọn nhiều mục/i })).toBeTruthy();
  });

  it('deselects only the chosen checked option and preserves the exact hidden value', () => {
    function Controlled() {
      const [values, setValues] = useState<string[]>(['OWN', 'EXT-1']);
      return (
        <SearchableMultiSelect id="carriers" name="carrierIds" values={values} onChange={setValues} options={CARRIERS} />
      );
    }
    const { container } = render(<Controlled />);
    expect(container.querySelector('input[name="carrierIds"]')).toHaveValue('OWN,EXT-1');
    fireEvent.click(screen.getByRole('button', { name: '2 đã chọn' }));
    fireEvent.click(screen.getByRole('option', { name: 'Công ty Vận Tải A' }));
    expect(container.querySelector('input[name="carrierIds"]')).toHaveValue('OWN');
    expect(screen.getByRole('option', { name: 'Công ty Vận Tải A' })).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByRole('option', { name: 'Xe SilverSea' })).toHaveAttribute('aria-selected', 'true');
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
    // The same accessible count opens the existing list and clear-all action.
    fireEvent.click(screen.getByRole('button', { name: '2 đã chọn' }));
    fireEvent.click(screen.getByTestId('carriers-clear-all'));
    expect(screen.getByRole('option', { name: 'Xe SilverSea' })).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByRole('option', { name: 'Công ty Vận Tải A' })).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByRole('button', { name: /chọn nhiều mục/i })).toBeTruthy();
  });

  it('disables the footer clear action when nothing is selected', () => {
    render(
      <SearchableMultiSelect id="carriers" values={[]} onChange={() => {}} options={CARRIERS} />,
    );
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByTestId('carriers-clear-all')).toBeDisabled();
  });

  it('retains required, disabled and selected hidden values on the compact trigger', () => {
    const { container } = render(<SearchableMultiSelect id="carriers" name="carrierIds" selectionLabel="nhà xe" required disabled values={['OWN', 'EXT-1']} onChange={() => {}} options={CARRIERS} />);
    const trigger = screen.getByRole('button', { name: 'Đã chọn 2 nhà xe' });
    expect(trigger).toBeDisabled();
    expect(trigger).toHaveAttribute('aria-required', 'true');
    expect(trigger.querySelector('button')).toBeNull();
    expect(container.querySelector('input[name="carrierIds"]')).toHaveValue('OWN,EXT-1');
    fireEvent.click(trigger);
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('keeps keyboard toggle and Escape focus restoration in the checked list', async () => {
    function Controlled() {
      const [values, setValues] = useState<string[]>(['OWN']);
      return <SearchableMultiSelect id="carriers" name="carrierIds" values={values} onChange={setValues} options={CARRIERS} />;
    }
    const { container } = render(<Controlled />);
    const trigger = screen.getByRole('button', { name: '1 đã chọn' });
    fireEvent.click(trigger);
    const search = screen.getByRole('combobox');
    fireEvent.keyDown(search, { key: 'ArrowDown' });
    fireEvent.keyDown(search, { key: 'Enter' });
    expect(container.querySelector('input[name="carrierIds"]')).toHaveValue('OWN,UNASSIGNED');
    expect(screen.getByRole('option', { name: 'Chờ phân xe' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(search, { key: 'Enter' });
    expect(container.querySelector('input[name="carrierIds"]')).toHaveValue('OWN');
    fireEvent.keyDown(search, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it('dismisses only the nested picker after clear-all sends Escape from BODY, then dismisses its parent', async () => {
    function Controlled() {
      const [values, setValues] = useState<string[]>(['OWN', 'EXT-1']);
      return <FilterDropdown count={values.length} ariaLabel="Bộ lọc" inlineWhenRoom={false} onReset={() => setValues([])}>
        <SearchableMultiSelect id="carriers" name="carrierIds" values={values} onChange={setValues} options={CARRIERS} />
      </FilterDropdown>;
    }
    const { container } = render(<Controlled />);
    fireEvent.click(screen.getByRole('button', { name: /Bộ lọc/ }));
    fireEvent.click(screen.getByRole('button', { name: '2 đã chọn' }));
    fireEvent.click(screen.getByTestId('carriers-clear-all'));
    expect(screen.getByTestId('carriers-clear-all')).toBeDisabled();
    expect(container.querySelector('input[name="carrierIds"]')).toBeNull();
    expect(document.querySelector('input[name="carrierIds"]')).toHaveValue('');
    // A real browser drops focus when the now-empty clear button disables.
    fireEvent.keyDown(document.body, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
    expect(screen.getByRole('dialog', { name: 'Bộ lọc nâng cao' })).toBeTruthy();
    const trigger = screen.getByRole('button', { name: /chọn nhiều mục/i });
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    fireEvent.keyDown(trigger, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Bộ lọc nâng cao' })).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Bộ lọc' })));
  });
});
