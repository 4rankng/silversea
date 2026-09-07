import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { fetchPlaceSuggestions } from '../lib/maps';
import { LocationAutocomplete } from './LocationAutocomplete';

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
