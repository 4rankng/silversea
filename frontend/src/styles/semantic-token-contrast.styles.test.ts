import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(process.cwd(), 'src/styles/tokens.css'), 'utf8');

function hexToRgb(hex: string): [number, number, number] {
  const value = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16)) as [number, number, number];
}
function relativeLuminance([r, g, b]: [number, number, number]): number {
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}
function contrastOnWhite(hex: string): number {
  const l = relativeLuminance(hexToRgb(hex));
  return (1.05) / (l + 0.05);
}

// Card 20260922_25: status badges rendered var(--ok, #16a34a) — the token was
// never declared, so the 3.3:1 light fallback shipped. Both success text
// tokens must exist and clear WCAG AA (>= 4.5:1) on the white surfaces.
describe('semantic status token contrast contract', () => {
  it('declares --ok (aliased to the dark success-text token)', () => {
    expect(css).toMatch(/--ok:\s*var\(--success-text\)/);
  });

  it('keeps the success text tokens at AA contrast on white', () => {
    const dark = css.match(/--success-text:\s*(#[0-9A-Fa-f]{6})/)?.[1];
    expect(dark).toBeTruthy();
    expect(contrastOnWhite(dark!)).toBeGreaterThanOrEqual(4.5);
    const base = css.match(/--success:\s*(#[0-9A-Fa-f]{6})/)?.[1];
    expect(base).toBeTruthy();
    expect(contrastOnWhite(base!)).toBeGreaterThanOrEqual(4.5);
  });

  it('SIL-567: ensures --ink-2 clears 4.5:1 floor on --surface-3 chips and components use --ink-2', () => {
    const ink2 = css.match(/--ink-2:\s*(#[0-9A-Fa-f]{6})/)?.[1] ?? '';
    const surface3 = css.match(/--surface-3:\s*(#[0-9A-Fa-f]{6})/)?.[1] ?? '';
    expect(ink2).toBeTruthy();
    expect(surface3).toBeTruthy();

    const lumInk2 = relativeLuminance(hexToRgb(ink2));
    const lumSurface3 = relativeLuminance(hexToRgb(surface3));
    const ratio = (lumSurface3 + 0.05) / (lumInk2 + 0.05);
    expect(ratio).toBeGreaterThanOrEqual(4.5);

    const tripTableCss = readFileSync(resolve(process.cwd(), 'src/pages/trip-list/table.css'), 'utf8');
    expect(tripTableCss).toMatch(/\.trip-list-page\s+\.plate\.idle\s*\{[^}]*color:\s*var\(--ink-2\)/);

    const expenseTableCss = readFileSync(resolve(process.cwd(), 'src/pages/ExpenseListRecordTable.css'), 'utf8');
    expect(expenseTableCss).toMatch(/\.expense-record-table__entry-badge\s*\{[^}]*color:\s*var\(--ink-2\)/);

    const debtCss = readFileSync(resolve(process.cwd(), 'src/pages/DebtListPage.css'), 'utf8');
    expect(debtCss).toMatch(/\.debt-band__chip\s*\{[^}]*color:\s*var\(--ink-2\)/);

    const fleetCss = readFileSync(resolve(process.cwd(), 'src/pages/FleetPage.css'), 'utf8');
    expect(fleetCss).toMatch(/\.fleet-page\s+\.fleet-type-chip\.unknown\s*\{[^}]*color:\s*var\(--ink-2\)/);

    const penaltyCss = readFileSync(resolve(process.cwd(), 'src/pages/penalty/violation-log.css'), 'utf8');
    expect(penaltyCss).toMatch(/\.penalty-quiet-chip\s*\{[^}]*color:\s*var\(--ink-2\)/);
    expect(penaltyCss).toMatch(/\.penalty-rank\s*\{[^}]*color:\s*var\(--ink-2\)/);
    expect(penaltyCss).toMatch(/\.penalty-chip\s+\.count\s*\{[^}]*color:\s*var\(--ink-2\)/);

    const auditCss = readFileSync(resolve(process.cwd(), 'src/pages/AuditLogPage.css'), 'utf8');
    expect(auditCss).toMatch(/\.audit-method--GET\s*\{[^}]*color:\s*var\(--ink-2\)/);
  });
});
