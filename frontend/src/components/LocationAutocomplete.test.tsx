import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useRef, useState } from 'react';
import { fetchPlaceSuggestions } from '../lib/maps';
import { LocationAutocomplete } from './LocationAutocomplete';
import { useClickOutside } from '../hooks/useClickOutside';
import { isOverlayOpen } from '../lib/overlayState';

vi.mock('../lib/maps', () => ({
  fetchPlaceSuggestions: vi.fn(async () => []),
}));

vi.mock('../api/configClient', () => ({
  configClient: {
    getPorts: vi.fn(async () => [
      { id: 1, name: 'Cảng Hải Phòng', code: 'HPH', city: 'Hải Phòng' },
      { id: 2, 'name': 'Bãi xe Lạch Huyện', code: 'LH', city: 'Hải Phòng' },
      { id: 3, name: 'ICD Quế Võ', code: 'QV', city: 'Bắc Ninh' },
    ] as never),
  },
}));

const fetchPlacesMock = vi.mocked(fetchPlaceSuggestions);

function Harness({ initial }: { initial?: string }) {
  const [value, setValue] = useState(initial ?? '');
  return <LocationAutocomplete value={value} onChange={setValue} />;
}

function renderAuto(initial?: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <Harness initial={initial} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  fetchPlacesMock.mockClear();
  fetchPlacesMock.mockResolvedValue([]);
});

describe('LocationAutocomplete', () => {
  it('does not claim an open overlay while its mounted input is closed', () => {
    const { unmount } = renderAuto();
    expect(screen.getByRole('textbox')).toBeTruthy();
    expect(screen.queryByText('Cảng Hải Phòng')).toBeNull();
    expect(isOverlayOpen()).toBe(false);
    unmount();
    expect(isOverlayOpen()).toBe(false);
  });

  it('activates above a later parent and releases only the topmost layer on Escape', async () => {
    function LayerHarness() {
      const [open, setOpen] = useState(false);
      const [value, setValue] = useState('');
      const parentRef = useRef<HTMLDivElement>(null);
      useClickOutside(parentRef, () => setOpen(false), { enabled: open, escapeKey: true });
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>Mở hành trình</button>
          <div ref={parentRef} hidden={!open}>
            {open && <span>Hành trình đang mở</span>}
            <LocationAutocomplete value={value} onChange={setValue} ariaLabel="Địa điểm hành trình" />
          </div>
        </>
      );
    }
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { unmount } = render(
      <QueryClientProvider client={queryClient}>
        <LayerHarness />
      </QueryClientProvider>,
    );

    for (let opening = 0; opening < 2; opening += 1) {
      fireEvent.click(screen.getByRole('button', { name: 'Mở hành trình' }));
      const input = screen.getByRole('textbox', { name: 'Địa điểm hành trình' });
      act(() => input.focus());
      // Contention-budgeted waits (card 20261010_1): the debounced facet
      // search resolved in 1.4-2.7s in full-suite runs under machine load
      // 46-80, past the 1s findBy/waitFor default. 4s clears the worst
      // observed resolution while staying under the 5s test budget; the
      // assertions themselves are unchanged.
      await screen.findByText('Cảng Hải Phòng', {}, { timeout: 4000 });
      // Flush the combobox's overlay-token registration effect before the
      // first Escape: the options can render a tick before the enabled isOpen
      // effect registers the dropdown's token, and an early Escape then finds
      // the parent topmost and closes the wrong layer (card 20261010_1).
      await act(async () => {});
      fireEvent.keyDown(document.body, { key: 'Escape' });
      await waitFor(() => expect(screen.queryByText('Cảng Hải Phòng')).toBeNull(), { timeout: 4000 });
      expect(screen.getByText('Hành trình đang mở')).toBeTruthy();
      expect(document.activeElement).toBe(input);
      expect(isOverlayOpen()).toBe(true);

      fireEvent.keyDown(document.body, { key: 'Escape' });
      expect(screen.queryByText('Hành trình đang mở')).toBeNull();
      expect(isOverlayOpen()).toBe(false);
      act(() => input.blur());
    }
    unmount();
    expect(isOverlayOpen()).toBe(false);
  });

  it('shows port suggestions with the CẢNG/BÃI badge and selects on click', async () => {
    renderAuto();
    const input = screen.getByRole('textbox');
    fireEvent.focus(input);
    await screen.findByText('Cảng Hải Phòng');
    expect(screen.getAllByText('CẢNG/BÃI').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByText('Cảng Hải Phòng'));
    // Selecting is deferred until the parent re-renders with the new value.
    await waitFor(() => expect((input as HTMLInputElement).value).toBe('Cảng Hải Phòng'));
  });

  it('renders Google Places suggestions without the badge', async () => {
    fetchPlacesMock.mockResolvedValue([
      { description: 'Số 1 Đại lộ Bản Vẽ', placeId: 'p1' },
    ] as never);
    renderAuto();
    const input = screen.getByRole('textbox');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'đại lộ' } });
    await screen.findByText('Số 1 Đại lộ Bản Vẽ');
    const badges = screen.queryAllByText('CẢNG/BÃI');
    expect(badges.length).toBe(0);
  });

  it('skips Places fetch below 3 chars and fires after debounce above it', async () => {
    renderAuto();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'ha' } });
    await waitFor(() => expect(fetchPlacesMock).not.toHaveBeenCalled());
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'hai phong' } });
    await waitFor(() => expect(fetchPlacesMock).toHaveBeenCalledWith('hai phong', expect.any(String)), { timeout: 1500 });
  });
});
