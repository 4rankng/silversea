import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// SIL-1196/SIL-1197 (QA wave a8f059c0) — /ops/fleet-tracking: MAIN.app-body
// is the page's single vertical scroller. The old max-height pane owned the
// scrolling and moved wholesale under the page wheel while the sticky thead
// resolved against it — the header left with the page. The wrapper now clips
// horizontally only (overflow-x: clip is not a scroll container), so the
// thead pins against .app-body flush under the topbar through the shared
// --sticky-thead-top negation, and the plate td keeps table-cell layout so
// its divider spans the full row height.
const css = readFileSync(resolve(process.cwd(), 'src/pages/OpsFleetTrackingPage.css'), 'utf8');

function ruleBody(selector: string, source = css): string {
  const pattern = new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`);
  const match = source.match(pattern);
  expect(match, `expected a rule for ${selector}`).toBeTruthy();
  return match![1];
}

describe('OpsFleetTrackingPage — the document is the single vertical scroller (SIL-1197)', () => {
  it('clips horizontally without ever becoming a scroll container', () => {
    const scroll = ruleBody('.ops-fleet__scroll').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(scroll).toMatch(/overflow-x:\s*clip/);
    expect(scroll).toMatch(/overflow-y:\s*visible/);
    expect(scroll).not.toMatch(/overflow:\s*auto/);
    expect(scroll).not.toMatch(/max-height/);
    expect(scroll).toMatch(/container-type:\s*inline-size/);
  });

  it('pins the opaque header band flush under the topbar', () => {
    const band = css.slice(css.indexOf('@container (min-width: 701px)'));
    expect(band).toMatch(/\.ops-fleet \.ops-fleet__table thead th\s*\{\s*position:\s*sticky;\s*top:\s*var\(--sticky-thead-top, -24px\);\s*z-index:\s*3;\s*background:\s*var\(--surface-2\);\s*border-bottom:\s*1px solid var\(--line-strong\);\s*\}/);
    // Corner radii ride the pinned th so the header never pokes past the
    // pane's rounded top corners at rest.
    expect(band).toMatch(/\.ops-fleet \.ops-fleet__table thead th:first-child \{ border-top-left-radius: 12px; \}/);
    expect(band).toMatch(/\.ops-fleet \.ops-fleet__table thead th:last-child \{ border-top-right-radius: 12px; \}/);
  });

  it('never pins a first column against a scrollport the page does not have', () => {
    expect(css).not.toMatch(/position:\s*sticky;\s*\n\s*left:\s*0/);
    expect(css).not.toMatch(/tbody td:first-child\s*\{\s*(?:position:\s*sticky;)?[^}]*border-right/);
  });

  it('never uses a box-shadow seam — the global flat-surface reset nulls them', () => {
    const band = css.slice(css.indexOf('@container (min-width: 701px)'));
    expect(band).not.toMatch(/box-shadow/);
  });
});

describe('OpsFleetTrackingPage — the plate td keeps table-cell layout (SIL-1196)', () => {
  it('never overrides the plate cell display off the table-cell axis', () => {
    const plate = ruleBody('.ops-fleet__plate').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(plate).not.toMatch(/display:\s*(?:inline-flex|flex|block)/);
    expect(plate).toMatch(/white-space:\s*nowrap/);
  });
});
