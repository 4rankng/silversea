import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Card 20261004_338 (law book §4 no-truncation doctrine, card 20260922_37):
// the e-POD file name used to carry the truncate+tooltip idiom —
// `overflow: hidden; text-overflow: ellipsis; white-space: nowrap` on
// `.trip-pod__file-name` with a `title={file.originalFileName}` hover crutch,
// justified by an §11 anti-pattern comment ("the full name is still available
// via the title attribute"). File names are WRAPPING text: the full name must
// display at every width — no ellipsis, no title crutch. Long unbroken name
// runs (e.g. YARD_OR_DROP_RECEIPT) need the house emergency break.

const css = readFileSync(resolve(process.cwd(), 'src/components/trip/TripPodSubmission.css'), 'utf8');
const tsx = readFileSync(resolve(process.cwd(), 'src/components/trip/TripPodSubmission.tsx'), 'utf8');

const rule = (source: string, selector: string): string => {
  const found = source.match(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^{]*\\{([^}]*)\\}`))?.[1];
  expect(found, `${selector} rule exists`).toBeTruthy();
  return found!;
};

const CLIP = /text-overflow:\s*ellipsis/;
const CLIP_HIDDEN = /overflow:\s*hidden/;
const CLAMP = /-webkit-line-clamp/;

describe('trip-pod file name wraps in full (card 20261004_338)', () => {
  it('the file-name rule wraps; every truncation idiom is gone', () => {
    const body = rule(css, '.trip-pod__file-name');
    expect(body).not.toMatch(CLIP);
    expect(body).not.toMatch(CLIP_HIDDEN);
    expect(body).not.toMatch(CLAMP);
    expect(body).toMatch(/white-space:\s*normal/);
    expect(body).toMatch(/overflow-wrap:\s*anywhere/);
  });

  it('the rule carries no truncation-justifying §11 comment', () => {
    // The old comment rationalized the ellipsis + title crutch ("the full name
    // is still available via the title attribute") — a §11 anti-pattern, not a
    // license. Neither the comment nor its claim may survive the fix.
    const start = css.indexOf('.trip-pod__file-name {');
    expect(start).toBeGreaterThanOrEqual(0);
    const block = css.slice(start, css.indexOf('}', start));
    expect(block).not.toMatch(/truncate/i);
    expect(block).not.toMatch(/title attribute/i);
  });

  it('the rendered file-name span carries no title crutch and shows the full name', () => {
    const span = tsx.match(/<span className="trip-pod__file-name"[\s\S]*?<\/span>/)?.[0];
    expect(span, 'the file-name span still renders').toBeTruthy();
    expect(span!).not.toMatch(/<span[^>]*\btitle=/);
    expect(span!).toContain('>{file.originalFileName}</span>');
    expect(span!).not.toMatch(/slice|substring|truncate|ellipsis/i);
  });
});
