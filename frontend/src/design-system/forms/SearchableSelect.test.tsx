import { useState } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SearchableSelect } from './SearchableSelect';

const ROUTES = [
  { value: '1', label: 'Hải Phòng - Yên Sơn, Tuyên Quang' },
  { value: '2', label: 'Hải Phòng - Bản Bo, Lai Châu' },
  { value: '3', label: 'Nam Đình Vũ - Cẩm Khê, Phú Thọ' },
];

describe('SearchableSelect', () => {
  it('uses the compact shared field contract when requested', () => {
    render(<SearchableSelect id="compact-select" value="" onChange={() => {}} options={ROUTES} size="sm" />);

    expect(screen.getByRole('button', { name: /chọn một mục/i })).toHaveClass('searchable-select__trigger--sm');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function useMobileViewport() {
    vi.stubGlobal('matchMedia', vi.fn().mockImplementation((query: string) => ({
      matches: query === '(max-width: 640px)',
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })));
  }

  it('exposes caller-owned validation state and description', () => {
    render(
      <>
        <SearchableSelect
          id="routeId"
          value=""
          onChange={() => {}}
          options={ROUTES}
          ariaInvalid
          ariaDescribedBy="route-error"
        />
        <span id="route-error">Chọn tuyến đường.</span>
      </>,
    );
    const trigger = screen.getByRole('button');
    expect(trigger.getAttribute('aria-invalid')).toBe('true');
    expect(trigger.getAttribute('aria-describedby')).toBe('route-error');
  });

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

  it('returns focus to its trigger after the selection sheet is dismissed', async () => {
    render(
      <SearchableSelect
        id="routeId"
        value=""
        onChange={() => {}}
        options={ROUTES}
        searchPlaceholder="Tìm tuyến đường…"
      />,
    );

    const trigger = screen.getByRole('button', { name: /Chọn một mục/ });
    fireEvent.click(trigger);
    fireEvent.click(screen.getAllByRole('button', { name: 'Đóng danh sách lựa chọn' }).at(-1)!);

    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it('keeps the desktop popover inside the viewport when the trigger is near the bottom edge', () => {
    vi.stubGlobal('innerWidth', 1000);
    vi.stubGlobal('innerHeight', 700);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function getRect(this: HTMLElement) {
      if (this.classList.contains('searchable-select__trigger')) {
        return DOMRect.fromRect({ x: 767, y: 579, width: 160, height: 44 });
      }
      if (this.classList.contains('searchable-select__popover')) {
        return DOMRect.fromRect({ x: 767, y: 629, width: 320, height: 356 });
      }
      return DOMRect.fromRect();
    });

    render(
      <SearchableSelect
        id="truckId"
        value=""
        onChange={() => {}}
        options={ROUTES}
        placeholder="Chọn biển số xe"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Chọn biển số xe/ }));

    const popover = screen.getByRole('dialog');
    expect(popover.parentElement).toBe(document.body);
    expect(popover.dataset.placement).toBe('top');
    expect(popover.style.getPropertyValue('--searchable-select-popover-max-height')).toBe('557px');
    expect(popover.style.getPropertyValue('--searchable-select-popover-top')).toBe('217px');
    expect(popover.style.getPropertyValue('--searchable-select-popover-left')).toBe('664px');
  });

  it('dismisses a desktop popover when scrolling moves its trigger out of view', () => {
    vi.stubGlobal('innerWidth', 1000);
    vi.stubGlobal('innerHeight', 700);
    let triggerTop = 300;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function getRect(this: HTMLElement) {
      if (this.classList.contains('searchable-select__trigger')) {
        return DOMRect.fromRect({ x: 400, y: triggerTop, width: 160, height: 44 });
      }
      if (this.classList.contains('searchable-select__popover')) {
        return DOMRect.fromRect({ x: 400, y: 350, width: 320, height: 356 });
      }
      return DOMRect.fromRect();
    });

    render(
      <SearchableSelect
        id="truckId"
        value=""
        onChange={() => {}}
        options={ROUTES}
        placeholder="Chọn biển số xe"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Chọn biển số xe/ }));
    expect(screen.getByRole('dialog')).toBeTruthy();

    triggerTop = -100;
    fireEvent.scroll(window);

    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('owns Escape while open instead of dismissing a parent editor', async () => {
    const onParentKeyDown = vi.fn();
    render(
      <div onKeyDown={onParentKeyDown}>
        <SearchableSelect
          id="routeId"
          value=""
          onChange={() => {}}
          options={ROUTES}
          searchPlaceholder="Tìm tuyến đường…"
        />
      </div>,
    );

    const trigger = screen.getByRole('button', { name: /Chọn một mục/ });
    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Escape' });

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onParentKeyDown).not.toHaveBeenCalled();
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it('uses a top-level mobile sheet that closes on selection, close, backdrop, and Escape', async () => {
    useMobileViewport();
    function ControlledSelect() {
      const [value, setValue] = useState('');
      return (
        <label htmlFor="routeId">
          Tuyến đường
          <SearchableSelect id="routeId" value={value} onChange={setValue} options={ROUTES} />
        </label>
      );
    }

    render(<ControlledSelect />);
    const trigger = screen.getByRole('button', { name: 'Tuyến đường' });
    expect(trigger.getAttribute('aria-haspopup')).toBe('dialog');
    fireEvent.click(trigger);
    expect(screen.getByRole('dialog').parentElement).toBe(document.body);
    fireEvent.click(screen.getByRole('option', { name: /Bản Bo/ }));
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(trigger));

    fireEvent.click(trigger);
    fireEvent.click(screen.getAllByRole('button', { name: 'Đóng danh sách lựa chọn' }).at(-1)!);
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(trigger));

    fireEvent.click(trigger);
    fireEvent.pointerDown(document.querySelector<HTMLElement>('.searchable-select__backdrop')!);
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(trigger));

    fireEvent.click(trigger);
    fireEvent.click(document.querySelector<HTMLElement>('.searchable-select__backdrop')!);
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(trigger));

    fireEvent.click(trigger);
    const closeButton = screen.getAllByRole('button', { name: 'Đóng danh sách lựa chọn' }).at(-1)!;
    closeButton.focus();
    fireEvent.keyDown(closeButton, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(trigger));

    fireEvent.click(trigger);
    const option = screen.getByRole('option', { name: /Bản Bo/ });
    option.focus();
    fireEvent.keyDown(option, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(trigger));
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

  it('does not show a clear item when the value is empty', () => {
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

    expect(screen.queryByRole('button', { name: 'Bỏ chọn' })).toBeNull();
  });

  it('clears the selected value via the "Bỏ chọn" item', () => {
    function ControlledSelect() {
      const [value, setValue] = useState('2');
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
    expect(screen.getByRole('button').textContent).toContain('Hải Phòng - Bản Bo, Lai Châu');

    fireEvent.click(screen.getByRole('button'));
    fireEvent.click(screen.getByRole('button', { name: 'Bỏ chọn' }));

    // After clearing, the trigger falls back to its placeholder.
    expect(screen.getByRole('button').textContent).not.toContain('Hải Phòng - Bản Bo');
    // And the popover closes.
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  it('hides the clear item when `clearable={false}`', () => {
    render(
      <SearchableSelect
        id="routeId"
        value="1"
        onChange={() => {}}
        options={ROUTES}
        searchPlaceholder="Tìm tuyến đường…"
        clearable={false}
      />,
    );

    fireEvent.click(screen.getByRole('button'));

    expect(screen.queryByRole('button', { name: 'Bỏ chọn' })).toBeNull();
  });

  it('keeps the clear item visible while the user is searching', () => {
    function ControlledSelect() {
      const [value, setValue] = useState('1');
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
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'ban' } });

    // The clear action must remain reachable even when the user is typing —
    // otherwise an unhelpful search could trap them in a chosen value.
    expect(screen.getByRole('button', { name: 'Bỏ chọn' })).toBeTruthy();
  });
});
