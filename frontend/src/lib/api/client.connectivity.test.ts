import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from './client';

const fetcher = vi.fn();
const json = () => new Response(JSON.stringify({ id: 1 }), { headers: { 'Content-Type': 'application/json' } });

describe('business requests without reachability probes (AC-CP-KT-22)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetcher);
    fetcher.mockReset();
    api.setToken('local-test-token');
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
  });
  afterEach(() => { api.clearToken(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

  it('sends a mutation despite the browser connectivity hint', async () => {
    fetcher.mockResolvedValueOnce(json());
    await expect(api.post('/expenses', { amount: 500000 })).resolves.toEqual({ id: 1 });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toBe('/api/expenses');
  });

  it.each(['blob', 'text'] as const)('attempts a %s export and surfaces its API error', async kind => {
    fetcher.mockResolvedValueOnce(new Response('Temporarily unavailable', { status: 503 }));
    const request = kind === 'blob' ? api.postForBlob('/export', {}) : api.postForText('/export', {});
    await expect(request).rejects.toMatchObject({ status: 503 });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toBe('/api/export');
  });

  it('keeps the same command key on explicit retry after an unknown outcome', async () => {
    vi.useFakeTimers();
    fetcher.mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce(json());
    await expect(api.post('/expenses', { amount: 500000 })).rejects.toThrow('Failed to fetch');
    await vi.advanceTimersByTimeAsync(6 * 60 * 1000);
    await api.post('/expenses', { amount: 500000 });
    const keys = fetcher.mock.calls.map(([, init]) => init.headers['Idempotency-Key']);
    expect(keys[0]).toBeTruthy();
    expect(keys[1]).toBe(keys[0]);
  });

  it('neither probes nor replays a failed mutation after reconnect or elapsed time', async () => {
    vi.useFakeTimers();
    fetcher.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(api.post('/expenses', { amount: 500000 })).rejects.toThrow();
    window.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(90000);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toBe('/api/expenses');
  });
});
