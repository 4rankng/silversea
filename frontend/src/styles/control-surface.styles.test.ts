import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/** Card 20260925_3 (CHIEF 25/09 site sweep, "fix the whole fk site"):
 *
 * 1. CONTROLS ARE OPAQUE. The InputBase wrapper's `bg-primary` utility never
 *    resolves in this app's Tailwind build, so date/search/text controls were
 *    see-through on every host page (5537316a fixed one page-local instance).
 *    The wrappers ([data-uui-control='input'], [data-input-wrapper]) are the
 *    fill layer in base.css: var(--surface), site-wide.
 * 2. ACTION BUTTONS STAY COMPACT. Export/filter action buttons hug their
 *    content inside filter grids — no full-width slabs.
 * 3. EMPTY STATES AND TOTALS SIT ON SOLID GROUND. The wallet empty-state row
 *    and the fund-book closing/outstanding figures render on --surface with a
 *    border — never half-transparent against the page canvas.
 *
 * Red evidence: the pre-fix DOM audit recorded transparent computed
 * backgrounds on 8 control wrappers (invoice-tracking) + 29 (dispatch) and
 * the /ops/wallet half-white empty box (screenshots in
 * plans/reports/c17-fe-site-surface-sweep/). Excluded per dispatch:
 * ListFilterBar*, ShipmentsPage*, OpsOrdersPage* (held by agy#1/agy#2). */
const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

describe('site surface contract (card 20260925_3)', () => {
  it('input control wrappers fill site-wide with var(--surface)', () => {
    const base = read('src/styles/base.css');
    expect(base).toMatch(/\[data-uui-control='input'\],\s*\n?\[data-input-wrapper\]\s*\{[^}]*background:\s*var\(--surface\)/);
  });

  it('reconciliation export button stays compact inside its filter grid', () => {
    const css = read('src/features/expense-accounting/ExpenseAccounting.css');
    expect(css).toMatch(/\.expense-history-filters > \.btn\s*\{[^}]*width:\s*fit-content/);
  });

  it('wallet empty-state row renders on solid --surface at full width', () => {
    const css = read('src/pages/OpsWalletPage.css');
    const rule = css.match(/\.ops-wallet__empty\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(rule).toContain('background: var(--surface)');
    expect(rule).toContain('display: block');
    // Mobile collapse: the empty row's tr must not shrink-wrap (card 20260925_3).
    expect(css).toMatch(/\.ops-wallet__table tr \{ display: block; width: 100%; \}/);
  });

  it('fund-book closing/outstanding figures sit in a solid bordered block', () => {
    const css = read('src/pages/OpsWalletPage.css');
    const rule = css.match(/\.ops-fund-book__summary\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(rule).toContain('background: var(--surface)');
    expect(rule).toContain('border: 1px solid var(--line)');
  });

  it('disabled buttons carry the opacity + not-allowed cue (card 20260925_48)', () => {
    // Audit reported the login submit as cue-less; computed styles on the live
    // login page show the .btn[disabled] cue applied (opacity 0.45 over the
    // accent fill reads faded). Pin the Button-layer contract so it cannot rot.
    const css = read('src/components/Button.css');
    const rule = css.match(/\.btn\[disabled\]\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(rule).toContain('opacity: 0.45');
    expect(rule).toContain('cursor: not-allowed');
  });

  it('login inputs fill opaque with var(--surface), never a translucent white (card 20260925_49)', () => {
    const css = read('src/pages/LoginPage.css');
    const rule = css.match(/\.login-form \.input\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(rule).toContain('background: var(--surface)');
    expect(rule).not.toMatch(/rgba?\(\s*255\s*,\s*255\s*,\s*255\s*,\s*0?\.\d+/);
  });
});
