import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from './errors';

// The transport self-heal: a 428 whose body carries VERSION_TOKEN_REQUIRED
// (no token was sent at all) triggers exactly one refetch-and-retry; clients
// that omit the token still save, explicit-token callers are untouched, and
// genuine conflicts never heal.

const fetchMock = vi.hoisted(() => vi.fn());


vi.stubGlobal('fetch', fetchMock);

import { api } from './client';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('api transport: version-token self-heal', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    api.setToken('test-token');
    vi.unstubAllEnvs();
  });

  afterEach(() => { api.clearToken(); vi.restoreAllMocks(); });

  it('heals a token-less 428: refetches the row and retries with the fresh token', async () => {
    vi.stubEnv('DEV', true);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    fetchMock
      .mockResolvedValueOnce(jsonResponse(428, { error: 'Thiếu phiên bản', code: 'VERSION_TOKEN_REQUIRED' }))
      .mockResolvedValueOnce(jsonResponse(200, { id: 39, updatedAt: '2026-09-14T10:00:00.000Z' }))
      .mockResolvedValueOnce(jsonResponse(200, { id: 39, baseSalary: 7654321 }));

    const result = await api.put('/drivers/39', { baseSalary: 7654321 });

    expect(result).toEqual({ id: 39, baseSalary: 7654321 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[0][1].method).toBe('PUT');
    expect(fetchMock.mock.calls[1][1].method).toBeUndefined();
    expect(fetchMock.mock.calls.every(([, init]) => init.headers.Authorization === 'Bearer test-token')).toBe(true);
    expect(fetchMock.mock.calls[0][1].headers['If-Unmodified-Since']).toBeUndefined();
    expect(String(fetchMock.mock.calls[2][1].headers['If-Unmodified-Since'])).toBe('2026-09-14T10:00:00.000Z');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('expectedUpdatedAt'));
    warn.mockRestore();
  });

  it('never heals when the caller sent an explicit token', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(428, { error: 'x', code: 'VERSION_TOKEN_REQUIRED' }));
    await expect(api.put('/drivers/39', {}, { expectedUpdatedAt: '2026-01-01T00:00:00.000Z' }))
      .rejects.toBeInstanceOf(ApiError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('never heals a genuine 409 conflict', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(409, { error: 'Da co nguoi luu truoc' }));
    await expect(api.put('/drivers/39', {})).rejects.toBeInstanceOf(ApiError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('surfaces the original 428 when the healed row fetch finds no updatedAt', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(428, { error: 'x', code: 'VERSION_TOKEN_REQUIRED' }))
      .mockResolvedValueOnce(jsonResponse(200, { id: 39 }));
    await expect(api.put('/drivers/39', {})).rejects.toBeInstanceOf(ApiError);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
