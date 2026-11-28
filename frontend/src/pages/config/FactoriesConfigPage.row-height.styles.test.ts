import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// SIL-1225 (K4.54) — /config/factories: the "Địa chỉ · Liên hệ" cell stacked
// the address on line 1 and the contact person + SĐT on line 2, so every row
// carrying a contact measured 63px while the KB row-height law (K4.54) caps a
// row at 48–52px. The repair is a ONE-line cell: address, contact name, phone
// and the call affordance share a single flex row.
//
// These contracts pin the layout so the stacked grid cannot come back:
// (1) the group is a flex ROW, (2) the address and the contact name give way
// with an ellipsis, (3) the phone token and the call link never shrink,
// (4) the row height stays inside the law — computed from the REAL shared
// contracts (cell padding, row border, control tokens), not restated literals
// — and (5) the whole value stays reachable (SIL-467 no-cut law: the cut is
// an ellipsis, the full value rides the tooltip).

function read(relativePath: string) {
  const direct = resolve(process.cwd(), relativePath);
  if (existsSync(direct)) return readFileSync(direct, 'utf8');
  return readFileSync(resolve(process.cwd(), 'frontend', relativePath), 'utf8');
}

/** Every rule body whose selector ENDS with `selector` (standalone rule or
 *  group member). Comments are stripped first and the body is brace-balanced,
 *  so a rule can never swallow the next one and fake a pass. */
function ruleBodies(source: string, selector: string): string[] {
  const css = source.replace(/\/\*[\s\S]*?\*\//g, '');
  const bodies: string[] = [];
  let from = 0;
  for (;;) {
    const at = css.indexOf(selector, from);
    if (at === -1) break;
    from = at + selector.length;
    // The token must END a selector: only whitespace then `{` or `,` may follow.
    if (!/^\s*[,{:]/.test(css.slice(from))) continue;
    const open = css.indexOf('{', at);
    if (open === -1) break;
    let depth = 0;
    let end = -1;
    for (let i = open; i < css.length; i += 1) {
      if (css[i] === '{') depth += 1;
      else if (css[i] === '}') {
        depth -= 1;
        if (depth === 0) { end = i; break; }
      }
    }
    if (end === -1) break;
    bodies.push(css.slice(open + 1, end));
    from = end + 1;
  }
  return bodies;
}

function matchNumber(source: string, pattern: RegExp, label: string): number {
  const value = Number(source.match(pattern)?.[1]);
  expect(Number.isFinite(value), `${label}: ${pattern}`).toBe(true);
  return value;
}

const configPageCss = read('src/pages/config/config-page.css');
const factoriesSource = read('src/pages/config/FactoriesConfigPage.tsx');
const recordTableCss = read('src/styles/record-table.css');
const tokens = read('src/styles/tokens.css');

describe('factories details cell holds ONE line (SIL-1225 row-height law)', () => {
  it('the details group is a flex row, not the stacked grid', () => {
    const bodies = ruleBodies(configPageCss, '.factory-details');
    expect(bodies.length).toBeGreaterThan(0);
    for (const body of bodies) {
      expect(body).toMatch(/display:\s*flex/);
      expect(body).not.toMatch(/display:\s*grid/);
      // A wrapping flex row would put the contact back on a second line.
      expect(body).not.toMatch(/flex-wrap:\s*wrap/);
      expect(body).toMatch(/align-items:\s*center/);
      expect(body).toMatch(/gap:\s*8px/);
      expect(body).toMatch(/min-width:\s*0/);
    }
    // The contact cluster is a row too — its name gives way, it never wraps.
    for (const body of ruleBodies(configPageCss, '.factory-contact')) {
      expect(body).toMatch(/display:\s*flex/);
      expect(body).not.toMatch(/flex-wrap:\s*wrap/);
    }
  });

  it('the address gives way with an ellipsis and is allowed to shrink', () => {
    const body = ruleBodies(configPageCss, '.factory-addr')[0] ?? '';
    expect(body).toMatch(/flex:\s*1 1 auto/);
    expect(body).toMatch(/min-width:\s*0/);
    expect(body).toMatch(/white-space:\s*nowrap/);
    expect(body).toMatch(/overflow:\s*hidden/);
    expect(body).toMatch(/text-overflow:\s*ellipsis/);
  });

  it('the contact NAME may ellipsize; the phone token and the call link never shrink', () => {
    const name = ruleBodies(configPageCss, '.factory-contact-name')[0] ?? '';
    expect(name).toMatch(/flex:\s*0 1 auto/);
    expect(name).toMatch(/min-width:\s*0/);
    expect(name).toMatch(/white-space:\s*nowrap/);
    expect(name).toMatch(/overflow:\s*hidden/);
    expect(name).toMatch(/text-overflow:\s*ellipsis/);

    // DRI-01: the number must still dial itself — the phone token and the
    // call affordance are never squeezed away.
    const phone = ruleBodies(configPageCss, '.factory-contact .data-token')[0] ?? '';
    expect(phone).toMatch(/flex:\s*none/);
    const call = ruleBodies(configPageCss, '.factory-call')[0] ?? '';
    expect(call).toMatch(/flex:\s*none/);
  });

  it('the row stays inside the 48–52px law (computed from the real contracts)', () => {
    // The tallest cell of the row is the action run's button (the compact
    // control height); the details cell must never outgrow it.
    const compactH = matchNumber(tokens, /--control-compact-h:\s*(\d+)px/, 'compact control height');
    const cellPadding = matchNumber(
      configPageCss,
      /\.cfg-page \.factories-table tbody td \{ padding: (\d+)px/,
      'factories cell padding',
    );
    const rowBorder = matchNumber(
      recordTableCss,
      /\.record-table tbody td \{[^}]*border-bottom:\s*(\d+)px/,
      'row border',
    );
    const callH = matchNumber(configPageCss, /\.factory-call \{[^}]*height:\s*(\d+)px/, 'call affordance height');
    expect(callH).toBeLessThanOrEqual(compactH);

    const rowHeight = compactH + 2 * cellPadding + rowBorder;
    expect(rowHeight).toBeGreaterThanOrEqual(48);
    expect(rowHeight).toBeLessThanOrEqual(52);
  });

  it('the row padding is untouched — one line, not a thinner row', () => {
    expect(configPageCss).toMatch(/\.cfg-page \.factories-table tbody td \{ padding: 9px 12px; \}/);
  });

  it('the cell keeps the SAME children in the SAME order and the whole value in the tooltip', () => {
    const addrAt = factoriesSource.indexOf('className="factory-addr"');
    const contactAt = factoriesSource.indexOf('className="factory-contact"');
    expect(addrAt).toBeGreaterThan(-1);
    expect(contactAt).toBeGreaterThan(addrAt);
    // SIL-467 no-cut law: the cut is an ellipsis, the full value rides the title.
    expect(factoriesSource).toMatch(/className="factory-addr" title=\{details\.title\}/);
    // The tooltip still carries the address AND every contact, not just the first.
    const detailsOf = factoriesSource.slice(factoriesSource.indexOf('const detailsOf'));
    expect(detailsOf).toMatch(/contacts\.map\(\(contact\) =>/);
    expect(detailsOf).toMatch(/join\('\\n'\)/);
  });

  it('the house one-line alias is not left dead in the stylesheet', () => {
    // `.factory-oneline` was the house one-line pattern; the cell owns that
    // row now, so the alias nobody applies is gone instead of rotting.
    expect(ruleBodies(configPageCss, '.factory-oneline')).toHaveLength(0);
  });

  it('QA 28/11 K4.54 — the two wrap-capable cells are one-line cuts with titles', () => {
    // Before the fix the KHÁCH HÀNG and TUYẾN cells wrapped to 2 lines and
    // pushed rows to 55px, ngoài luật 48–52px. They now carry the board's
    // SIL-467 one-line law: ellipsis cut, whole value in the title.
    expect(configPageCss).toMatch(/\.factories-table td\.factory-cell-cut \{[^}]*white-space: nowrap;[^}]*overflow: hidden;[^}]*text-overflow: ellipsis/s);
    expect(factoriesSource).toMatch(/data-label="Khách hàng" className="factory-cell-cut" title=\{site\.customerName\}/);
    expect(factoriesSource).toMatch(/data-label="Tuyến" className="factory-cell-cut"[^>]*title=\{site\.siteType === 'FACTORY' \? \(site\.routeName \?\? undefined\) : undefined\}/);
  });
});
