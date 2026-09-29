// Card 20260928_193 — staging check for the CUS column-visibility control.
//
// Scores the DEPLOYED build, not local dev, and records the buildHash it read.
//   STAGING_URL=https://vantai.tingting.vip STAGING_API=https://vantai.tingting.vip/api \
//   node testplan/qa/scripts/ui-cus-columns-20260929.mjs
//
// Exits non-zero when a criterion is UNPROVEN, not only when it is proven
// wrong — an empty page must never read as a pass.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from '../lib/env.mjs';
import { createSession } from '../lib/harness.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const QA_ROOT = path.resolve(HERE, '..');
const STAMP = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 15);
const OUT = process.env.OUT || path.join(QA_ROOT, 'evidence', `${STAMP}_card193-cus-columns`);
const PAGE = process.env.COLUMNS_PATH || '/shipments';
const STORAGE_KEY = 'cus-containers-hidden-cols';

const env = await loadEnv();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await fs.mkdir(OUT, { recursive: true });

const problems = [];
const notes = [];

const session = await createSession({ env, role: 'CUS', evidenceDir: OUT, runId: `card193-${STAMP}` });
const { page } = session;

const buildHash = await page
  .goto(`${env.baseUrl}/login`, { waitUntil: 'networkidle2' })
  .then(() => fetch(`${env.api}/health`).then((r) => r.json()).then((j) => j.buildHash).catch(() => 'unknown'))
  .catch(() => 'unknown');

await page.setViewport({ width: 1440, height: 900 });
await page.goto(`${env.baseUrl}${PAGE}`, { waitUntil: 'networkidle2' });
await sleep(3000);
await page.screenshot({ path: path.join(OUT, 'shipments-1440.png'), fullPage: true });

const probe = await page.evaluate((key) => {
  const buttons = [...document.querySelectorAll('button,[role="button"],[role="switch"],[role="checkbox"]')];
  const colBtn = buttons.find((b) => /cột|column|hiển thị|ẩn|columns?/i.test(`${b.innerText || ''} ${b.getAttribute('aria-label') || ''}`));
  const headers = [...document.querySelectorAll('thead th')].map((th) => (th.innerText || '').trim()).filter(Boolean);
  return {
    hasColumnControl: Boolean(colBtn),
    controlLabel: colBtn ? (colBtn.innerText || colBtn.getAttribute('aria-label') || '').trim().slice(0, 60) : null,
    headers,
    storedValue: window.localStorage.getItem(key),
    storageKeys: Object.keys(window.localStorage).filter((k) => /col|hidden/i.test(k)),
  };
}, STORAGE_KEY);

notes.push(`buildHash=${buildHash} env=${env.env} page=${PAGE}`);
notes.push(`column control present: ${probe.hasColumnControl}${probe.controlLabel ? ` ("${probe.controlLabel}")` : ''}`);
notes.push(`headers: ${probe.headers.join(' | ').slice(0, 220) || 'none'}`);
notes.push(`localStorage keys matching /col|hidden/: ${JSON.stringify(probe.storageKeys)}`);
notes.push(`${STORAGE_KEY} = ${probe.storedValue}`);

// AC3 — the choice must survive a reload. Only scorable if the control exists.
if (!probe.hasColumnControl) {
  problems.push('no column-visibility control found on the CUS shipments page — the feature is not reachable on this build');
} else {
  const before = await page.evaluate((k) => window.localStorage.getItem(k), STORAGE_KEY);
  // A persistence claim needs a stored value. If the user has never toggled a
  // column, both reads are null and "null === null" would be a FALSE PASS —
  // the first version of this driver did exactly that and scored green.
  if (before == null) {
    problems.push(`AC3 NOT PROVEN: ${STORAGE_KEY} holds no value, so "survives reload" cannot be scored — toggle a column first, then re-run`);
  } else {
    await page.reload({ waitUntil: 'networkidle2' });
    await sleep(2500);
    const after = await page.evaluate((k) => window.localStorage.getItem(k), STORAGE_KEY);
    await page.screenshot({ path: path.join(OUT, 'shipments-1440-reloaded.png'), fullPage: true });
    notes.push(`reload: ${STORAGE_KEY} ${before} -> ${after}`);
    if (before !== after) problems.push(`AC3: ${STORAGE_KEY} changed across reload (${before} -> ${after})`);
  }
}

if (probe.headers.length === 0) {
  problems.push('the shipments table rendered no headers — scoring ordering/hide-show off an empty page would be a false verdict');
}

const meta = { prefix: 'card193', env: env.env, baseUrl: env.baseUrl, buildHash, page: PAGE, probe, problems, notes, ok: problems.length === 0 };
await fs.writeFile(path.join(OUT, 'shot-meta.json'), JSON.stringify(meta, null, 2));

console.log(`card193-cus-columns: build=${buildHash} env=${env.env} control=${probe.hasColumnControl}`);
for (const n of notes) console.log('  ', n);
if (problems.length) {
  console.log('card193-cus-columns: NOT PROVEN —');
  for (const p of problems) console.log('   -', p);
} else {
  console.log('card193-cus-columns: control present and selection survives reload');
}
process.exit(problems.length ? 1 : 0);
