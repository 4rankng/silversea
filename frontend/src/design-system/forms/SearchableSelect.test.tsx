import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SearchableSelect } from './SearchableSelect';

const ROUTES = [
  { value: '1', label: 'Hải Phòng - Yên Sơn, Tuyên Quang' },
  { value: '2', label: 'Hải Phòng - Bản Bo, Lai Châu' },
  { value: '3', label: 'Nam Đình Vũ - Cẩm Khê, Phú Thọ' },
];

describe('SearchableSelect', () => {
  it('filters Vietnamese labels without requiring diacritics', () => {
    render(
      <SearchableSelect
        id="routeId"
        value=""
        onChange={() => {}}
        options={ROUTES}
        searchPlaceholder="Tìm tuyến đường…"
      />,
    );

    fireEvent.click(screen.getByRole('button'));
    fireEvent.change(screen.getByRole('combobox'), {
      target: { value: 'hai phong yen son' },
    });

    expect(screen.getByRole('option', { name: /Hải Phòng - Yên Sơn/ })).toBeTruthy();
    expect(screen.queryByRole('option', { name: /Bản Bo/ })).toBeNull();
  });

  it('selects a filtered route and shows it in the trigger', () => {
    function ControlledSelect() {
      const [value, setValue] = useState('');
      return (
        <SearchableSelect
          id="routeId"
          value={value}
          onChange={setValue}
          options={ROUTES}
          searchPlaceholder="Tìm tuyến đường…"
        />
      );
    }

    render(<ControlledSelect />);
    fireEvent.click(screen.getByRole('button'));
    fireEvent.change(screen.getByRole('combobox'), {
      target: { value: 'ban bo' },
    });
    fireEvent.click(screen.getByRole('option', { name: /Bản Bo/ }));

    expect(screen.getByRole('button').textContent).toContain('Hải Phòng - Bản Bo, Lai Châu');
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  it('supports arrow-key and Enter selection', () => {
    const onChange = vi.fn();
    render(
      <SearchableSelect
        id="routeId"
        value=""
        onChange={onChange}
        options={ROUTES}
        searchPlaceholder="Tìm tuyến đường…"
      />,
    );

    fireEvent.click(screen.getByRole('button'));
    const search = screen.getByRole('combobox');
    fireEvent.keyDown(search, { key: 'ArrowDown' });
    fireEvent.keyDown(search, { key: 'Enter' });

    expect(onChange).toHaveBeenCalledWith('2');
  });
});
