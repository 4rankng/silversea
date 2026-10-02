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
      ...sourceFiles(sourceRoot).filter((path) => path !== debitSettlementSource),
      join(frontendRoot, 'index.html'),
    ].map((path) => readFileSync(path, 'utf8')).join('\n');

    expect(applicationSource).not.toMatch(/(?:--font-mono|--ff-mono|JetBrains Mono)/);
    // The bundled Be Vietnam Pro files use proportional figures. Table values
    // that need a shared edge use their existing end alignment instead of a
    // no-op OpenType tabular-numeral declaration.
    expect(applicationSource).not.toMatch(/font-(?:variant-numeric\s*:\s*tabular-nums|feature-settings\s*:\s*["']tnum)/);
    expect(readFileSync(join(fontAssetRoot, 'fonts.css'), 'utf8')).not.toContain('JetBrains Mono');
    expect(fontAssetFiles(fontAssetRoot).filter((path) => /jetbrains/i.test(path))).toEqual([]);
  });
});
