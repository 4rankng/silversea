import { describe, expect, it } from 'vitest';
import { isTokenExpired } from './useAuth';

// 2100-01-01 — comfortably in the future for any test run.
const FUTURE_EXP = 4_102_444_800;

/** Encode a payload the way the backend signs JWTs: UTF-8 bytes → base64URL
 *  (—/_ alphabet, padding stripped). */
function makeJwt(payload: Record<string, unknown>): string {
  const json = JSON.stringify(payload);
  const base64 = btoa(String.fromCharCode(...new TextEncoder().encode(json)));
  const segment = base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `eyJhbGciOiJIUzI1NiJ9.${segment}.sig`;
}

describe('isTokenExpired', () => {
  it('accepts a base64URL payload with a future exp', () => {
    // '???' base64-encodes to 'Pz8/', so the segment provably uses the
    // URL-safe alphabet ('_' after conversion) — the exact input raw atob
    // used to throw on (the cold-boot logout bug).
    const token = makeJwt({ sub: '???', exp: FUTURE_EXP });
    expect(token.split('.')[1]).toMatch(/[-_]/);
    expect(isTokenExpired(token)).toBe(false);
  });

  it('decodes UTF-8 payloads without throwing', () => {
    const token = makeJwt({ sub: 'Nguyễn Văn A', role: 'DISPATCHER', exp: FUTURE_EXP });
    expect(isTokenExpired(token)).toBe(false);
  });

  it('flags a past exp as expired', () => {
    expect(isTokenExpired(makeJwt({ sub: 'x', exp: 1 }))).toBe(true);
  });

  it('treats a payload without exp as not expired', () => {
    expect(isTokenExpired(makeJwt({ sub: 'x' }))).toBe(false);
  });

  it('rejects malformed tokens', () => {
    expect(isTokenExpired('not-a-jwt')).toBe(true);
    expect(isTokenExpired('a.!!!.b')).toBe(true);
  });
});
