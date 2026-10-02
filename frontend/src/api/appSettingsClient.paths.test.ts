import { afterEach, describe, expect, it, vi } from 'vitest';

import { appSettingsClient } from './appSettingsClient';

/**
 * KP-147 moved the financial-reporting policy save from POST
 * `.../policy/requests` to POST `.../policy` ("request endpoint removed —
 * policy applies immediately"). The client must post to the live endpoint —
 * the stale `/requests` path is what produced the global-404 body
 * 'Không tìm thấy API' on the app-settings save flow.
 */
describe('appSettingsClient financial-reporting policy paths', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('posts the policy save to the live KP-147 endpoint, not the retired /requests path', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify({ status: 'applied', publicVersion: 2 }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      });
    }));

    await appSettingsClient.requestFinancialReportingPolicy({
      expectedPublicVersion: '2026-09-01T00:00:00.000Z',
      effectiveFrom: '2026-12-01',
      lowMarginThresholdPercent: 20,
    });

    const post = calls.find((call) => call.init.method === 'POST');
    expect(post).toBeTruthy();
    expect(post!.url).toContain('/admin/app-settings/financial-reporting/policy');
    expect(post!.url).not.toContain('/requests');
  });
});
