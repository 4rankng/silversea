import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Master audit 2026-11-27 P2-21 (/config/freight-rate-terms): a table inside
// a `.record-table-wrap--scroll` wrap has the WRAP as its sticky scrollport
// (overflow-x: auto promotes overflow-y to auto), so the shared negative
// --sticky-thead-top pinned the header 24px above the wrap's top edge and
// the wrap's overflow clipped it — multi-line headers read cut in half
// ("SẺ", "CHIỀU", "DẦU F", "(NGÀY)"). The scroll-wrapped tables pin flush at
// the wrap's top instead; dialog/modal tables (which never adopt the wrap)
// keep the -24px token law.
const css = readFileSync(resolve(process.cwd(), 'src/styles/record-table.css'), 'utf8');

describe('record-table sticky pin vs the --scroll wrap scrollport (master audit P2-21)', () => {
  it('keeps the app-body token law on the base rule', () => {
    const base = css.match(/\.record-table thead th\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(base).toMatch(/top:\s*var\(--sticky-thead-top,\s*-24px\)/);
    expect(base).toMatch(/position:\s*sticky/);
    expect(base).toMatch(/background:\s*var\(--surface-2\)/);
  });

  it('pins scroll-wrapped tables flush at the wrap top — never above it', () => {
    const rule = css.match(/\.record-table-wrap--scroll \.record-table thead th\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(rule, 'the scroll-wrap override exists').toBeTruthy();
    expect(rule).toMatch(/top:\s*0/);
    expect(rule).not.toMatch(/-24px/);
  });
});
