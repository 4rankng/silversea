import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sourceRoot = resolve(process.cwd(), 'src');
const staticPlaceholderPattern = /\b(?:searchPlaceholder|placeholder)\s*=\s*(?:\{\s*)?["'`]([^"'`]+)["'`]/g;
const isAllCapsCopy = (value: string) => value !== 'DD/MM/YYYY'
  // Date MASKS are not copy — the dual-calendar range trigger's empty-state
  // mask rides the same exemption (card 20260926_50).
  && value !== 'DD/MM/YYYY - DD/MM/YYYY'
  && /\p{L}/u.test(value) && value === value.toLocaleUpperCase('vi-VN');

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(?:ts|tsx|js|jsx)$/.test(entry.name) && !/\.(?:test|spec)\./.test(entry.name) ? [path] : [];
  });
}

describe('placeholder casing contract', () => {
  it('prevents input styling from capitalizing placeholder copy', () => {
    const typography = readFileSync(resolve(sourceRoot, 'styles/typography.css'), 'utf8');
    expect(typography).toMatch(/:where\(input, textarea\)::placeholder\s*\{[^}]*text-transform:\s*none;/);
  });

  it('keeps static placeholder copy out of all caps', () => {
    const allCaps = sourceFiles(sourceRoot).flatMap((path) => {
      const source = readFileSync(path, 'utf8');
      return [...source.matchAll(staticPlaceholderPattern)]
        .map((match) => match[1])
        .filter(isAllCapsCopy)
        .map((value) => `${path.replace(`${sourceRoot}/`, '')}: ${value}`);
    });

    expect(allCaps).toEqual([]);
  });

  it('also rejects static JSX values wrapped in braces', () => {
    const source = `const field = <Input placeholder={'MST'} searchPlaceholder={\`MÃ\`} />;`;
    const allCaps = [...source.matchAll(staticPlaceholderPattern)].map((match) => match[1]).filter(isAllCapsCopy);
    expect(allCaps).toEqual(['MST', 'MÃ']);
  });

  it('allows the exact date-format hint without exempting uppercase copy', () => {
    const source = '<Input placeholder="DD/MM/YYYY" /><Input placeholder="NGÀY" /><Input placeholder="MST" />';
    const allCaps = [...source.matchAll(staticPlaceholderPattern)].map((match) => match[1]).filter(isAllCapsCopy);
    expect(allCaps).toEqual(['NGÀY', 'MST']);
  });
});
