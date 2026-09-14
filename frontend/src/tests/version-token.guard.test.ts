import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { CONFIG } from '@tingting/shared';

// Enumeration guard (card _18, AC3): every FE client write that targets a
// crud-factory resource must carry an explicit expectedUpdatedAt token, or
// the file is a documented exception relying on the transport self-heal
// (428 + VERSION_TOKEN_REQUIRED -> refetch row, retry once). The resource
// list is derived from the backend router file — single source of truth.

const BACKEND_ROUTER = path.resolve(__dirname, '../../../backend/src/routes/config/catalog-crud.routes.ts');
const API_DIR = path.resolve(__dirname, '../api');
// Files that intentionally omit tokens and rely on the transport self-heal.
const SELF_HEAL_EXCEPTIONS = ['pricingClient.ts'];

function crudResources(): string[] {
  const source = readFileSync(BACKEND_ROUTER, 'utf8');
  const resources = Array.from(
    source.matchAll(/router\.use\(\s*'([^']+)',\s*createCrudRouter/g),
  ).map((m) => m[1] as string);
  expect(resources.length).toBeGreaterThanOrEqual(25);
  return resources;
}

interface Finding { file: string; line: number; target: string; tokened: boolean }

function scanFile(filePath: string, fileName: string, resources: string[]): Finding[] {
  const lines = readFileSync(filePath, 'utf8').split('\n');
  const findings: Finding[] = [];
  const callRe = /api\.(put|patch|delete)\b/;
  for (let i = 0; i < lines.length; i++) {
    if (!callRe.test(lines[i])) continue;
    // Callsites span several lines — collect until parens balance (cap 20).
    let depth = 0;
    let j = i;
    let expr = '';
    while (j < lines.length && j < i + 20) {
      expr += lines[j] + '\n';
      for (const ch of lines[j]) {
        if (ch === '(') depth += 1;
        else if (ch === ')') depth -= 1;
      }
      if (depth === 0 && expr.includes('(')) break;
      j += 1;
    }
    const window = lines.slice(i, j + 1).join('\n');
    const targetMatch = window.match(/CONFIG\.([A-Z_0-9]+)/);
    if (!targetMatch) continue;
    const value = (CONFIG as Record<string, unknown>)[targetMatch[1]];
    const pathValue = typeof value === 'string' ? value : '';
    if (!pathValue) continue;
    const resource = pathValue.replace(/^\//, '');
    if (!resources.some((r) => resource === r.replace(/^\//, '') || resource.startsWith(r.replace(/^\//, '') + '/'))) continue;
    findings.push({
      file: fileName,
      line: i + 1,
      target: `CONFIG.${targetMatch[1]}`,
      tokened: window.includes('expectedUpdatedAt'),
    });
  }
  return findings;
}

describe('version-token guard: crud-factory writes carry their token', () => {
  it('every crud-factory client write passes expectedUpdatedAt or is a documented exception', () => {
    const resources = crudResources();
    const violations: string[] = [];
    const tokenedCount = { n: 0 };
    for (const name of readdirSync(API_DIR).sort()) {
      const filePath = path.join(API_DIR, name);
      if (!statSync(filePath).isFile() || !name.endsWith('.ts') || name.endsWith('.test.ts')) continue;
      for (const f of scanFile(filePath, name, resources)) {
        if (f.tokened) tokenedCount.n += 1;
        else if (!SELF_HEAL_EXCEPTIONS.includes(f.file)) {
          violations.push(`${f.file}:${f.line} writes ${f.target} without expectedUpdatedAt`);
        }
      }
    }
    // Anti-vacuous: the scanner must actually see explicit-token callsites.
    expect(tokenedCount.n).toBeGreaterThanOrEqual(2);
    expect(violations).toEqual([]);
  });

  it('the backend still marks missing-token 428s as VERSION_TOKEN_REQUIRED', () => {
    const factory = readFileSync(
      path.resolve(__dirname, '../../../backend/src/routes/utils/crud-factory.ts'),
      'utf8',
    );
    expect(factory).toContain("'VERSION_TOKEN_REQUIRED'");
    expect(factory).not.toContain('VERSION_TOKEN_REQUIRED_X');
  });
});
