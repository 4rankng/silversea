import { renderHook, waitFor, act } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../../../api/dispatchPlanningClient', () => ({
  listDispatchFleetResources: vi.fn(),
}));

import { listDispatchFleetResources } from '../../../api/dispatchPlanningClient';
import { useCarrierAllocationOptions } from './useCarrierAllocationOptions';

const fleet = (items: Array<{ id: number; name: string; fullName?: string; isActive: boolean }>) => ({
  items,
  total: items.length,
  limit: 100,
  nextCursor: null,
});

beforeEach(() => {
  vi.mocked(listDispatchFleetResources).mockReset();
});

describe('useCarrierAllocationOptions', () => {
  it('exposes OWN plus every active external carrier from the unified fleet endpoint (SIL-1057)', async () => {
    vi.mocked(listDispatchFleetResources).mockResolvedValue(fleet([
      { id: 77, name: 'HÀ AN', isActive: true },
      { id: 88, name: 'Nam Phong', isActive: true },
    ]) as never);

    const { result } = renderHook(() => useCarrierAllocationOptions());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe(false);
    expect(result.current.empty).toBe(false);
    expect(result.current.options.map((o) => o.key)).toEqual(['OWN', 'EXTERNAL:77', 'EXTERNAL:88']);
    // ONE endpoint for all four điểm chọn nhà xe (SIL-1057) — the same
    // EXTERNAL_CARRIER catalog the dispatch-detail editor searches.
    expect(vi.mocked(listDispatchFleetResources)).toHaveBeenCalledWith('EXTERNAL_CARRIER', { limit: 100 });
  });

  it('carries the full legal name as searchText when it differs from the operational label', async () => {
    vi.mocked(listDispatchFleetResources).mockResolvedValue(fleet([
      { id: 77, name: 'KHÁCH TỰ VC', fullName: 'CÔNG TY TNHH KHÁCH TỰ VC', isActive: true },
      { id: 88, name: 'Nam Phong', fullName: 'Nam Phong', isActive: true },
      { id: 99, name: 'DH-BẮC NINH', isActive: true },
    ]) as never);

    const { result } = renderHook(() => useCarrierAllocationOptions());

    await waitFor(() => expect(result.current.loading).toBe(false));
    const optionByKey: Record<string, (typeof result.current.options)[number]> = {};
    for (const option of result.current.options) optionByKey[option.key] = option;
    expect(optionByKey['EXTERNAL:77']?.searchText).toBe('CÔNG TY TNHH KHÁCH TỰ VC');
    // Identical projections carry no duplicate searchText.
    expect(optionByKey['EXTERNAL:88']?.searchText).toBeUndefined();
    expect(optionByKey['EXTERNAL:99']?.searchText).toBeUndefined();
  });

  it('flags `empty` when the catalog resolves with zero external carriers', async () => {
    vi.mocked(listDispatchFleetResources).mockResolvedValue(fleet([]) as never);

    const { result } = renderHook(() => useCarrierAllocationOptions());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe(false);
    expect(result.current.empty).toBe(true);
    expect(result.current.options.map((o) => o.key)).toEqual(['OWN']);
  });

  it('flags `error` (not `empty`) when the fetch rejects and reload re-fetches', async () => {
    vi.mocked(listDispatchFleetResources).mockRejectedValueOnce(new Error('boom'));

    const { result } = renderHook(() => useCarrierAllocationOptions());

    await waitFor(() => expect(result.current.error).toBe(true));
    expect(result.current.empty).toBe(false);

    vi.mocked(listDispatchFleetResources).mockResolvedValueOnce(
      fleet([{ id: 7, name: 'Biên Đông', isActive: true }]) as never,
    );
    act(() => result.current.reload());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe(false);
    expect(result.current.empty).toBe(false);
    expect(result.current.options.map((o) => o.key)).toEqual(['OWN', 'EXTERNAL:7']);
  });
});
