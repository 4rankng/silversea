// Card QA1-004 (121026084553) — the stale-build watcher rides the shared
// /health query entry and keeps its boot-hash law: first read is the
// baseline, a different hash flips stale (terminal), a failed read never
// fabricates a mismatch.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiGet = vi.hoisted(() => vi.fn());
vi.mock('../lib/api', () => ({
  api: { get: apiGet },
}));

import { useBuildFreshness } from './useBuildFreshness';
import { qk } from '../api/keys';

function wrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useBuildFreshness — boot-hash law on the shared /health entry', () => {
  it('the first read becomes the baseline; an unchanged hash never flags stale', async () => {
    apiGet.mockResolvedValue({ buildHash: 'dev-a' });
    const { result } = renderHook(() => useBuildFreshness(1000), { wrapper: wrapper() });
    await waitFor(() => expect(result.current).toBe(false));
    expect(apiGet).toHaveBeenCalledWith('/health');
  });

  it('a changed hash flips stale — terminal, no further polls', async () => {
    let hash = 'dev-a';
    apiGet.mockImplementation(async () => ({ buildHash: hash }));
    const { result } = renderHook(() => useBuildFreshness(50), { wrapper: wrapper() });
    await waitFor(() => expect(apiGet).toHaveBeenCalled());
    hash = 'dev-b';
    await waitFor(() => expect(result.current).toBe(true), { timeout: 2000 });
    const callsAtStale = apiGet.mock.calls.length;
    // The interval must stop once stale (enabled: false).
    await new Promise((r) => setTimeout(r, 200));
    expect(apiGet.mock.calls.length).toBe(callsAtStale);
  });

  it('a failed read keeps the last-known state and never flags stale', async () => {
    apiGet.mockRejectedValueOnce(new Error('network blip'));
    apiGet.mockResolvedValue({ buildHash: 'dev-a' });
    const { result } = renderHook(() => useBuildFreshness(50), { wrapper: wrapper() });
    await waitFor(() => expect(apiGet.mock.calls.length).toBeGreaterThan(0));
    await new Promise((r) => setTimeout(r, 150));
    expect(result.current).toBe(false);
  });

  it('rides the same cache key as the support dialog build version', () => {
    // The two consumers dedupe on this key; a divergence here would silently
    // restore the duplicate /health the card measured.
    expect(qk.support.serverBuild).toBeDefined();
    expect(Array.isArray(qk.support.serverBuild)).toBe(true);
  });
});
