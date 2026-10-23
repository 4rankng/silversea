import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sourceRoot = resolve(process.cwd(), 'src');
const frontendRoot = resolve(process.cwd());
const printableDocumentSource = join(sourceRoot, 'pages/config/debit-note-template-editor.css');
// The debit settlement page ships tabular-nums on its money tables (QA-passed
// 2026-09-19): aligned money digits are the point there, font capability
// aside. Its CSS is exempt from the no-tabular-nums scan like the print
// canvas above.
const debitSettlementSource = join(sourceRoot, 'pages/ShipmentDebitPage.css');
// Same exemption as ShipmentDebitPage: the chốt-debit board (card 20261005)
// is a money matrix, so its money columns carry `tabular-nums` for a shared
// digit edge. Exempt from the no-tabular-nums scan like the two pages above.
const debitCloseSource = join(sourceRoot, 'pages/accounting/AccountingDebitClosePage.css');
// Spec 19/10 FIX CHI PHÍ mục 2 ("mọi ô số tiền … 1,000,000 … tabular-nums")
// extends that same ruling to the SHARED money primitives: the <Money> value,
// the .num/.typo-num cells, the record-table money columns and the grouped
// NumberField input. These four own the declaration app-wide; the scan below
// still bans every other surface from inventing a local copy. The bundled
// Be Vietnam Pro ships proportional figures only — the declaration is inert
// until the typeface carries tnum (font capability noted in
// qa/2026-10-21-accounting-fix2, not a reason to skip the spec's CSS).
const sharedMoneyTabularSources = [
  join(sourceRoot, 'components/shared/Money.css'),
  join(sourceRoot, 'styles/typography.css'),
  join(sourceRoot, 'styles/record-table.css'),
  join(sourceRoot, 'design-system/forms/NumberField.css'),
  // Owner redesign 23/10 — the unified range picker is a SHARED design-system
  // primitive (same tier as NumberField): its trigger range, month titles and
  // day grid are date data; the declaration is the primitive's, not a
  // page-local copy.
  join(sourceRoot, 'design-system/forms/UnifiedDateRangePicker.css'),
];
const fontAssetRoot = resolve(process.cwd(), 'public/fonts');

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(?:css|ts|tsx)$/.test(entry.name) && !/\.test\.(?:ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

function fontAssetFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? fontAssetFiles(path) : [path];
  });
}

function declaredFontFamilies(source: string): string[] {
  return [
    ...source.matchAll(/font-family\s*:\s*([^;}\n]+)/g),
    ...source.matchAll(/fontFamily\s*:\s*['"]([^'"]+)['"]/g),
  ].map((match) => match[1].trim());
}

describe('frontend font-family contract', () => {
  it('uses a single shared UI family outside the print-document canvas', () => {
    const declarations = sourceFiles(sourceRoot)
      // The debit-note canvas intentionally models a print-ready legal document,
      // rather than an application UI surface.
      .filter((path) => path !== printableDocumentSource)
      .flatMap((path) => declaredFontFamilies(readFileSync(path, 'utf8')));

    expect(declarations.length).toBeGreaterThan(0);
    expect(declarations.filter((value) => !/^var\(--font-(?:body|display|sans|data)(?:,\s*[^)]+)?\)$|^inherit$/.test(value))).toEqual([]);
    const applicationSource = [
      ...sourceFiles(sourceRoot).filter((path) => path !== debitSettlementSource && path !== debitCloseSource && !sharedMoneyTabularSources.includes(path)),
      join(frontendRoot, 'index.html'),
    ].map((path) => readFileSync(path, 'utf8')).join('\n');

    expect(applicationSource).not.toMatch(/(?:--font-mono|--ff-mono|JetBrains Mono)/);
    // The bundled Be Vietnam Pro files use proportional figures. Money
    // surfaces still DECLARE tabular-nums (spec 19/10 FIX CHI PHÍ mục 2 —
    // shared primitives only, exempted above); everywhere else the ban
    // stands: a stray local declaration buys nothing today and forks the
    // ruling the shared primitives own.
    expect(applicationSource).not.toMatch(/font-(?:variant-numeric\s*:\s*tabular-nums|feature-settings\s*:\s*["']tnum)/);
    expect(readFileSync(join(fontAssetRoot, 'fonts.css'), 'utf8')).not.toContain('JetBrains Mono');
    expect(fontAssetFiles(fontAssetRoot).filter((path) => /jetbrains/i.test(path))).toEqual([]);
  });
});
