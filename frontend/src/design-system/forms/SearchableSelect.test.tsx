import { useState } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
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

  it('debounces remote search callbacks for bounded server-side selectors', () => {
    vi.useFakeTimers();
    const onSearchChange = vi.fn();
    render(
      <SearchableSelect
        id="tripId"
        value=""
        onChange={() => {}}
        onSearchChange={onSearchChange}
        options={ROUTES}
      />,
    );

    fireEvent.click(screen.getByRole('button'));
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'minh hai' } });
    expect(onSearchChange).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(250));
    expect(onSearchChange).toHaveBeenLastCalledWith('minh hai');
    vi.useRealTimers();
  });

  it('loads the next cursor page without closing the selector', () => {
    const onLoadMore = vi.fn();
    render(
      <SearchableSelect
        id="truckId"
        value=""
        onChange={() => {}}
        options={ROUTES}
        hasMore
        onLoadMore={onLoadMore}
      />,
    );

    fireEvent.click(screen.getByRole('button'));
    fireEvent.click(screen.getByRole('button', { name: 'Tải thêm kết quả' }));

    expect(onLoadMore).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('combobox')).toBeTruthy();
  });
});
