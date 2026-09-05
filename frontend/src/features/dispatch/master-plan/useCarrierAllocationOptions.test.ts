import { renderHook, waitFor, act } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../../../api/tripClient', () => ({
  tripClient: { getBootstrap: vi.fn() },
}));

import { tripClient } from '../../../api/tripClient';
import { useCarrierAllocationOptions } from './useCarrierAllocationOptions';

const bootstrap = (externalCarriers: Array<{ id: number; name: string; isActive: boolean }>) => ({ externalCarriers });

beforeEach(() => {
  vi.mocked(tripClient.getBootstrap).mockReset();
});

describe('useCarrierAllocationOptions', () => {
  it('exposes OWN plus every active external carrier once bootstrap resolves', async () => {
    vi.mocked(tripClient.getBootstrap).mockResolvedValue(
      bootstrap([
        { id: 77, name: 'HÀ AN', isActive: true },
        { id: 88, name: 'Nam Phong', isActive: true },
      ]) as never,
    );

    const { result } = renderHook(() => useCarrierAllocationOptions());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe(false);
    expect(result.current.empty).toBe(false);
    expect(result.current.options.map((o) => o.key)).toEqual(['OWN', 'EXTERNAL:77', 'EXTERNAL:88']);
  });

  it('flags `empty` when bootstrap resolves with zero external carriers', async () => {
    vi.mocked(tripClient.getBootstrap).mockResolvedValue(bootstrap([]) as never);

    const { result } = renderHook(() => useCarrierAllocationOptions());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe(false);
    expect(result.current.empty).toBe(true);
    expect(result.current.options.map((o) => o.key)).toEqual(['OWN']);
  });

  it('flags `error` (not `empty`) when bootstrap rejects and reload re-fetches', async () => {
    vi.mocked(tripClient.getBootstrap).mockRejectedValueOnce(new Error('boom'));

    const { result } = renderHook(() => useCarrierAllocationOptions());

    await waitFor(() => expect(result.current.error).toBe(true));
    expect(result.current.empty).toBe(false);

    vi.mocked(tripClient.getBootstrap).mockResolvedValueOnce(
      bootstrap([{ id: 7, name: 'Biên Đông', isActive: true }]) as never,
    );
    act(() => result.current.reload());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe(false);
    expect(result.current.empty).toBe(false);
    expect(result.current.options.map((o) => o.key)).toEqual(['OWN', 'EXTERNAL:7']);
  });
});
