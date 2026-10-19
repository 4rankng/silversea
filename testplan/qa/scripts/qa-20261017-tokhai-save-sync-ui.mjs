// ═══ SUPERSEDED 2026-10-18 ══════════════════════════════════════════════════
// FROZEN EVIDENCE ARTIFACT — DO NOT USE FOR ACCEPTANCE.
// This driver pins the 171026180010 overwrite-every-sibling law and the old
// toast copy, both SUPERSEDED by FB-109 (card 171026122100, amendment in
// testplan/2026-10-17-tokhai-save-sync.md): a non-empty save auto-copies ONLY
// onto still-empty siblings ("cont đã có số không bị ghi đè"), and the
// auto-copy toast fires only when an empty sibling was written. Its run-2026-
// 10-17 outputs (qa/2026-10-17_tokhai_ui-*) remain the historical rung-3
// record of THAT law. The rerunnable acceptance driver for the current law is
// testplan/qa/scripts/2026-10-18-fb109-autocopy-local-rung.mjs (spec:
// testplan/2026-10-18-card-fb109-to-khai-auto-copy.md).
// ═══════════════════════════════════════════════════════════════════════════
// Card 171026180010 (T-10) — tờ khai save + lot-wide sync — rung 3 driver.
// Spec: testplan/2026-10-17-tokhai-save-sync.md
// Drives /shipments-detail on the LOCAL worktree stack (be :3002, fe :7175):
//   SAVE-01: save tờ khai on the FB-110-shaped container (no fulfillment row,
//            pre-fix this 409'd "Tác vụ thực hiện hiện có không khớp…") →
//            save lands, sibling synced, decomposition healed.
//   SYNC-02: edit the number on the OTHER container → both carry the new one.
//   SYNC-03: clear on one container → local only.
// Artifacts: qa/2026-10-17_tokhai_ui-*.png + qa/2026-10-17_tokhai_ui-driver.log
// Usage: node testplan/qa/scripts/qa-20261017-tokhai-save-sync-ui.mjs
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require2 = createRequire('/private/var/folders/8j/qs8k8y3n1hlfbl4q20k0hgjh0000gn/T/opencode/tokhai-wt/package.json');
const puppeteer = require2('puppeteer');

const BASE = process.env.QA_BASE || 'http://localhost:7175';
const API = process.env.QA_API || 'http://localhost:3002/api';
const OUT = path.resolve(import.meta.dirname, '../../../qa');
fs.mkdirSync(OUT, { recursive: true });
const LOG_PATH = path.join(OUT, '2026-10-17_tokhai_ui-driver.log');

const SHIPMENT_ID = Number(process.env.QA_SHIPMENT || 110917);
const CONT_A = Number(process.env.QA_CONT_A || 48879); // born container — NO fulfillment row (FB-110 shape)
const CONT_B = Number(process.env.QA_CONT_B || 48880);
const CONT_A_NUMBER = 'FBXD7357107';
const DECL_A = 'TK-T10-SYNC-1789';
const DECL_B = 'TK-T10-SYNC-1790';
const DECL_B_ORIG = 'TK-FB110-735710';

const LOG = [];
let exitCode = 0;
const log = (step, obj = {}) => {
  const e = { at: new Date().toISOString(), step, ...obj };
  LOG.push(e);
  console.log(JSON.stringify(e));
};
const fail = (step, obj = {}) => { exitCode = 1; log(step, { verdict: 'FAIL', ...obj }); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const q = (sql) => execSync(
  `docker exec ss-prod-db psql -U postgres -d silversea -tAc "${sql}"`,
  { encoding: 'utf8' },
).trim();
const dbLot = (tag) => {
  const state = {
    tag,
    decls: q(`SELECT id || '=' || coalesce(declaration_number, 'NULL') FROM shipment_containers WHERE shipment_id=${SHIPMENT_ID} ORDER BY id;`),
    activeFulfillments: q(`SELECT count(*) FROM shipment_fulfillments WHERE shipment_id=${SHIPMENT_ID} AND canceled_at IS NULL;`),
    version: q(`SELECT version FROM shipments WHERE id=${SHIPMENT_ID};`),
  };
  log('db-state', state);
  return state;
};

(async () => {
// ── auth ─────────────────────────────────────────────────────────────────────
const healthRes = await fetch(`${API}/health`);
log('health', { status: healthRes.status });
if (!healthRes.ok) { fail('health'); process.exit(2); }

let token = null;
let who = null;
for (const identifier of ['cus', 'thanhdc', 'admin']) {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password: 'Abc123' }),
  });
  if (res.ok) { token = (await res.json()).token; who = identifier; break; }
}
log('login', { user: who, ok: Boolean(token) });
if (!token) { fail('login'); process.exit(2); }

// ── browser ──────────────────────────────────────────────────────────────────
const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--no-proxy-server'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 960 });
await page.evaluateOnNewDocument(
  (t, o) => { if (location.origin === o) localStorage.setItem('token', t); },
  token,
  new URL(BASE).origin,
);
const shot = (n) => page.screenshot({ path: path.join(OUT, `2026-10-17_tokhai_ui-${n}.png`) });

async function trustedClick(sel) {
  const found = await page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return false;
    const scroller = document.querySelector('main.app-body') || document.scrollingElement;
    if (scroller) el.scrollIntoView({ block: 'center', behavior: 'instant' });
    return true;
  }, sel);
  if (!found) return false;
  await sleep(250);
  const handle = await page.$(sel);
  if (!handle) return false;
  await handle.click();
  return true;
}

async function searchContainer(number) {
  await page.goto(`${BASE}/shipments-detail`, { waitUntil: 'networkidle0', timeout: 60000 });
  await page.waitForFunction(() => [...document.querySelectorAll('input')].some((i) => /Container, Bill\/Booking hoặc tờ khai/i.test(i.placeholder || '')), { timeout: 30000 });
  const typed = await page.evaluate((num) => {
    const input = [...document.querySelectorAll('input')].find((i) => /Container, Bill\/Booking hoặc tờ khai/i.test(i.placeholder || ''));
    if (!input) return false;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, num);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }, number);
  if (!typed) { fail('search-input'); return false; }
  await page.keyboard.press('Enter');
  await sleep(1400);
  await page.waitForFunction((num) => document.body.innerText.includes(num), { timeout: 30000 }, number);
  return true;
}

async function openDocumentsEditor(rowId) {
  const ok = await trustedClick(`#shipment-detail-edit-documents-${rowId}`);
  if (!ok) { fail('editor-open', { rowId }); return false; }
  await page.waitForFunction((rid) => {
    const editor = document.querySelector(`#shipment-detail-edit-documents-${rid}-editor`);
    return editor != null && [...editor.querySelectorAll('label > span')].some((s) => s.textContent.trim() === 'Số tờ khai');
  }, { timeout: 30000 }, rowId);
  return true;
}

async function setDeclaration(value) {
  return page.evaluate((val) => {
    const input = [...document.querySelectorAll('input[maxlength="50"], input[maxLength="50"]')]
      .find((i) => i.closest('label') && i.closest('label').querySelector('span')?.textContent.trim() === 'Số tờ khai');
    if (!input) return false;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, val);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }, value);
}

async function clickSave(rowId) {
  const ok = await trustedClick(`#shipment-detail-edit-documents-${rowId}-editor button[aria-label^="Lưu"]`);
  if (!ok) fail('save-click', { rowId });
  return ok;
}

async function waitForToast(text, timeout = 20000) {
  try {
    await page.waitForFunction((t) => document.body.innerText.includes(t), { timeout }, text);
    return true;
  } catch { return false; }
}

try {
  // ── pre-state ──────────────────────────────────────────────────────────────
  const pre = dbLot('pre');
  const preOk = pre.decls === `${CONT_A}=NULL|${CONT_B}=${DECL_B_ORIG}` && pre.activeFulfillments === '1';
  log('pre-state-check', { expectedShape: preOk, note: 'FB-110 partial-but-clean (born container row-less)' });
  if (!preOk) fail('pre-state', { got: pre });

  // ── SAVE-01: save on the row-less born container (pre-fix 409) ────────────
  if (!await searchContainer(CONT_A_NUMBER)) { fail('search'); throw new Error('search failed'); }
  await shot('1-row-found');
  if (!await openDocumentsEditor(CONT_A)) throw new Error('editor open failed');
  await shot('2-editor-open');
  if (!await setDeclaration(DECL_A)) { fail('fill-declaration'); throw new Error('fill failed'); }
  await clickSave(CONT_A);
  const toast1 = await waitForToast(`Đã lưu số tờ khai và đồng bộ sang 1 container khác của lô.`);
  log('save01-toast', { toastShown: toast1, text: 'Đã lưu số tờ khai và đồng bộ sang 1 container khác của lô.' });
  if (!toast1) fail('save01-toast');
  await page.waitForFunction((rid) => document.querySelector(`#shipment-detail-edit-documents-${rid}-editor`) == null, { timeout: 20000 }, CONT_A);
  await shot('3-after-save');

  const after1 = dbLot('after-save01');
  const after1Ok = after1.decls === `${CONT_A}=${DECL_A}|${CONT_B}=${DECL_A}`
    && after1.activeFulfillments === '2'
    && Number(after1.version) === Number(pre.version) + 1;
  log('save01-db-check', { pass: after1Ok, decls: after1.decls, fulfillments: after1.activeFulfillments, version: after1.version });
  if (!after1Ok) fail('save01-db');

  // persistence: reload and read the cells
  await searchContainer(CONT_A_NUMBER);
  const persisted = await page.evaluate((d) => document.body.innerText.split(d).length - 1 > 1, DECL_A);
  log('save01-reload-persist', { bothRowsCarryNumber: persisted });
  if (!persisted) fail('save01-persist');
  await shot('4-after-reload');

  // ── SYNC-02: edit on the OTHER container → overwrite both ─────────────────
  if (!await openDocumentsEditor(CONT_B)) throw new Error('editor open B failed');
  if (!await setDeclaration(DECL_B)) { fail('fill-declaration-b'); throw new Error('fill B failed'); }
  await clickSave(CONT_B);
  const toast2 = await waitForToast(`Đã lưu số tờ khai và đồng bộ sang 1 container khác của lô.`);
  log('sync02-toast', { toastShown: toast2 });
  if (!toast2) fail('sync02-toast');
  await page.waitForFunction((rid) => document.querySelector(`#shipment-detail-edit-documents-${rid}-editor`) == null, { timeout: 20000 }, CONT_B);
  const after2 = dbLot('after-sync02');
  const after2Ok = after2.decls === `${CONT_A}=${DECL_B}|${CONT_B}=${DECL_B}`;
  log('sync02-db-check', { pass: after2Ok, decls: after2.decls });
  if (!after2Ok) fail('sync02-db');
  await shot('5-sync-overwrite');

  // ── SYNC-03: clear stays local ─────────────────────────────────────────────
  if (!await openDocumentsEditor(CONT_A)) throw new Error('editor open A2 failed');
  if (!await setDeclaration('')) { fail('clear-declaration'); throw new Error('clear failed'); }
  await clickSave(CONT_A);
  await page.waitForFunction((rid) => document.querySelector(`#shipment-detail-edit-documents-${rid}-editor`) == null, { timeout: 20000 }, CONT_A);
  const after3 = dbLot('after-sync03');
  const after3Ok = after3.decls === `${CONT_A}=NULL|${CONT_B}=${DECL_B}`;
  log('sync03-db-check', { pass: after3Ok, decls: after3.decls });
  if (!after3Ok) fail('sync03-db');
  await shot('6-clear-local');

  // ── restore fixture decl numbers (healed fulfillments stay — they are the
  //    invariant-correct state, not test debris) ─────────────────────────────
  q(`UPDATE shipment_containers SET declaration_number=${CONT_B == null ? 'NULL' : `'${DECL_B_ORIG}'`} WHERE id=${CONT_B};`);
  q(`UPDATE shipment_containers SET declaration_number=NULL WHERE id=${CONT_A};`);
  const restored = dbLot('restored');
  log('restore', { restoredTo: restored.decls, note: 'fulfillment heal kept (2 active rows = invariant)' });
} catch (error) {
  fail('driver-error', { message: String(error) });
} finally {
  await browser.close();
}

fs.writeFileSync(LOG_PATH, LOG.map((e) => JSON.stringify(e)).join('\n') + '\n');
log('done', { exitCode });
process.exit(exitCode);
})();
