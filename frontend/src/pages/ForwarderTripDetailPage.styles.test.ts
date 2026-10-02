import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(process.cwd(), 'src/pages/ForwarderTripDetailPage.css'), 'utf8');

describe('forwarder order panel value visibility (card 20260922_49)', () => {
  it('never clamps or clips order-panel values — §4 wrap doctrine with no fallback needed', () => {
    const valueRule = css.match(/\.fwd-order-panel__body \.info-row__value\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(valueRule).not.toContain('-webkit-line-clamp');
    expect(valueRule).not.toContain('overflow: hidden');
    expect(valueRule).not.toContain('-webkit-box');
    expect(valueRule).toContain('overflow-wrap: anywhere');
  });
});
