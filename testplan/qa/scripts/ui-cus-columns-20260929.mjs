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
const STORAGE_KEY = 'cus-lots-hidden-cols'; // /shipments. The containers page (a different surface) uses cus-containers-hidden-cols; reading the wrong one made AC3 look unscoreable.

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
let toggled = null;
if (!probe.hasColumnControl) {
  problems.push('no column-visibility control found on the CUS shipments page — the feature is not reachable on this build');
} else {
  // Actually toggle a column, so the persistence claim has something to stand on.
  // Without this the key stays null and AC3 is unscoreable.
  const opened = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button,[role="button"]')]
      .find((b) => /cột|column|hiển thị|ẩn|columns?/i.test(`${b.innerText || ''} ${b.getAttribute('aria-label') || ''}`));
    if (!btn) return null;
    btn.click();
    return (btn.innerText || btn.getAttribute('aria-label') || '').trim();
  });
  await sleep(900);
  await page.screenshot({ path: path.join(OUT, 'columns-control-open.png'), fullPage: true });
  // The picker renders plain checkboxes inside .column-picker__popover, not
  // menuitemcheckbox — the first version of this driver looked for the ARIA
  // role and found nothing.
  toggled = await page.evaluate(() => {
    const pop = document.querySelector('.column-picker__popover');
    if (!pop) return null;
    const boxes = [...pop.querySelectorAll('input[type="checkbox"]')];
    const target = boxes.find((b) => /ghi ch[úu]/i.test(b.closest('label')?.innerText || b.parentElement?.innerText || '')) || boxes[0];
    if (!target) return null;
    const label = (target.closest('label')?.innerText || target.parentElement?.innerText || '').trim().slice(0, 40);
    target.click();
    return { label, wasChecked: target.checked };
  });
  notes.push(`toggled: ${JSON.stringify(toggled)}`);
  await sleep(900);
  await page.screenshot({ path: path.join(OUT, 'columns-after-toggle.png'), fullPage: true });
  notes.push(`opened control "${opened ?? 'n/a'}", toggled "${toggled ?? 'n/a'}"`);

  const before = await page.evaluate((k) => window.localStorage.getItem(k), STORAGE_KEY);
  // A persistence claim needs a stored value. If the user has never toggled a
  // column, both reads are null and "null === null" would be a FALSE PASS —
  // the first version of this driver did exactly that and scored green.
  if (before == null) {
    problems.push(`AC3 NOT PROVEN: ${STORAGE_KEY} holds no value, so "survives reload" cannot be scored — toggle a column first, then re-run`);
  } else {
    // Half 1: a reload must not lose the choice.
    await page.reload({ waitUntil: 'networkidle2' });
    await sleep(2500);
    const afterReload = await page.evaluate((k) => window.localStorage.getItem(k), STORAGE_KEY);
    const beforeReload = before;
    await page.screenshot({ path: path.join(OUT, 'shipments-1440-reloaded.png'), fullPage: true });
    notes.push(`reload: ${STORAGE_KEY} ${before} -> ${afterReload}`);
    if (before !== afterReload) problems.push(`AC3 (reload): ${STORAGE_KEY} changed across reload (${before} -> ${afterReload})`);

    // Half 2: the card also requires the choice to survive NAVIGATION away and
    // back — "không mất khi điều hướng". Leaving the page and returning is a
    // different code path from a reload (the component remounts fresh).
    await page.goto(`${env.baseUrl}/dashboard`, { waitUntil: 'networkidle2' });
    await sleep(1500);
    await page.goto(`${env.baseUrl}${PAGE}`, { waitUntil: 'networkidle2' });
    await sleep(2500);
    const afterNav = await page.evaluate((k) => window.localStorage.getItem(k), STORAGE_KEY);
    const headerHasNotes = await page.evaluate(() =>
      [...document.querySelectorAll('thead th')].some((th) => /ghi ch[úu]/i.test(th.innerText || '')));
    await page.screenshot({ path: path.join(OUT, 'shipments-1440-after-nav.png'), fullPage: true });
    notes.push(`navigate away + back: ${STORAGE_KEY} = ${afterNav}; Ghi chú column back in header: ${headerHasNotes}`);
    if (afterNav !== beforeReload) problems.push(`AC3 (navigate): ${STORAGE_KEY} changed after navigating away and back (${beforeReload} -> ${afterNav})`);
    if (!headerHasNotes) problems.push('AC3 (navigate): the column did NOT come back after navigating away and returning');
  }
}

// AC2 — GHI CHÚ must be absent while the data is empty, and must APPEAR once
// the user turns it on. Read the headers again after the toggle.
await page.keyboard.press('Escape').catch(() => {});
await sleep(900);
const headersAfter = await page.evaluate(() =>
  [...document.querySelectorAll('thead th')].map((th) => (th.innerText || '').trim()).filter(Boolean));
const ghiChuBefore = /ghi ch[úu]/i.test(probe.headers.join(' '));
const ghiChuAfter = /ghi ch[úu]/i.test(headersAfter.join(' '));
notes.push(`GHI CHÚ before toggle: ${ghiChuBefore} | after toggle: ${ghiChuAfter}`);
await page.screenshot({ path: path.join(OUT, 'columns-header-after-toggle.png'), fullPage: true });
if (!ghiChuBefore) notes.push('AC2 half: GHI CHÚ is hidden on the untouched session (consistent with "hidden only while the data is genuinely empty")');
else problems.push('AC2: GHI CHÚ was already visible before any toggle — the default-empty hide did not happen');
if (toggled && /ghi ch[úu]/i.test(toggled.label || '') && !ghiChuAfter) {
  problems.push('AC2: user turned GHI CHÚ on but the column did not appear in the header row');
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
