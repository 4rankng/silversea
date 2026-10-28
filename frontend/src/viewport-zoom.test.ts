import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');
const viewport = html.match(/<meta name="viewport" content="([^"]*)"\s*\/>/)?.[1] ?? '';

describe('viewport meta — WCAG 1.4.4 zoom availability (SIL-557)', () => {
  it('renders without zoom-lock attributes so pinch/browser zoom stays available', () => {
    expect(viewport).not.toBe('');
    expect(viewport).not.toContain('maximum-scale');
    expect(viewport).not.toContain('user-scalable');
  });

  it('keeps responsive width, initial scale and safe-area fit', () => {
    expect(viewport).toContain('width=device-width');
    expect(viewport).toContain('initial-scale=1');
    expect(viewport).toContain('viewport-fit=cover');
  });
});
