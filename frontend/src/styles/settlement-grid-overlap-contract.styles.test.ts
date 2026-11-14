/**
 * SIL-831 — settlement expense grid: columns never overlap (QA 14/11, build
 * 06af2306, /my-settlements/1000006 at 1440px).
 *
 * The defect: fixed px tracks (70px 100px 1fr 130px 120px 100px) with
 * nowrap utility cells — the fee code "WAREHOUSE_LABOR" bled out of the
 * 100px NỘI DUNG track over the customer name, and the merged
 * '2 cont: MSKU…, MSKU…' roll-call bled out of the 130px Số cont track
 * under the amount (both circled in the ticket).
 *
 * The law (declarations pinned here; the browser seam is the QA rung):
 *   1. Content columns size to their content — minmax(floors, max-content) —
 *      with KHÁCH HÀNG as minmax(0, 1fr) absorbing surplus or shrink.
 *   2. Row cells wrap in place (min-width: 0 + break rules) so a long token
 *      can never spill into a neighbour at tight widths.
 *   3. .u-wrap overrides the nowrap utilities (u-mono u-wrap = a wrapping
 *      mono cell), and the Số cont call site carries exactly that pair.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function read(relativePath: string) {
  const direct = resolve(process.cwd(), relativePath);
  if (existsSync(direct)) return readFileSync(direct, 'utf8');
  return readFileSync(resolve(process.cwd(), 'frontend', relativePath), 'utf8');
}

const css = read('src/pages/SettlementPrintPage.css');
const page = read('src/pages/SettlementPrintPage.tsx');

function ruleBody(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const matched = css.replace(/\/\*[\s\S]*?\*\//g, '').match(new RegExp(`${escaped}\\s*\\{([^{}]*)\\}`));
  expect(matched, `.${selector} rule missing from SettlementPrintPage.css`).toBeTruthy();
  return matched![1];
}

describe('SIL-831 — settlement expense grid columns never overlap', () => {
  it('content columns size to their content, KHÁCH HÀNG absorbs surplus/shrink', () => {
    const body = ruleBody('.settlement-expense-grid');
    expect(body).toMatch(
      /grid-template-columns:\s*70px minmax\(100px, max-content\) minmax\(0, 1fr\) minmax\(130px, max-content\) 120px 100px/,
    );
  });

  it('row cells wrap in place — long tokens never bleed into a neighbour', () => {
    const body = ruleBody('.settlement-expense-grid__row > span');
    expect(body).toMatch(/min-width:\s*0/);
    expect(body).toMatch(/word-break:\s*break-word/);
    expect(body).toMatch(/overflow-wrap:\s*break-word/);
  });

  it('.u-wrap overrides the nowrap utilities (mono cells may wrap)', () => {
    const body = ruleBody('.settlement-expense-grid .u-wrap');
    expect(body).toMatch(/white-space:\s*normal/);
  });

  it('the merged cont roll-call cell opts into wrapping', () => {
    expect(page).toMatch(/data-label="Số cont" className="u-mono u-wrap"/);
  });
});
