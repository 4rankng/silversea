import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Card 20261004_338 (law book §4 no-truncation doctrine, card 20260922_37):
// the tag-manager row label used to carry the truncate+tooltip idiom —
// `overflow: hidden; text-overflow: ellipsis; white-space: nowrap` on
// `.dispatch-tag-manager__label` (DispatchPlanEditorCell.css) with a
// `title={tag.label}` hover crutch (DispatchTaskTagManagerPopover.tsx). A tag
// label is WRAPPING text: it must display in full at every popover width —
// no ellipsis, no title crutch.

const css = readFileSync(resolve(import.meta.dirname, 'DispatchPlanEditorCell.css'), 'utf8');
const tsx = readFileSync(resolve(import.meta.dirname, 'DispatchTaskTagManagerPopover.tsx'), 'utf8');

const rule = (source: string, selector: string): string => {
  const found = source.match(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^{]*\\{([^}]*)\\}`))?.[1];
  expect(found, `${selector} rule exists`).toBeTruthy();
  return found!;
};

const CLIP = /text-overflow:\s*ellipsis/;
const CLIP_HIDDEN = /overflow:\s*hidden/;
const CLAMP = /-webkit-line-clamp/;

describe('dispatch tag-manager label wraps in full (card 20261004_338)', () => {
  it('the label rule wraps; every truncation idiom is gone', () => {
    const body = rule(css, '.dispatch-tag-manager__label');
    expect(body).not.toMatch(CLIP);
    expect(body).not.toMatch(CLIP_HIDDEN);
    expect(body).not.toMatch(CLAMP);
    expect(body).toMatch(/white-space:\s*normal/);
    expect(body).toMatch(/overflow-wrap:\s*anywhere/);
  });

  it('the rendered label span carries no title crutch and shows the full label', () => {
    const span = tsx.match(/<span className="dispatch-tag-manager__label"[\s\S]*?<\/span>/)?.[0];
    expect(span, 'the label span still renders').toBeTruthy();
    expect(span!).not.toMatch(/<span[^>]*\btitle=/);
    expect(span!).toContain('>{tag.label}</span>');
    expect(span!).not.toMatch(/slice|substring|truncate|ellipsis/i);
  });
});
