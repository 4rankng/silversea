import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { BUSINESS_UNIT_STATUS_LABELS } from './features/users/utils';

const sourceRoot = resolve(process.cwd(), 'src');

function productionSourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return productionSourceFiles(path);
    if (!/\.tsx?$/.test(entry.name) || /\.(?:test|spec)\.tsx?$/.test(entry.name)) return [];
    return [path];
  });
}

/**
 * Copy that belongs to the team, never to the person using the app:
 * PRD decision codes, internal ticket references, and leftover review notes.
 *
 * The ticket shapes require their digits, so business text that merely starts
 * with the same letters (SilverSea, a plate, a container number) is untouched.
 */
const FORBIDDEN_COPY_PATTERNS: readonly RegExp[] = [
  // PRD decision codes (Q01–Q23).
  /\bQ\d{2}(?:\s*-\s*Q\d{2})?\b/,
  // Internal ticket references (SIL-### / FB-### / QA1-###).
  /\b(?:SIL|FB|QA1)-\d+\b/,
  // A review note left in product copy.
  /cần rà soát/i,
];

function runtimeStringsWithInternalCodes(filePath: string): string[] {
  const source = ts.createSourceFile(
    filePath,
    readFileSync(filePath, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const matches: string[] = [];

  function visit(node: ts.Node) {
    const isRuntimeString = ts.isJsxText(node)
      || ts.isStringLiteral(node)
      || ts.isNoSubstitutionTemplateLiteral(node)
      || ts.isTemplateHead(node)
      || ts.isTemplateMiddle(node)
      || ts.isTemplateTail(node);

    if (isRuntimeString && FORBIDDEN_COPY_PATTERNS.some((pattern) => pattern.test(node.getText(source)))) {
      const position = source.getLineAndCharacterOfPosition(node.getStart(source));
      matches.push(`${filePath}:${position.line + 1}: ${node.getText(source).trim()}`);
    }

    ts.forEachChild(node, visit);
  }

  visit(source);
  return matches;
}

describe('product copy contract', () => {
  it('does not ship internal codes, ticket references or review notes in frontend runtime strings', { timeout: 20000 }, () => {
    const matches = productionSourceFiles(sourceRoot).flatMap(runtimeStringsWithInternalCodes);
    expect(matches, matches.join('\n')).toEqual([]);
  });

  it('maps business-unit status enums to Vietnamese product labels', () => {
    expect(BUSINESS_UNIT_STATUS_LABELS).toEqual({
      ACTIVE: 'Đang sử dụng',
      INACTIVE: 'Ngừng sử dụng',
    });
  });
});
