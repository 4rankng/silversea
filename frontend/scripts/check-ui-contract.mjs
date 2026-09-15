import { readdir, readFile } from 'node:fs/promises';
import { extname, relative } from 'node:path';
import ts from 'typescript';

const sourceRoot = new URL('../src/', import.meta.url);
const failures = [];
const sharedColorFiles = [
  'components/Button.css',
  'components/Input.css',
  'components/Panel.css',
  'components/KpiCard.css',
  'components/Table.css',
  'components/Toolbar.css',
  'components/FilterBar.css',
  'components/FwdFilterPills.css',
  'components/Pill.css',
  'components/PageHeader.css',
];

async function visit(directoryUrl) {
  const entries = await readdir(directoryUrl, { withFileTypes: true });
  await Promise.all(entries.map(async (entry) => {
    const entryUrl = new URL(entry.name, directoryUrl);
    if (entry.isDirectory()) {
      await visit(new URL(`${entry.name}/`, directoryUrl));
      return;
    }
    if (extname(entry.name) !== '.css') return;

    const css = await readFile(entryUrl, 'utf8');
    const displayPath = relative(new URL('..', sourceRoot).pathname, entryUrl.pathname);

    if (/border-left\s*:\s*[23456]px\s+solid/i.test(css)) {
      failures.push(`${displayPath}: full-height colored left border`);
    }
    if (/width\s*:\s*4px\s*;\s*height\s*:\s*32px/i.test(css)
      || /width\s*:\s*4px\s*;[\s\S]{0,48}height\s*:\s*32px/i.test(css)) {
      failures.push(`${displayPath}: legacy 4x32 status rail`);
    }
  }));
}

await visit(sourceRoot);

const tokenCss = await readFile(new URL('../src/styles/tokens.css', import.meta.url), 'utf8');
if (!tokenCss.includes('--status-strip-width: 3px;')
  || !tokenCss.includes('--status-strip-height: 20px;')) {
  failures.push('styles/tokens.css: canonical status strip must remain 3x20px');
}
if (!tokenCss.includes('--fs-status-pill: var(--text-caption-size);') || !tokenCss.includes('--text-caption-size: 11px;')) {
  failures.push('styles/tokens.css: status pill text must use the shared 11px caption role');
}
if (!tokenCss.includes('--sb-gradient-start:')
  || !tokenCss.includes('--sb-gradient-end:')) {
  failures.push('styles/tokens.css: sidebar gradient must remain tokenized');
}

const sidebarCss = await readFile(
  new URL('../src/components/layout/sidebar.css', import.meta.url),
  'utf8',
);
if (!/linear-gradient\(\s*180deg,\s*var\(--sb-gradient-start\)[\s\S]*var\(--sb-gradient-end\)/i
  .test(sidebarCss)) {
  failures.push('components/layout/sidebar.css: shared sidebar must use semantic gradient tokens');
}

const baseCss = await readFile(new URL('../src/styles/base.css', import.meta.url), 'utf8');
if (!/:focus-visible\s*\{[^}]*outline:\s*2px\s+solid\s+var\(--accent-2\)/i.test(baseCss)) {
  failures.push('styles/base.css: global focus indicator must use the high-contrast accent token');
}

const inputCss = await readFile(new URL('../src/components/Input.css', import.meta.url), 'utf8');
if (!/\.input:focus-visible\s*\{[^}]*outline:\s*2px\s+solid\s+var\(--accent-2\)/i
  .test(inputCss)) {
  failures.push('components/Input.css: inputs must retain the high-contrast focus outline');
}

const pillCss = await readFile(new URL('../src/components/Pill.css', import.meta.url), 'utf8');
if (!/\.pill\s*\{[^}]*font-size:\s*var\(--text-caption-size\)/i.test(pillCss)) {
  failures.push('components/Pill.css: default status pills must use the shared 11px caption role');
}
if (!/\.pill--md\s*\{[^}]*font-size:\s*var\(--text-caption-size\)/i.test(pillCss)) {
  failures.push('components/Pill.css: medium status pills must retain the same shared 11px caption role');
}

const responsiveCss = await readFile(
  new URL('../src/styles/responsive.css', import.meta.url),
  'utf8',
);
const phoneBlockStart = responsiveCss.indexOf('@media (max-width: 640px)');
const phoneCss = phoneBlockStart >= 0 ? responsiveCss.slice(phoneBlockStart) : '';
const phoneControlSelectors = [
  ':where(#root) button',
  ':where(#root) [role="button"]',
  ':where(#root) a[href]',
  '#root input:not([type="checkbox"]):not([type="radio"])',
  '#root select',
];
const universalPhoneRule = phoneCss.match(
  /:where\(#root\) button,[\s\S]*?#root select\s*\{[^}]*min-height:\s*30px\s*;/i,
)?.[0] ?? '';
for (const selector of phoneControlSelectors) {
  if (!universalPhoneRule.includes(selector)) {
    failures.push(`styles/responsive.css: missing universal phone selector ${selector}`);
  }
}
// The PM selected compact phone controls. Preserve low specificity so larger
// semantic controls (save/close/touch fields) keep their own sizing.
for (const [selector, height] of [['.wf-link', 44], ['.wf-btn', 44], ['.stab-pill', 30]]) {
  const escapedSelector = selector.replace('.', '\\.');
  const rule = new RegExp(`${escapedSelector}\\s*\\{[^}]*min-height:\\s*${height}px`, 'i');
  if (!rule.test(phoneCss)) {
    failures.push(`styles/responsive.css: ${selector} must retain its ${height}px phone minimum`);
  }
}

const customerPageCss = await readFile(
  new URL('../src/pages/CustomersPage.css', import.meta.url),
  'utf8',
);
const customerMobileCss = customerPageCss.match(
  /@media\s*\(max-width:\s*820px\)\s*\{([\s\S]*)\}\s*$/i,
)?.[1] ?? '';
const customerToolbarRule = customerMobileCss.match(
  /\.customers-page\s*>\s*\.toolbar\s*\{[^}]*\}/i,
)?.[0] ?? '';
if (!/background:\s*transparent/i.test(customerToolbarRule)
  || !/border-bottom:\s*0\b/i.test(customerToolbarRule)
  || !/margin-bottom:\s*8px\b/i.test(customerToolbarRule)) {
  failures.push(
    'pages/CustomersPage.css: customer filters must share the mobile page background and stay separated from the card list through 820px',
  );
}

const driverPenaltyCss = await readFile(
  new URL('../src/pages/DriverPenaltyPage.css', import.meta.url),
  'utf8',
);
if (!/\.penalty-month-select\s*\{[^}]*min-height:\s*44px/i
  .test(driverPenaltyCss)) {
  failures.push('pages/DriverPenaltyPage.css: mobile month select must remain at least 44px');
}

const advanceSettlementLedgerSource = await readFile(
  new URL('../src/pages/AdminAdvanceSettlementsPage.tsx', import.meta.url),
  'utf8',
);
const forbiddenAdvanceSettlementLedgerDetails = [
  'useAdminSettlementOpsCompletion',
  'OpsCompletionSummary',
  'opsCompletion',
];
for (const forbiddenDetail of forbiddenAdvanceSettlementLedgerDetails) {
  if (advanceSettlementLedgerSource.includes(forbiddenDetail)) {
    failures.push(
      `pages/AdminAdvanceSettlementsPage.tsx: ledger must not render inline Ops detail (${forbiddenDetail})`,
    );
  }
}

for (const file of sharedColorFiles) {
  const css = await readFile(new URL(`../src/${file}`, import.meta.url), 'utf8');
  if (/#[0-9a-f]{3,8}\b/i.test(css)) {
    failures.push(`${file}: shared primitive colors must use semantic tokens`);
  }
}

// --- Global table type-scale contract -------------------------------------
// The /shipments golden standard runs table text at 11/12/13px (see
// styles/operational-table-typography.css). Raw ≥14px font sizes inside
// td/th rules reintroduce per-route airier scales, so they are banned on
// desktop-width contexts. Narrow-viewport blocks (@media max-width /
// @container) are exempt — touch layouts may legitimately bump text.
// Frozen CUS + dispatch surfaces and print documents render unchanged.
// Paths are relative to frontend/ (see sourceRoot), hence the src/ prefix.
const FROZEN_CSS_PREFIXES = [
  'src/pages/ShipmentsPage.css',
  'src/pages/ShipmentContainersPage.css',
  'src/pages/ShipmentDetailPage.css',
  'src/pages/clerk/',
  'src/features/dispatch/',
  'src/pages/SettlementPrintPage.css',
];
const TABLE_CELL_SCALE_EXEMPT_PREFIXES = FROZEN_CSS_PREFIXES;
// Files still carrying legacy oversize table text; shrinks to zero as the
// sizing-philosophy wave lands. MUST be empty before the wave closes.
const TABLE_CELL_SCALE_PENDING = new Set();

/** Innermost rules with their enclosing at-query conditions. */
function collectTableRules(css) {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [];
  const stack = [];
  let buf = '';
  for (const ch of text) {
    if (ch === '{') {
      stack.push({ header: buf.trim(), body: '' });
      buf = '';
    } else if (ch === '}') {
      const block = stack.pop();
      if (block && !block.header.startsWith('@')) {
        rules.push({
          selector: block.header,
          body: block.body,
          conditions: stack.map((s) => s.header).filter((h) => h.startsWith('@')),
        });
      }
      buf = '';
    } else if (stack.length) {
      stack[stack.length - 1].body += ch;
    } else {
      buf += ch;
    }
  }
  return rules;
}

async function checkTableTypeScale(directoryUrl) {
  const entries = await readdir(directoryUrl, { withFileTypes: true });
  for (const entry of entries) {
    const entryUrl = new URL(entry.name, directoryUrl);
    if (entry.isDirectory()) {
      await checkTableTypeScale(new URL(`${entry.name}/`, directoryUrl));
      continue;
    }
    if (extname(entry.name) !== '.css') continue;

    const displayPath = relative(new URL('..', sourceRoot).pathname, entryUrl.pathname);
    if (TABLE_CELL_SCALE_EXEMPT_PREFIXES.some((p) => displayPath.startsWith(p))) continue;

    const css = await readFile(entryUrl, 'utf8');
    for (const rule of collectTableRules(css)) {
      if (!/\b(td|th)\b/.test(rule.selector)) continue;
      if (rule.conditions.some((c) => /max-width|@container/.test(c))) continue;
      const rawPx = rule.body.match(/font-size:\s*(\d+(?:\.\d+)?)px/);
      const oversizeToken = /font-size:\s*var\(--fs-(sm|md|lg|xl|2xl|display)\)/.test(rule.body);
      if (oversizeToken || (rawPx && Number(rawPx[1]) >= 14)) {
        const label = TABLE_CELL_SCALE_PENDING.has(displayPath)
          ? `${displayPath} (pending)`
          : displayPath;
        failures.push(`${label}: ≥14px font in table-cell rule "${rule.selector.split('\n')[0].trim().slice(0, 60)}"`);
      }
    }
  }
}

await checkTableTypeScale(sourceRoot);

// --- Page-CSS font-size token drift ----------------------------------------
// Design guidelines §"Bringing an existing page into the sizing contract":
// a raw px font-size in page CSS is only tolerable when its value sits on
// the token scale, so a value that matches no token is drift from an
// unassigned role (the /credit-overrides failure mode) and fails here. Allowed values
// are the px equivalents of the type tokens (11/12/14/16/18/20/24 via
// --fs-*, 13 = --ops-table-primary-size) plus the 10px dense-metadata floor
// from the dense-workspace section. Heights are deliberately NOT scanned —
// raw heights include too many legitimate non-control geometry values; the
// control-height contract stays a per-file audit.
const PAGE_FONT_TOKEN_VALUES = new Set([0, 10, 11, 12, 13, 14, 16, 18, 20, 24]);

async function checkPageFontSizeDrift(directoryUrl) {
  const entries = await readdir(directoryUrl, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      await checkPageFontSizeDrift(new URL(`${entry.name}/`, directoryUrl));
      continue;
    }
    if (extname(entry.name) !== '.css') continue;

    const entryUrl = new URL(entry.name, directoryUrl);
    const displayPath = relative(new URL('..', sourceRoot).pathname, entryUrl.pathname);
    // Scoped to pages/ — the guideline's audit surface. Feature stylesheets
    // are guarded separately (control-density.styles.test.ts) and join this
    // scan in a later wave.
    if (!displayPath.startsWith('src/pages/')) continue;
    if (FROZEN_CSS_PREFIXES.some((p) => displayPath.startsWith(p))) continue;

    const css = await readFile(entryUrl, 'utf8');
    for (const match of css.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/gi)) {
      if (!PAGE_FONT_TOKEN_VALUES.has(Number(match[1]))) {
        const line = css.slice(0, match.index).split('\n').length;
        failures.push(
          `${displayPath}:${line}: raw font-size ${match[1]}px matches no type token (assign a role, then use the token value — see docs/design-guidelines.md)`,
        );
      }
    }
  }
}

await checkPageFontSizeDrift(sourceRoot);

async function checkInlineTouchTargets(directoryUrl) {
  const entries = await readdir(directoryUrl, { withFileTypes: true });
  for (const entry of entries) {
    const entryUrl = new URL(entry.name, directoryUrl);
    if (entry.isDirectory()) {
      await checkInlineTouchTargets(new URL(`${entry.name}/`, directoryUrl));
      continue;
    }
    if (extname(entry.name) !== '.tsx') continue;

    const source = await readFile(entryUrl, 'utf8');
    const displayPath = relative(new URL('..', sourceRoot).pathname, entryUrl.pathname);
    const sourceFile = ts.createSourceFile(
      displayPath,
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );

    function inspect(node) {
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const tag = node.tagName.getText(sourceFile);
        const isInteractive = ['button', 'a', 'Link', 'NavLink', 'input', 'select']
          .includes(tag);
        if (isInteractive) {
          const styleAttribute = node.attributes.properties.find(
            (attribute) => ts.isJsxAttribute(attribute)
              && attribute.name.getText(sourceFile) === 'style',
          );
          const expression = styleAttribute
            && ts.isJsxAttribute(styleAttribute)
            && styleAttribute.initializer
            && ts.isJsxExpression(styleAttribute.initializer)
            ? styleAttribute.initializer.expression
            : undefined;
          if (expression && ts.isObjectLiteralExpression(expression)) {
            const minHeightProperty = expression.properties.find(
              (property) => ts.isPropertyAssignment(property)
                && property.name.getText(sourceFile) === 'minHeight',
            );
            if (minHeightProperty && ts.isPropertyAssignment(minHeightProperty)) {
              const valueText = minHeightProperty.initializer.getText(sourceFile)
                .replaceAll(/['"]/g, '')
                .replace('px', '');
              const value = Number(valueText);
              if (Number.isFinite(value) && value < 44) {
                const line = sourceFile.getLineAndCharacterOfPosition(
                  minHeightProperty.getStart(sourceFile),
                ).line + 1;
                failures.push(`${displayPath}:${line}: inline interactive minHeight must be at least 44px`);
              }
            }
          }
        }
      }
      ts.forEachChild(node, inspect);
    }

    inspect(sourceFile);
  }
}

await checkInlineTouchTargets(sourceRoot);

if (failures.length > 0) {
  console.error('UI contract check failed:');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('UI contract check passed.');
