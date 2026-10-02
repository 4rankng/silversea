import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Page-heading law (docs/design-guidelines.md §8, ruling 2026-09-29).
 *
 * The failure this pins: `/accounting/chot-debit` titled itself
 * "Kế toán chốt debit — KẾ HOẠCH ĐIỀU ĐỘNG TỔNG HỢP", its board caption repeated
 * it as "KẾ HOẠCH ĐIỀU ĐỘNG TỔNG HỢP — thu/trả theo lô (cước vận chuyển)", and a
 * second heading on the page shouted "TỔNG HỢP CÔNG NỢ KHÁCH HÀNG".
 *
 * A page heading is the SCREEN's name — the thing the sidebar already calls it:
 *
 *   1. ONE name. Never a second name appended after a separator. The document a
 *      board renders (`KẾ HOẠCH ĐIỀU ĐỘNG TỔNG HỢP`) is the BOARD's identity; it
 *      belongs in the board's own heading, where it can carry the period and the
 *      row count the page name cannot. A detail page composing
 *      `<record> — <value>` at runtime is a different thing: its suffix is a
 *      business identifier, not a second name — which is why this guard reads
 *      only LITERAL `title=` values.
 *   2. Sentence case. No ALL-CAPS run: shouting ("KẾ HOẠCH ĐIỀU ĐỘNG TỔNG HỢP")
 *      is not emphasis, it is a second heading claiming the same rank as the H1.
 *
 * The same case rule governs a VISIBLE `<caption>`: one that restates the page
 * name in caps repeats the heading it sits under. A caption carries what the
 * table ADDS — rows, period, measure — or it is `sr-only`.
 *
 * Source-level, like `design-system/empty-state-art-coverage.test.ts`: the defect
 * is a new call site that reads fine in review, and no rendered check sees a
 * heading's case.
 */

const SRC = resolve(process.cwd(), 'src');

/** Acronyms a heading may legitimately shout — one word, never a run. */
const ACRONYMS: Record<string, true> = {
  OCR: true, VAT: true, STK: true, POD: true, PDF: true, EXCEL: true, GPS: true, URL: true, API: true,
};

const SEPARATOR = /\s(?:—|–)\s|\s-\s/;
/** Two or more consecutive ALL-CAPS words: "KẾ HOẠCH ĐIỀU ĐỘNG", not "OCR". */
const CAPS_RUN = /\b[A-ZĐÂÊÔƠƯÁÀẢÃẠÉÈẺẼẸÍÌỈĨỊÓÒỎÕỌÚÙỦŨỤÝỲỶỸỴ]{2,}(?:\s+[A-ZĐÂÊÔƠƯÁÀẢÃẠÉÈẺẼẸÍÌỈĨỊÓÒỎÕỌÚÙỦŨỤÝỲỶỸỴ]{2,})+\b/;

function tsxFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return path.endsWith('node_modules') ? [] : tsxFiles(path);
    return entry.name.endsWith('.tsx') && !/\.test\.tsx$/.test(entry.name) ? [path] : [];
  });
}

/** Literal `title="…"` values on a JSX element; a `{…}` expression is composed, not written here. */
function literalTitles(source: string, element: string): Array<{ line: number; value: string }> {
  const found: Array<{ line: number; value: string }> = [];
  for (const elementMatch of source.matchAll(new RegExp(`<${element}\\b([\\s\\S]{0,900}?)(?:/>|>\\s*\\n)`, 'g'))) {
    const propMatch = elementMatch[1].match(/\btitle="([^"]*)"/);
    if (propMatch) found.push({ line: source.slice(0, elementMatch.index).split('\n').length, value: propMatch[1] });
  }
  return found;
}

/** Literal text children of every heading and visible caption. */
function literalHeadings(source: string): Array<{ line: number; tag: string; value: string }> {
  const found: Array<{ line: number; tag: string; value: string }> = [];
  const lineOf = (index: number) => source.slice(0, index).split('\n').length;

  for (const match of source.matchAll(/<(h1|h2|h3)\b[^>]*>([^<>{]+)</g)) {
    const value = match[2].trim();
    if (value) found.push({ line: lineOf(match.index), tag: match[1], value });
  }
  // A `sr-only` caption is never rendered, so its case is nobody's business.
  for (const match of source.matchAll(/<caption\b([^>]*)>([^<{]*?)</g)) {
    if (/sr-only/.test(match[1])) continue;
    const value = match[2].trim();
    if (value) found.push({ line: lineOf(match.index), tag: 'caption', value });
  }
  return found;
}

const ACRONYM_RE = new RegExp(`\\b(${Object.keys(ACRONYMS).join('|')})\\b`, 'g');

function scan() {
  const pageTitles: Array<{ where: string; value: string }> = [];
  const headings: Array<{ where: string; tag: string; value: string }> = [];

  for (const path of tsxFiles(SRC)) {
    const source = readFileSync(path, 'utf8');
    const rel = relative(SRC, path);
    for (const item of literalTitles(source, 'PageHeader')) pageTitles.push({ where: `${rel}:${item.line}`, value: item.value });
    for (const item of literalHeadings(source)) headings.push({ where: `${rel}:${item.line}`, tag: item.tag, value: item.value });
  }
  return { pageTitles, headings };
}

describe('page-heading law', () => {
  it('every page names itself ONCE — no second name after a separator', () => {
    const { pageTitles } = scan();
    const offenders = pageTitles.filter((item) => SEPARATOR.test(item.value)).map((item) => `${item.where} "${item.value}"`);
    expect(pageTitles.length, 'the scan must see the call sites, or this test is vacuous').toBeGreaterThan(40);
    expect(offenders, `page headings joining two names:\n  ${offenders.join('\n  ')}`).toEqual([]);
  });

  it('no page heading, board heading or visible caption shouts in ALL CAPS', () => {
    const { pageTitles, headings } = scan();
    const written = [
      ...pageTitles.map((item) => ({ kind: 'PageHeader', ...item })),
      ...headings.map((item) => ({ kind: `<${item.tag}>`, ...item })),
    ];
    const offenders = written
      .filter((item) => CAPS_RUN.test(item.value.replace(ACRONYM_RE, '')))
      .map((item) => `${item.kind} ${item.where} "${item.value}"`);
    expect(written.length, 'the scan must see the call sites, or this test is vacuous').toBeGreaterThan(100);
    expect(offenders, `ALL-CAPS headings:\n  ${offenders.join('\n  ')}`).toEqual([]);
  });
});
