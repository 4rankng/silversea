import { readFileSync, readdirSync } from 'node:fs';
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
  it('consumers use the canonical white surface rather than an undefined primary alias (UI80)', () => {
    const runtimeFiles = (directory: string): string[] => readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
      const path = resolve(directory, entry.name);
      return entry.isDirectory() ? runtimeFiles(path) : /\.(?:css|tsx?)$/.test(entry.name) && !/\.(?:test|spec)\./.test(entry.name) ? [path] : [];
    });
    const violations = runtimeFiles(resolve(process.cwd(), 'src')).filter(path =>
      /(?:var\(--surface-1\b|--surface-1\s*:)/.test(readFileSync(path, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')));
    expect(violations).toEqual([]);
    const panel = read('src/components/Panel.css').match(/\.panel\s*\{([^}]+)\}/)?.[1] ?? '';
    expect(panel).toContain('background: var(--surface)');
    expect(panel).toContain('border: 1px solid var(--line)');
    expect(panel).toContain('border-radius: var(--r)');
  });

  it('controls carry the opaque fill; label wrappers stay transparent (Chief 26/09 wrapper-band)', () => {
    const base = read('src/styles/base.css');
    const controlRule = base.match(/\[data-uui-control='input'\]\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(controlRule, 'the bordered control itself keeps the surface fill').toContain('background: var(--surface)');
    const wrapperRule = base.match(/\[data-input-wrapper\]\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(wrapperRule, 'the label-hosting wrapper shows the page background, not a white band').toContain('background: transparent');
  });

  it('enabled native controls and body-mounted dialogs keep white paint without filling inner wrappers', () => {
    const base = read('src/styles/base.css');
    expect(base).toMatch(/:is\(#root, body\)[^{]+:not\(:where\(:disabled[^}]+background-color: var\(--surface\)/);
    expect(base).toContain("[data-uui-control] input, .ds-field__input-group input");
    expect(base).toContain('textarea, .date-seg-group, [data-date-boundary]):not(:where(:disabled');
    expect(base).toMatch(/input\[readonly\][^}]+background-color: var\(--surface-2\)/);
    expect(base).toMatch(/input:disabled[^}]+background-color: var\(--surface-3\)/);
  });

  it('prefix dates paint their actual boundary and keep nested segments inside its border (QA-AUDIT-UI-53)', () => {
    const base = read('src/styles/base.css');
    const prefix = '[data-date-boundary]';
    const inner = `${prefix} .date-seg-group`;
    const enabled = base.match(/:is\(#root, body\)[^{]+:not\(:where\(:disabled[^}]+background-color: var\(--surface\)/)?.[0] ?? '';
    expect(enabled).toContain(prefix);
    expect(enabled).toContain(inner);
    const transparent = base.match(/:is\(#root, body\) :where\(\[data-uui-control\] input[^}]+background: transparent;/)?.[0] ?? '';
    expect(transparent).toContain(inner);
    for (const [state, token] of [['readonly', '--surface-2'], ['disabled', '--surface-3']]) {
      expect(base).toContain(`${prefix}:has(input${state === 'disabled' ? ':disabled' : '[readonly]'})`);
      expect(base).toMatch(new RegExp(`input${state === 'disabled' ? ':disabled' : '\\[readonly\\]'}[^}]+background-color: var\\(${token}\\)`));
    }
    const geometry = read('src/components/untitled-ui/base/control-geometry.css');
    const interior = geometry.match(/:is\(#root, body\) \[data-date-boundary\] :is\(\.date-seg-group, \.date-seg-wrapper\)\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(interior).toContain('min-height: 0');
    expect(interior).toContain('height: calc(var(--uui-control-h) - 2px)');
    expect(interior).not.toMatch(/overflow:\s*(?:hidden|clip)/);
    const date = read('src/design-system/forms/BufferedUuiDateInput.css');
    expect(date).toContain(':has(.date-seg-group--error)');
    expect(date).toMatch(/:has\(\.date-seg-group--error\):focus-within\s*\{[^}]*outline-color: var\(--danger\)/);
  });

  it('shared boundaries use house radius and contrast without overriding focus or errors', () => {
    const base = read('src/styles/base.css');
    expect(base).toMatch(/:is\(#root, body\)[^{]+\[data-uui-control='combobox'\][^{]*\{\s*border-radius: var\(--r-sm\)/);
    expect(base).toMatch(/:focus-within[^}]+\.ds-field--error \*[^}]+border-color: var\(--control-border\)/);
    expect(base).toContain(':has([aria-invalid=\'true\'])');
    expect(base).toContain('.border-error_subtle');
  });

  it('public native invalid state paints its actual boundary and focus with danger, not premature validity (QA-AUDIT-UI57)', () => {
    const base = read('src/styles/base.css');
    const owner = base.match(/\/\* Public aria-invalid boundary paint \(QA-AUDIT-UI57\)[\s\S]*?\*\/\s*([^{}]+)\{([^}]+)\}/);
    expect(owner).not.toBeNull();
    const selector = owner![1];
    expect(owner![2]).toContain('border-color: var(--danger)');
    expect(owner![2]).toContain('outline-color: var(--danger)');
    for (const control of ['input', 'select', 'textarea']) expect(selector).toContain(`${control}[aria-invalid='true']`);
    expect(selector).toContain(".ds-field__input-group:has([aria-invalid='true'])");
    expect(selector).toContain("[data-uui-control='input']:not(.date-seg-wrapper):has([aria-invalid='true'])");
    expect(selector).toContain(':not([data-uui-control] input):not(.ds-field__input-group input)');
    expect(selector).not.toMatch(/:invalid\b|:required\b/);
  });

  it('tablet global search retains readable house glyphs on its opaque field (QA-AUDIT-UI-23)', () => {
    const css = read('src/styles/responsive.css');
    for (const selector of ['.topbar__search > input::placeholder', '.topbar__search > svg']) {
      const rule = css.slice(css.indexOf(selector + ' {')).split('}')[0];
      expect(rule).toContain('color: var(--ink-3)');
      expect(rule).not.toContain('rgba(255, 255, 255');
    }
    const focus = css.slice(css.indexOf('.topbar__search > input:focus {')).split('}')[0];
    expect(focus).toContain('color: var(--ink)');
    expect(focus).toContain('background: var(--surface)');
    expect(focus).toContain('box-shadow: none');
  });

  it('shared billing and template control classes consume the house ceiling', () => {
    for (const path of ['src/components/billing/BillingDocumentBuilder.css', 'src/pages/config/debit-note-template-editor.css']) {
      const css = read(path);
      expect(css).not.toMatch(/(?:min-)?height:\s*44px/);
      expect(css).toContain('var(--control-h)');
    }
    const builder = read('src/components/billing/BillingDocumentBuilder.css');
    expect(builder).not.toMatch(/rgba\(36, 89, 130/);
    expect(builder).toMatch(/\.billing-builder__note textarea\s*\{[^}]*min-height: 78px/);
    const editor = read('src/pages/config/debit-note-template-editor.css');
    for (const selector of ['.debit-editor-canvas-input--signature-name', '.debit-editor-side-nav button', '.debit-editor-preview__table th button']) {
      const rule = editor.slice(editor.indexOf(selector + ' {')).split('}')[0];
      expect(rule).toContain('min-height: var(--control-h)');
    }
  });

  it('shared photo upload trigger consumes the house ceiling (QA-AUDIT-UI-25)', () => {
    const source = read('src/components/trip/PhotoUploader.tsx');
    expect(source).toContain('height: "var(--control-h)"');
    expect(source).not.toMatch(/height:\s*44\b/);
  });

  it('reconciliation export button stays compact inside its filter grid', () => {
    // The page-local `.expense-history-filters > .btn { width: fit-content }`
    // rule this used to pin is deleted with the page's filter grid (card
    // 20260927_152): the export button is one item of `ListFilterBar`'s actions
    // slot now, and that cluster sizes to its children.
    const barCss = read('src/components/ListFilterBar.css');
    const actionsRule = barCss.match(/\.filter-bar\.list-filter-bar \.filter-bar__actions\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(actionsRule, 'the actions cluster lays its items out in a row').toContain('display: flex');
    expect(actionsRule, 'nothing in the cluster grows a button across the line').not.toMatch(/flex:\s*1|width:\s*100%/);
    const sheet = read('src/features/expense-accounting/ExpenseAccounting.css');
    expect(sheet, 'the page no longer owns a filter grid').not.toMatch(/\.expense-history-filters/);
  });

  it('wallet empty-state row renders on solid --surface at full width', () => {
    const css = read('src/pages/OpsWalletPage.css');
    const rule = css.match(/\.ops-wallet__empty\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(rule).toContain('background: var(--surface)');
    // 2026-09-27: `display: block` on the base rule stripped the <td> of its
    // table-cell role, so on DESKTOP the message was confined to column 1's
    // width instead of spanning its colSpan (role-sweep finding). The base
    // rule stays a real cell; the phone band re-applies block/width so the
    // collapsed card still fills the row.
    expect(rule).not.toContain('display: block');
    expect(css).toMatch(/@container \(max-width: 700px\)[\s\S]*?\.ops-wallet__empty \{ display: block; width: 100%; \}/);
    // Mobile collapse: the empty row's tr must not shrink-wrap (card 20260925_3).
    expect(css).toMatch(/\.ops-wallet__table tr \{ display: block; width: 100%; \}/);
  });

  it('fund-book closing/outstanding figures sit in a solid bordered block', () => {
    const css = read('src/pages/OpsWalletPage.css');
    const rule = css.match(/\.ops-fund-book__summary\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(rule).toContain('background: var(--surface)');
    expect(rule).toContain('border: 1px solid var(--line)');
  });

  it('disabled buttons retain readable neutral surfaces and the unavailable cue (QA-AUDIT-UI-15)', () => {
    // The operator rejected the faded green primary. Neutral full-opacity
    // styling preserves the disabled distinction without washing out labels.
    const css = read('src/components/Button.css');
    const rule = css.match(/\.btn\[disabled\][^{]*\{([^}]*)\}/)?.[1] ?? '';
    expect(rule).toContain('opacity: 1');
    expect(rule).toContain('background: var(--surface-2)');
    expect(rule).toContain('color: var(--ink-3)');
    expect(rule).toContain('border-color: var(--line)');
    expect(rule).toContain('cursor: not-allowed');
    expect(rule).toContain('pointer-events: none');
    expect(css).toContain("body [data-uui-control='button']:disabled");
    expect(css).toMatch(/\.btn--primary\s*\{[^}]*background: var\(--brand\)/);
  });

  it('login shares opaque TextField paint instead of a private translucent input recipe (card 20260925_49)', () => {
    const source = read('src/pages/LoginPage.tsx');
    expect(source.match(/<TextField\b/g)).toHaveLength(2);
    expect(source).not.toMatch(/className="input"|className="input-icon"/);
    const css = read('src/design-system/forms/TextField.css');
    for (const selector of ['.ds-field textarea.ds-field__input', '.ds-field__input-group']) {
      const rule = css.slice(css.indexOf(selector + ' {')).split('}')[0];
      expect(rule).toContain('background: var(--surface)');
      expect(rule).not.toMatch(/rgba?\(\s*255\s*,\s*255\s*,\s*255\s*,\s*0?\.\d+/);
    }
    expect(read('src/pages/LoginPage.css')).not.toMatch(/\.login-form \.(?:input|input-icon)\b/);
  });

  it('shared UUI buttons stay flat outside the app while retaining actual palette boundaries', () => {
    const css = read('src/components/Button.css');
    const rule = css.match(/body \[data-uui-control='button'\]\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(rule).toContain('box-shadow: none');
    expect(rule).toContain('border: 1px solid transparent');
    expect(css).toMatch(/body \[data-uui-control='button'\]::before\s*\{[^}]*content: none/);
    for (const [palette, token] of [['primary', '--brand'], ['secondary', '--line-2'], ['primary-destructive', '--danger']]) {
      const paletteRule = css.match(new RegExp(`body \\[data-uui-control='button'\\]\\[data-control-color='${palette}'\\]\\s*\\{([^}]*)\\}`))?.[1] ?? '';
      expect(paletteRule).toContain(`border-color: var(${token})`);
    }
    expect(css).toMatch(/\[data-control-color='secondary-destructive'\][^}]*border-color: color-mix\(in srgb, var\(--danger\) 45%, var\(--line-2\)\)/);
    expect(read('src/components/untitled-ui/base/buttons/button.tsx')).toContain('"data-control-color": color');
  });
});
