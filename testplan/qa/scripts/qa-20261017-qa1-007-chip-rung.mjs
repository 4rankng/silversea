// QA1-007-COMPLETENESS-CHIP (card 171026113510, verify-fail lần 2) — rung 3 driver.
// Spec: testplan/2026-10-17-card-qa1-007-completeness-chip.md
// Drives /shipments/new on the LOCAL worktree stack (be :3002, fe :7175) and
// asserts the chip/panel contract across fill states:
//   empty 0/9 → partial 1/9 → identity 3/9 + 'Cần bổ sung 6 thông tin' listing
//   the six missing container-row fields. Best-effort all-9 afterwards.
// Artifacts: qa/2026-10-17_qa1-007_ui-*.png + qa/2026-10-17_qa1-007_ui-driver.log
// Usage: node testplan/qa/scripts/qa-20261017-qa1-007-chip-rung.mjs
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require2 = createRequire('/Volumes/LexarSSD/projects/silversea/package.json');
const puppeteer = require2('puppeteer');

const BASE = process.env.QA_BASE || 'http://localhost:7175';
const API = process.env.QA_API || 'http://localhost:3002/api';
const OUT = path.resolve(import.meta.dirname, '../../../qa');
fs.mkdirSync(OUT, { recursive: true });
const LOG_PATH = path.join(OUT, '2026-10-17_qa1-007_ui-driver.log');

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
const dbState = (tag) => {
  const state = {
    tag,
    shipments: q('SELECT count(*) FROM shipments;'),
    shipment_containers: q('SELECT count(*) FROM shipment_containers;'),
    bill_qa1_007_rows: q("SELECT count(*) FROM shipments WHERE bl_number = 'BILL-QA1-007' OR booking_ref = 'BILL-QA1-007';"),
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
for (const identifier of ['thanhdc', 'cus']) {
  for (const password of ['admin123', 'Abc123']) {
    const res = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier, password }),
    });
    if (res.ok) {
      token = (await res.json()).token;
      who = identifier;
      break;
    }
  }
  if (token) break;
}
log('login', { user: who, ok: Boolean(token) });
if (!token) { fail('login'); process.exit(2); }

// ── browser ──────────────────────────────────────────────────────────────────
const browser = await puppeteer.launch({
  headless: 'new',
  // --no-proxy-server: macOS system proxy can swallow localhost URLs and hang
  // navigation to the timeout (Node fetch ignores it, which is why the probe
  // looked healthy).
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--no-proxy-server'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 960 });
await page.evaluateOnNewDocument(
  (t, o) => { if (location.origin === o) localStorage.setItem('token', t); },
  token,
  new URL(BASE).origin,
);
const shot = (n) => page.screenshot({ path: path.join(OUT, `2026-10-17_qa1-007_ui-${n}.png`) });

// Trusted mouse click at an element's centre. React-Aria comboboxes do not
// commit on synthetic element.click() (ui-create-flow-pixel-20260927 lesson),
// and the app body is an inner scroller that resets scrollTop on re-render.
async function trustedClick(selector, scopeText = null) {
  const target = await page.evaluate((sel, scope) => {
    const root = scope
      ? [...document.querySelectorAll(sel)].find((el) => (el.textContent || '').includes(scope))
      : document.querySelector(sel);
    if (!root) return null;
    const scroller = document.querySelector('main.app-body') || document.scrollingElement;
    if (scroller) root.scrollIntoView({ block: 'center', behavior: 'instant' });
    return true;
  }, selector, scopeText);
  if (!target) return false;
  await sleep(300);
  const box = await page.evaluate((sel, scope) => {
    const root = scope
      ? [...document.querySelectorAll(sel)].find((el) => (el.textContent || '').includes(scope))
      : document.querySelector(sel);
    if (!root) return null;
    const r = root.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return null;
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  }, selector, scopeText);
  if (!box) return false;
  await page.mouse.click(box.x, box.y);
  return true;
}

/** Click a visible [role=option] whose text starts with `text` in the OPEN listbox. */
async function pickOption(text) {
  await sleep(600);
  const idx = await page.evaluate((wanted) => {
    const open = [...document.querySelectorAll('[role="listbox"]')]
      .find((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
    if (!open) return -1;
    return [...open.querySelectorAll('[role="option"]')]
      .findIndex((o) => (o.textContent || '').replace(/\s+/g, ' ').trim().startsWith(wanted));
  }, text);
  if (idx < 0) return false;
  const box = await page.evaluate((wanted) => {
    const open = [...document.querySelectorAll('[role="listbox"]')]
      .find((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
    const opt = [...open.querySelectorAll('[role="option"]')]
      .filter((o) => (o.textContent || '').replace(/\s+/g, ' ').trim().startsWith(wanted))[0];
    const r = opt.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  }, text);
  await page.mouse.click(box.x, box.y);
  return true;
}

const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const chipText = () => page.evaluate(() => norm(document.querySelector('.csc-topline__progress')?.textContent));
const panelText = () => page.evaluate(() => norm(document.querySelector('.csc-validation-summary')?.textContent));

async function expectState(tag, chipExpected, panelHeadExpected) {
  await sleep(700);
  const chip = await chipText();
  const panel = await panelText();
  const ok = chip === chipExpected && (!panelHeadExpected || panel.includes(panelHeadExpected));
  log('state', { tag, chip, chipExpected, panelHeadExpected, panel: panel.slice(0, 220), ok });
  if (!ok) fail('state-mismatch', { tag, chip, chipExpected, panel });
  return ok;
}

// ── the walk ─────────────────────────────────────────────────────────────────
const dbBefore = dbState('before');

// 'commit' returns as soon as the response starts — vite's HMR socket keeps
// networkidle* from settling and the first cold module-graph walk after a fresh
// install stalls DOMContentLoaded; the mount signal absorbs that budget.
try {
  await page.goto(`${BASE}/shipments/new`, { waitUntil: 'commit', timeout: 60000 });
} catch {
  log('goto-retry', {});
  await page.goto(`${BASE}/shipments/new`, { waitUntil: 'commit', timeout: 60000 });
}
await page.waitForSelector('#shipment-trade-direction', { timeout: 180000 });
await sleep(1500);

// empty: 0/9, live panel already names nine blockers
await expectState('empty', 'Bắt buộc: 0/9', 'Cần bổ sung 9 thông tin');
await shot('empty');

// customer only → partial 1/9
if (!await trustedClick('.csc-uui-field:has(input[role="combobox"]) input[role="combobox"]')) {
  fail('customer-trigger-missing');
}
if (!await pickOption('LONG MINH')) {
  // fixture-free fallback: any non-generated customer
  const fallback = await page.evaluate(() => {
    const open = [...document.querySelectorAll('[role="listbox"]')]
      .find((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
    const opt = open && [...open.querySelectorAll('[role="option"]')]
      .find((o) => !/^CF |^\d{13}-/.test((o.textContent || '').trim()));
    return opt ? norm(opt.textContent) : null;
  });
  if (!fallback || !await pickOption(fallback.slice(0, 12))) fail('customer-option-missing');
}
await expectState('partial-customer', 'Bắt buộc: 1/9', 'Cần bổ sung 8 thông tin');
await shot('partial');

// trade direction → 2/9
if (!await trustedClick('#shipment-trade-direction')) fail('direction-trigger-missing');
if (!await pickOption('Nhập khẩu')) fail('direction-option-missing');
await expectState('partial-direction', 'Bắt buộc: 2/9', 'Cần bổ sung 7 thông tin');

// Số Bill → identity complete: the card's repro state (3/9 + panel of 6)
const bill = await page.waitForSelector('[data-field-id="shipment-booking-ref"] input', { timeout: 10000 })
  .catch(() => null);
if (!bill) fail('bill-input-missing');
else {
  await bill.click();
  await bill.type('BILL-QA1-007', { delay: 20 });
}
await expectState('identity-filled', 'Bắt buộc: 3/9', 'Cần bổ sung 6 thông tin');
const panel = await panelText();
const SIX = [
  'Container 1: chọn loại container.',
  'Container 1: chọn nhà máy.',
  'Container 1: chọn tuyến đường.',
  'Container 1: chọn cảng nâng.',
  'Container 1: chọn cảng hạ.',
  'Container 1: chọn ngày giờ đóng/trả.',
];
const listed = SIX.map((m) => ({ m, ok: panel.includes(m) }));
log('panel-listing', { listed });
if (!listed.every((x) => x.ok)) fail('panel-listing-incomplete', { listed });
// identity fields must NOT be listed as missing
const clean = !panel.includes('Chọn khách hàng.') && !panel.includes('Chọn hình thức');
log('panel-no-identity', { clean });
if (!clean) fail('panel-lists-completed-fields');
await shot('identity-filled');

// responsive chip captures at the repro state (AGENTS.md §3 width sweep)
for (const [w, h, name] of [[768, 1024, 'identity-filled-768'], [390, 844, 'identity-filled-390']]) {
  await page.setViewport({ width: w, height: h });
  await sleep(600);
  await shot(name);
  log('responsive-chip', { width: w, chip: await chipText() });
}
await page.setViewport({ width: 1440, height: 960 });

const dbAfter = dbState('after');
if (JSON.stringify({ ...dbBefore, tag: null }) !== JSON.stringify({ ...dbAfter, tag: null })) {
  fail('db-changed-during-read-only-walk', { dbBefore, dbAfter });
}
if (dbAfter.bill_qa1_007_rows !== '0') fail('bill-persisted', { dbAfter });

log('TC', {
  id: 'QA1-007-COMPLETENESS-CHIP',
  verdict: exitCode === 0 ? 'PASS' : 'FAIL',
  rung: 3,
  account: `CUS ${who} (local dev)`,
  env: `${BASE} (worktree stack be:3002, fe:7175; shared dev DB ss-prod-db:5441)`,
});

await browser.close().catch(() => {});
fs.writeFileSync(LOG_PATH, `# node testplan/qa/scripts/qa-20261017-qa1-007-chip-rung.mjs\n${LOG.map((e) => JSON.stringify(e)).join('\n')}\nEXIT=${exitCode}\n`);
console.log(`log written: ${LOG_PATH}`);
process.exit(exitCode);
})().catch((err) => {
  exitCode = 1;
  log('driver-crash', { error: String(err?.message || err) });
  try {
    fs.writeFileSync(LOG_PATH, `# node testplan/qa/scripts/qa-20261017-qa1-007-chip-rung.mjs\n${LOG.map((e) => JSON.stringify(e)).join('\n')}\nEXIT=${exitCode}\n`);
  } catch {}
  process.exit(exitCode);
});
