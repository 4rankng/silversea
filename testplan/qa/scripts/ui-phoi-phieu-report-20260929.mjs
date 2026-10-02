// Card 20260928_173 — staging rung for the two monthly phơi phiếu reports.
//
// Criteria being scored here:
//   AC2 — repeat subjects in a month sort consecutively (soLuong desc, stable
//         tiebreak), so the busiest customer sits with its peers.
//   AC3 — a subject with movements on BOTH ledger sides in the period renders as
//         ONE row carrying both figures and the count.
//
// Run against staging with:
//   STAGING_URL=https://vantai.tingting.vip STAGING_API=https://vantai.tingting.vip/api \
//   node testplan/qa/scripts/ui-phoi-phieu-report-20260929.mjs
//
// Records the buildHash it actually scored so a verdict can never be filed
// against a build other than the one under test.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from '../lib/env.mjs';
import { createSession } from '../lib/harness.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const QA_ROOT = path.resolve(HERE, '..');
const STAMP = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 15);
const OUT = process.env.OUT || path.join(QA_ROOT, 'evidence', `${STAMP}_card173-phoi-phieu-report`);
const PAGE = process.env.REPORT_PATH || '/accounting/phoi-phieu';

const env = await loadEnv();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await fs.mkdir(OUT, { recursive: true });

const problems = [];
const notes = [];

const session = await createSession({ env, role: 'ACCOUNTANT', evidenceDir: OUT, runId: `card173-${STAMP}` });
const { page } = session;

const buildHash = await page
  .goto(`${env.baseUrl}/login`, { waitUntil: 'networkidle2' })
  .then(() => fetch(`${env.api}/health`).then((r) => r.json()).then((j) => j.buildHash).catch(() => 'unknown'))
  .catch(() => 'unknown');

await page.setViewport({ width: 1440, height: 900 });
await page.goto(`${env.baseUrl}${PAGE}`, { waitUntil: 'networkidle2' });
await sleep(2500);
await page.screenshot({ path: path.join(OUT, 'report-1440.png'), fullPage: true });

// The control table is account-scoped by default and the report needs a period,
// so drive the real date inputs rather than trusting the defaults.
// These are react-aria segmented DateInputs (labelled "Từ"/"Đến"), not native
// date inputs — a native selector finds nothing, which is why the first run
// scored empty tables.
for (const [cls, digits, label] of [
  ['.date-range-fields__from input', '01082026', 'Từ'],
  ['.date-range-fields__to input', '30092026', 'Đến'],
]) {
  const el = await page.$(cls);
  if (!el) { notes.push(`no ${label} input found`); continue; }
  await el.click();
  await page.keyboard.press('Control+a').catch(() => {});
  await el.type(digits, { delay: 30 });
  await page.keyboard.press('Tab');
  notes.push(`typed ${label}=${digits}`);
}
await sleep(1500);
await page.screenshot({ path: path.join(OUT, 'report-1440-filtered.png'), fullPage: true });

const read = await page.evaluate(() => {
  const tables = [...document.querySelectorAll('table.ppc-report')];
  const grab = (table) => [...table.querySelectorAll('tbody tr')]
    .map((tr) => [...tr.querySelectorAll('td')].map((td) => (td.innerText || '').trim()))
    .filter((cells) => cells.length && !/TỔNG CỘNG/i.test(cells[0] || ''));
  return {
    tableCount: tables.length,
    headers: tables.map((t) => [...t.querySelectorAll('thead th')].map((th) => (th.innerText || '').trim()).join(' | ')),
    rows: tables.map(grab),
  };
});

notes.push(`tables=${read.tableCount}`);
notes.push(`headers=${read.headers.join(' /// ') || 'none'}`);

// AC3 — any row stating BOTH legs on one line.
const bothLegs = [];
for (const rows of read.rows) {
  for (const cells of rows) {
    const line = cells.join(' | ');
    if (/Phải thu/i.test(line) && /Phải trả/i.test(line) && /lượt/i.test(line)) bothLegs.push(line);
  }
}
notes.push(`AC3 rows carrying both legs: ${bothLegs.length}`);
bothLegs.slice(0, 3).forEach((line) => notes.push(`  both-legs: ${line.slice(0, 160)}`));
if (bothLegs.length === 0) {
  problems.push('AC3: no subject on this environment shows both a Phải thu and a Phải trả leg in one period — the fixture this criterion needs is absent, so AC3 is NOT proven by this run');
}

// AC2 — read the ordering off the rendered rows rather than trusting the header.
const orderNotes = [];
for (const [i, rows] of read.rows.entries()) {
  const parsed = rows
    .map((cells) => ({ name: cells[0] || '', qty: /(\d+)\s*lượt/i.exec(cells.join(' '))?.[1] }))
    .filter((r) => r.name && r.qty);
  if (parsed.length < 2) { orderNotes.push(`  table${i}: too few parsed rows (${parsed.length})`); continue; }
  const nums = parsed.map((r) => Number(r.qty));
  const nonIncreasing = nums.every((n, j) => j === 0 || nums[j - 1] >= n);
  orderNotes.push(`  table${i}: ${nums.join(',')} ${nonIncreasing ? 'non-increasing OK' : 'NOT sorted desc'}`);
  if (!nonIncreasing) problems.push(`AC2: table ${i} volumes are not in non-increasing order: ${nums.join(',')}`);
  parsed.slice(0, 6).forEach((r) => orderNotes.push(`    ${r.qty} lượt — ${r.name.slice(0, 40)}`));
}
orderNotes.forEach((n) => notes.push(n));

const meta = {
  prefix: 'card173', env: env.env, baseUrl: env.baseUrl, buildHash,
  tableCount: read.tableCount, ac3BothLegRows: bothLegs.length,
  problems, notes, ok: problems.length === 0,
};
await fs.writeFile(path.join(OUT, 'shot-meta.json'), JSON.stringify(meta, null, 2));

console.log(`card173-phoi-phieu: build=${buildHash} env=${env.env} tables=${read.tableCount} bothLegs=${bothLegs.length}`);
for (const n of notes) console.log('  ', n);
if (problems.length) {
  console.log('card173-phoi-phieu: FAILED — a criterion was NOT proven:');
  for (const p of problems) console.log('   -', p);
} else {
  console.log('card173-phoi-phieu: OK — AC2 and AC3 both visible on this build');
}
process.exit(problems.length ? 1 : 0);
