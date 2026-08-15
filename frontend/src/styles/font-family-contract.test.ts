import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sourceRoot = resolve(process.cwd(), 'src');
const printableDocumentSource = join(sourceRoot, 'pages/config/debit-note-template-editor.css');

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(?:css|ts|tsx)$/.test(entry.name) && !/\.test\.(?:ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

function declaredFontFamilies(source: string): string[] {
  return [
    ...source.matchAll(/font-family\s*:\s*([^;}\n]+)/g),
    ...source.matchAll(/fontFamily\s*:\s*['"]([^'"]+)['"]/g),
  ].map((match) => match[1].trim());
}

describe('frontend font-family contract', () => {
  it('uses only the shared typography tokens outside font assets', () => {
    const declarations = sourceFiles(sourceRoot)
      // The debit-note canvas intentionally models a print-ready legal document,
      // rather than an application UI surface.
      .filter((path) => path !== printableDocumentSource)
      .flatMap((path) => declaredFontFamilies(readFileSync(path, 'utf8')));

    expect(declarations.length).toBeGreaterThan(0);
    expect(declarations.filter((value) => !/^var\(--font-(?:body|display|sans|mono)(?:,\s*[^)]+)?\)$|^inherit$/.test(value))).toEqual([]);
  });
});
