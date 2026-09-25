import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Card 20260925_6 — site-wide pairing sweep (date Từ/Đến pair on
 * /shipments/containers). The two `BufferedUuiDateInput`s used to be
 * two independent children of the shared `<ListFilterBar>` flex row.
 * At ≥1280px viewport the date inputs floated up beside the selects as
 * two separate cells (Từ cell, then Đến cell), each carrying its own
 * "Từ ngày vận chuyển" / "Đến ngày vận chuyển" label that overflowed
 * the right edge, with `rect.top` deltas >2px against the label baseline
 * of the selects. The fix: the two date inputs are ONE logical flex
 * item — one shared label, one row of two inputs separated by an arrow,
 * sharing the bar's surface and baseline with the selects.
 */

const css = readFileSync(resolve(process.cwd(), 'src/pages/ShipmentContainersPage.css'), 'utf8');
const source = readFileSync(resolve(process.cwd(), 'src/pages/ShipmentContainersPage.tsx'), 'utf8');

describe('ShipmentContainersPage date-pair / group filter (card 20260925_6)', () => {
  it('the pair is ONE logical flex item — both BufferedUuiDateInputs are inside one pair wrapper', () => {
    // Locate the ListFilterBar tree and assert the two date inputs are
    // not direct siblings of UuiSelectField / presets.
    const barStart = source.indexOf('<ListFilterBar');
    const fromIdx = source.indexOf('shipments-detail-filter--from', barStart);
    const toIdx = source.indexOf('shipments-detail-filter--to', barStart);
    expect(fromIdx).toBeGreaterThan(barStart);
    expect(toIdx).toBeGreaterThan(fromIdx);
    // The pair wrapper sits between barStart and fromIdx so both inputs
    // share one parent.
    const pairStart = source.indexOf('shipments-detail-filters__date-pair"', barStart);
    expect(pairStart, 'pair wrapper missing').toBeGreaterThan(0);
    expect(pairStart).toBeLessThan(fromIdx);
    expect(toIdx).toBeLessThan(source.indexOf('</ListFilterBar'));
  });

  it('the pair is content-sized — one flex item, not flex-grow', () => {
    // flex: 0 1 auto + width: auto keeps the pair inside its own column,
    // it does not stretch to the row width like a date-input wrapper would.
    expect(css).toMatch(/\.shipments-detail-filters__date-pair\s*\{[^}]*flex:\s*0 1 auto;[^}]*width:\s*auto;/);
  });

  it('flat chrome — no elevated panel chrome on the pair', () => {
    // No background, no shadow, no border, no border-radius on the pair
    // shell. The pair rides the bar surface like every other control.
    const pairBlock = css.match(/\.shipments-detail-filters__date-pair\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(pairBlock).not.toMatch(/background/);
    expect(pairBlock).not.toMatch(/box-shadow/);
    expect(pairBlock).not.toMatch(/border/);
    expect(pairBlock).not.toMatch(/border-radius/);
  });

  it('the internal row is a 2-col grid with an arrow separator', () => {
    expect(css).toMatch(/\.shipments-detail-filters__date-pair-row\s*\{[^}]*display:\s*grid;/);
    expect(css).toMatch(/\.shipments-detail-filters__date-pair-row\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto\s+minmax\(0,\s*1fr\);/);
    expect(css).toMatch(/\.shipments-detail-filters__date-pair-sep\s*\{[^}]*color:\s*var\(--ink-4\)/);
  });

  it('one shared label sits above the row, not two stacked labels', () => {
    // The source uses a single labelled span; the per-input
    // `label="Từ ngày vận chuyển"` and `label="Đến ngày vận chuyển"`
    // strings (the old ones) are gone in favor of compact Từ / Đến.
    expect(source).toContain('Từ ngày — Đến ngày vận chuyển');
    expect(source).not.toContain('label="Từ ngày vận chuyển"');
    expect(source).not.toContain('label="Đến ngày vận chuyển"');
  });

  it('phones stretch the pair to the full bar width and hide the separator', () => {
    expect(css).toMatch(/@media \(max-width:\s*760px\)\s*\{[\s\S]*?\.shipments-detail-filters__date-pair\s*\{[^}]*flex:\s*1 1 100%;[^}]*width:\s*100%;/);
    expect(css).toMatch(/@media \(max-width:\s*760px\)\s*\{[\s\S]*?\.shipments-detail-filters__date-pair-sep\s*\{[^}]*display:\s*none;/);
  });
});
