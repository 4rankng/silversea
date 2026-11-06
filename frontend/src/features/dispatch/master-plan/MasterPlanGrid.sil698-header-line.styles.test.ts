import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(process.cwd(), 'src/features/dispatch/master-plan/MasterPlanGrid.css'), 'utf8');
const tsx = readFileSync(resolve(process.cwd(), 'src/features/dispatch/master-plan/MasterPlanGrid.tsx'), 'utf8');

/**
 * SIL-698 (id 810, QA 06/11) — the master-plan board ("Kế hoạch Tổng quát",
 * the dispatch OVERVIEW the ticket names) wrapped three compound headers to
 * two lines at 1440px: THỜI GIAN & LỊCH TRÌNH, TUYẾN ĐƯỜNG & HÃNG TÀU,
 * TỔNG QUAN HÀNG HÓA (the 1920 canvas already held one line). SIL-686 fixed
 * the DETAIL board only.
 *
 * The landed law mirrors FB-063's one-line header contract but pays for it
 * the master-plan way: the R38 column shares are PINNED (card 20261002_302 —
 * the 091026091550 one-line shares starved the port columns once), so the
 * width comes from the condensed labels plus the sanctioned co-chữ band
 * (10px/0.02em) at ≥1440px. Below 1440 the owner-redesign 23/10 wrap law
 * stays in force, and overflow stays visible (no clip) in every band.
 *
 * Pins guard the contract, not the pixels — the browser matrix is the render
 * rung (qa/2026-11-06-lane-698-ui/ screenshots).
 */
describe('SIL-698 master-plan headers hold one line at the desktop band', () => {
  it('carries the ≥1440px one-line band: th nowrap + co-chữ + clamp lift', () => {
    const band = css.match(/@media \(min-width: 1440px\) \{([\s\S]*?)\n\}\n/)?.[1] ?? '';
    expect(band, 'the SIL-698 band must exist').toBeTruthy();

    const th = band.match(/\.master-plan-grid thead th \{([^}]*)\}/)?.[1] ?? '';
    expect(th).toContain('white-space: nowrap;');
    expect(th).toContain('font-size: 10px;');
    expect(th).toContain('letter-spacing: 0.02em;');

    const label = band.match(/\.master-plan-grid__th-label \{([^}]*)\}/)?.[1] ?? '';
    // The 2-line clamp HIDES an overflowing label — a truncation, banned.
    // The band lifts it so an oversized label overflows visibly instead.
    expect(label).toContain('display: block;');
    expect(label).toContain('overflow: visible;');
    expect(label).toContain('-webkit-line-clamp: unset;');
  });

  it('keeps the narrow-band owner-redesign law: clamp-2 label + wrappable th below 1440', () => {
    const base = css.match(/\.master-plan-grid thead th \{([^}]*)\}/)?.[1] ?? '';
    expect(base).toContain('white-space: normal;');
    expect(base).toContain('word-break: keep-all;');
    const label = css.match(/\.master-plan-grid__th-label \{([^}]*)\}/)?.[1] ?? '';
    expect(label).toContain('-webkit-line-clamp: 2;');
    expect(label).toContain('overflow: hidden;');
  });

  it('pays with condensed th labels, never with the pinned R38 column shares', () => {
    // The shares stay exactly as card 20261002_302 pinned them.
    expect(css).toMatch(/\.master-plan-grid__col--schedule\s*\{\s*width:\s*10%;\s*\}/);
    expect(css).toMatch(/\.master-plan-grid__col--route-shipping\s*\{\s*width:\s*14\.5%;\s*\}/);
    expect(css).toMatch(/\.master-plan-grid__col--cargo\s*\{\s*width:\s*12%;\s*\}/);
    // The three labels that wrapped at 1440 are condensed in the header only;
    // every td keeps its full data-label for the stacked narrow layout.
    expect(tsx).toContain('>Lịch trình</span>');
    expect(tsx).toContain('>Tuyến &amp; hãng tàu</span>');
    expect(tsx).toContain('>Hàng hóa</span>');
    expect(tsx).toContain('data-label="Thời gian & lịch trình"');
    expect(tsx).toContain('data-label="Tuyến đường & hãng tàu"');
    expect(tsx).toContain('data-label="Tổng quan hàng hóa"');
    // The Excel export keeps the full column names.
    const exportModule = readFileSync(resolve(process.cwd(), 'src/features/dispatch/master-plan/masterPlanExport.ts'), 'utf8');
    expect(exportModule).toContain("'Thời gian & lịch trình'");
    expect(exportModule).toContain("'Tổng quan hàng hóa'");
  });
});
