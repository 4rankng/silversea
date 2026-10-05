// Card 368 — text/blob endpoints must surface normalized errors, never raw
// response bodies. ApiError.fromResponse already normalizes (card 348); the
// four text/blob paths in client.ts bypassed it and leaked the raw body as
// err.message (HTML error pages reached the UI through the card-367 surfaces).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from './client';
import { ApiError } from './errors';

const fetcher = vi.fn();

const callShapes = [
  ['getForText', () => api.getForText('/export.html')],
  ['getBlob', () => api.getBlob('/export.xlsx')],
  ['postForText', () => api.postForText('/export', {})],
  ['postForBlob', () => api.postForBlob('/export', {})],
] as const;

describe('text/blob endpoints surface normalized errors (card 368)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetcher);
    fetcher.mockReset();
    api.setToken('local-test-token');
  });
  afterEach(() => { api.clearToken(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it.each(callShapes)('%s: a 502 HTML body yields a status-aware message, never the raw page', async (_name, call) => {
    fetcher.mockResolvedValueOnce(new Response('<html><body>Bad Gateway</body></html>', {
      status: 502,
      headers: { 'content-type': 'text/html' },
    }));
    const err = await call().then(() => null, (e: unknown) => (e instanceof ApiError ? e : null));
    expect(err).toBeInstanceOf(ApiError);
    expect(err!.status).toBe(502);
    expect(err!.message).toContain('502');
    expect(err!.message).not.toContain('<html');
    expect(err!.message).not.toContain('<body');
  });

  it.each(callShapes)('%s: a JSON error body on the wire keeps its precise reason', async (_name, call) => {
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Mã đã tồn tại.' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    }));
    const err = await call().then(() => null, (e: unknown) => (e instanceof ApiError ? e : null));
    expect(err).toBeInstanceOf(ApiError);
    expect(err!.status).toBe(400);
    expect(err!.message).toBe('Mã đã tồn tại.');
  });
});
