import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../lib/api';
import { tireClient } from './tireClient';

describe('tire lifecycle concurrency headers', () => {
  beforeEach(() => {
    api.clearToken();
    vi.restoreAllMocks();
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () =>
      new Response(JSON.stringify({
        id: 7,
        serial: 'TIRE-7',
        status: 'IN_USE',
        updatedAt: '2026-07-28T03:00:01.000Z',
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ));
  });

  afterEach(() => {
    api.clearToken();
  });

  it('sends the current tire version for every lifecycle mutation', async () => {
    const expectedUpdatedAt = '2026-07-28T03:00:00.000Z';

    await tireClient.install(7, { truckId: 3, position: 'FL' }, expectedUpdatedAt);
    await tireClient.transfer(7, { trailerId: 4, position: 'RL' }, expectedUpdatedAt);
    await tireClient.remove(7, expectedUpdatedAt);
    await tireClient.dispose(7, 'Mòn', expectedUpdatedAt);

    for (const [, init] of vi.mocked(fetch).mock.calls) {
      const headers = init?.headers as Record<string, string>;
      expect(headers['If-Unmodified-Since']).toBe(expectedUpdatedAt);
      expect(headers['Idempotency-Key']).toBeTruthy();
    }
  });
});
