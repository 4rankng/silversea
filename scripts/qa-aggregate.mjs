#!/usr/bin/env node
/**
 * Walk `qa/<date>_<scope>/` and aggregate every `report.json` into a
 * single markdown summary. This is what to attach to a regression PR
 * or paste into a status update.
 *
 * Usage:
 *   node scripts/qa-aggregate.mjs                    # scan ./qa
 *   node scripts/qa-aggregate.mjs --days 7           # last 7 days
 *   node scripts/qa-aggregate.mjs --since 2026-09-01 # from a date
 *   node scripts/qa-aggregate.mjs --json             # machine-readable
 *   node scripts/qa-aggregate.mjs --root /path/to/qa # explicit dir
 *
 * Exits 0 if every report inside the window passed, 1 otherwise. Always
 * writes a summary; never aborts mid-walk on a single bad report.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const args = process.argv.slice(2);
const JSON_OUT = args.includes("--json");
const ROOT = resolve(args.find((a) => a.startsWith("--root="))?.slice("--root=".length) ?? "qa");

const daysArg = args.find((a) => a.startsWith("--days="));
const sinceArg = args.find((a) => a.startsWith("--since="));
const since = sinceArg
  ? new Date(sinceArg.slice("--since=".length))
  : daysArg
    ? new Date(Date.now() - Number(daysArg.slice("--days=".length)) * 86_400_000)
    : new Date(Date.now() - 7 * 86_400_000); // default: last week

if (Number.isNaN(since.getTime())) {
  console.error("--since must be ISO date (YYYY-MM-DD)");
  process.exit(2);
}

if (!existsSync(ROOT)) {
  console.error(`qa root not found: ${ROOT}`);
  process.exit(2);
}

const reports = [];
const errors = [];

for (const entry of readdirSync(ROOT, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const dirName = entry.name;
  // The convention is qa/YYYY-MM-DD_<scope>/ — pick directories that start with a date.
  const m = dirName.match(/^(\d{4}-\d{2}-\d{2})_(.+)$/);
  if (!m) continue;
  const [_, dateStr, scope] = m;
  const dirDate = new Date(dateStr);
  if (dirDate < since) continue;

  const reportPath = join(ROOT, dirName, "report.json");
  if (!existsSync(reportPath)) continue; // directory without a report
  try {
    const report = JSON.parse(readFileSync(reportPath, "utf8"));
    reports.push({ date: dateStr, scope, path: reportPath, report });
  } catch (error) {
    errors.push({ date: dateStr, scope, path: reportPath, error: error?.message ?? String(error) });
  }
}

reports.sort((a, b) => a.path.localeCompare(b.path));

const summary = {
  generatedAt: new Date().toISOString(),
  root: ROOT,
  since: since.toISOString(),
  totalReports: reports.length,
  passedReports: reports.filter((r) => r.report.allPassed !== false).length,
  failedReports: reports.filter((r) => r.report.allPassed === false).length,
  erroredReports: errors.length,
  reports,
  errors,
};

// Build the markdown
let md = `# QA aggregate — ${summary.since.slice(0, 10)} → ${summary.generatedAt.slice(0, 10)}\n\n`;
md += `Root: \`${ROOT}\`\n\n`;
md += `| ${reports.length} reports | ${summary.passedReports} PASS | ${summary.failedReports} FAIL | ${summary.erroredReports} errored |\n\n`;

if (reports.length === 0) {
  md += `_No reports in window._\n`;
} else {
  md += `## Reports\n\n`;
  md += `| Date | Scope | Result | Pass/Total | Notes |\n`;
  md += `|------|-------|--------|------------|-------|\n`;
  for (const r of reports) {
    const passed = r.report.passed ?? "?";
    const total = r.report.total ?? "?";
    const result = r.report.allPassed === false ? "❌ FAIL" : r.report.allPassed === true ? "✅ PASS" : "—";
    const notes = [];
    if (r.report.failed) notes.push(`${r.report.failed} failed`);
    if (r.report.frontend) notes.push(`fe=${r.report.frontend}`);
    md += `| ${r.date} | ${r.scope} | ${result} | ${passed}/${total} | ${notes.join(", ")} |\n`;
  }
}

if (errors.length > 0) {
  md += `\n## Errored reports\n\n`;
  for (const e of errors) {
    md += `- ${e.date} ${e.scope}: ${e.error}\n`;
  }
}

const outDir = join(ROOT, "_aggregated");
mkdirSync(outDir, { recursive: true });
const outPath = join(outDir, `${new Date().toISOString().slice(0, 10)}-summary.md`);
writeFileSync(outPath, md);

if (JSON_OUT) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  console.log(md);
  console.log(`\n→ ${outPath}`);
}

const anyFail = summary.failedReports > 0 || summary.erroredReports > 0;
process.exit(anyFail ? 1 : 0);
