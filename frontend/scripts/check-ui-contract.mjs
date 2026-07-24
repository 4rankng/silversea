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
if (!tokenCss.includes('--fs-status-pill: 11px;')) {
  failures.push('styles/tokens.css: compact status pill text must remain 11px');
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
if (!/\.pill\s*\{[^}]*font-size:\s*var\(--fs-status-pill\)/i.test(pillCss)) {
  failures.push('components/Pill.css: default status pills must use the compact typography token');
}
if (!/\.pill--md\s*\{[^}]*font-size:\s*var\(--fs-xs\)/i.test(pillCss)) {
  failures.push('components/Pill.css: medium status pills must remain larger than the compact default');
}

const responsiveCss = await readFile(
  new URL('../src/styles/responsive.css', import.meta.url),
  'utf8',
);
const phoneBlockStart = responsiveCss.indexOf('@media (max-width: 640px)');
const phoneCss = phoneBlockStart >= 0 ? responsiveCss.slice(phoneBlockStart) : '';
const phoneControlSelectors = [
  '#root button',
  '#root [role="button"]',
  '#root a[href]',
  '#root input:not([type="checkbox"]):not([type="radio"])',
  '#root select',
];
const universalPhoneRule = phoneCss.match(
  /#root button,[\s\S]*?#root select\s*\{[^}]*min-height:\s*44px\s*;/i,
)?.[0] ?? '';
for (const selector of phoneControlSelectors) {
  if (!universalPhoneRule.includes(selector)) {
    failures.push(`styles/responsive.css: missing universal phone selector ${selector}`);
  }
}
for (const selector of ['.wf-link', '.wf-btn', '.stab-pill']) {
  const escapedSelector = selector.replace('.', '\\.');
  const rule = new RegExp(`${escapedSelector}\\s*\\{[^}]*min-height:\\s*44px`, 'i');
  if (!rule.test(phoneCss)) {
    failures.push(`styles/responsive.css: ${selector} must remain at least 44px on phones`);
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
if (!/select\.penalty-month-select\s*\{[^}]*min-height:\s*44px/i
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
