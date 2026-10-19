// FB-106 (kanban card 171026115810) — after creating an FCL lot the app must
// land the operator on that lot's Chi tiết lô hàng, and that page must offer a
// "Tạo lô mới" action beside "Xoá lô".
//
// LOCAL ONLY: vite 7175 → api 3002. Role CUS (thanhdc), customer LONG MINH.
//   node testplan/qa/scripts/2026-10-17-fb106-create-redirect-rung.mjs
// Exit 0 = every rung PASS.

import puppeteer from 'puppeteer';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';

const BASE = process.env.BASE ?? 'http://localhost:7175';
const API = `${BASE}/api`;
const SHOTS = process.env.SHOTS ?? '/tmp/fb106';
fs.mkdirSync(SHOTS, { recursive: true });
const TAG = `FB106-${Date.now().toString(16).slice(-6).toUpperCase()}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function record(rung, verdict, detail) {
  results.push({ rung, verdict, detail });
  console.log(`[${verdict}] ${rung} — ${detail}`);
}

async function call(method, path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  // Writes require an idempotency key on this API.
  if (method !== 'GET') headers['Idempotency-Key'] = randomUUID();
  const res = await fetch(`${API}${path}`, { method, headers, body: body == null ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-json */ }
  return { status: res.status, ok: res.ok, json, text };
}
async function loginWithRetry(id, attempts = 3) {
  for (let i = 1; i <= attempts; i++) {
    const r = await call('POST', '/auth/login', { identifier: id, password: 'Abc123' });
    if (r.ok && r.json?.token) return r.json;
    await sleep(1500 * i);
  }
  throw new Error(`login ${id} failed`);
}

const login = await loginWithRetry('thanhdc');
const token = login.token;
console.log(`logged in as ${login.user?.username} (${login.user?.role}) · tag ${TAG}`);

// ISO 6346 check digit per the repo's own rule (shared/src/calculations/iso6346.ts):
// sum % 11, remainder 10 → 0.
const LETTER_MAP = {
  A: 10, B: 12, C: 13, D: 14, E: 15, F: 16, G: 17, H: 18, I: 19,
  J: 20, K: 21, L: 23, M: 24, N: 25, O: 26, P: 27, Q: 28, R: 29,
  S: 30, T: 31, U: 32, V: 34, W: 35, X: 36, Y: 37, Z: 38,
};
const POWERS_2 = [1, 2, 4, 8, 16, 32, 64, 128, 256, 512];
function containerNumber(owner, serial6) {
  const ten = `${owner}${serial6}`;
  let total = 0;
  for (let i = 0; i < 10; i++) {
    const ch = ten[i];
    total += (i < 4 ? LETTER_MAP[ch] : Number(ch)) * POWERS_2[i];
  }
  const check = total % 11;
  return `${ten}${check === 10 ? 0 : check}`;
}

// Own FCL fixture so item 3 can be checked without touching another lane's lot.
const today = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
const seed = await call('POST', '/shipments/quick', {
  customerId: 1, tradeDirection: 'IMPORT', cargoMode: 'FCL',
  blNumber: `${TAG}-SEED`, expectedDeliveryDate: today,
  containers: [{
    containerTypeId: 1,
    containerNumber: containerNumber('FBXW', String(100000 + (Date.now() % 900000))),
    cargoWeightKg: '1000',
  }],
}, token);
if (!seed.ok) throw new Error(`seed lot → ${seed.status} ${seed.text.slice(0, 200)}`);
const seedId = seed.json.id;
console.log(`seed lot ${seedId}`);

const browser = await puppeteer.launch({
  headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 1000 });
await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);

/** Keyboard-driven pick inside a field host. */
async function pickIn(sel, typed, wanted) {
  const ok = await page.evaluate((s) => {
    const host = document.querySelector(s);
    const c = host?.querySelector('[role="combobox"]') ?? (host?.matches?.('[role="combobox"]') ? host : null);
    if (!c) return false;
    c.scrollIntoView({ block: 'center' });
    c.focus();
    return true;
  }, sel);
  if (!ok) return false;
  await sleep(250);
  await page.keyboard.press('ArrowDown');
  await page.waitForFunction(() => document.querySelectorAll('[role="option"]').length > 0, { timeout: 8000 }).catch(() => {});
  await sleep(350);
  if (typed) { await page.keyboard.type(typed, { delay: 40 }); await sleep(800); }
  return page.evaluate((w) => {
    const o = [...document.querySelectorAll('[role="option"]')]
      .find((el) => (el.innerText || '').trim().toLowerCase().includes(w.toLowerCase()));
    if (!o) return false;
    o.scrollIntoView({ block: 'nearest' });
    o.click();
    return true;
  }, wanted);
}

/** Click a container-row cell so its editor opens, then pick an option. */
async function fillCell(fieldSuffix, typed, wanted) {
  const opened = await page.evaluate((sfx) => {
    const cell = [...document.querySelectorAll('td.csc-container-cell')]
      .find((c) => (c.getAttribute('data-field-id') || '').endsWith(sfx));
    if (!cell) return false;
    cell.scrollIntoView({ block: 'center' });
    cell.click();
    return true;
  }, fieldSuffix);
  if (!opened) return false;
  await sleep(800);
  await page.keyboard.press('ArrowDown');
  await page.waitForFunction(() => document.querySelectorAll('[role="option"]').length > 0, { timeout: 8000 }).catch(() => {});
  await sleep(350);
  if (typed) { await page.keyboard.type(typed, { delay: 40 }); await sleep(800); }
  return page.evaluate((w) => {
    const o = [...document.querySelectorAll('[role="option"]')]
      .find((el) => (el.innerText || '').trim().toLowerCase().includes(w.toLowerCase()));
    if (!o) return false;
    o.scrollIntoView({ block: 'nearest' });
    o.click();
    return true;
  }, wanted);
}

async function shot(name) {
  await sleep(700);
  const path = `${SHOTS}/${name}.png`;
  await page.screenshot({ path });
  return path;
}

function chipText() {
  return page.evaluate(() => (document.querySelector('.csc-topline__progress')?.innerText || '').replace(/\s+/g, ' ').trim());
}

try {
  // ── Item 3: the detail page carries "Tạo lô mới" beside "Xoá lô" ───────
  await page.goto(`${BASE}/shipments/${seedId}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('.shipment-detail__section-head', { timeout: 45000 });
  await sleep(2500);
  const detailButtons = await page.evaluate(() => [...document.querySelectorAll('button')]
    .map((b) => ({
      text: (b.innerText || '').trim(),
      aria: b.getAttribute('aria-label') || '',
      icon: !!b.querySelector('svg.lucide-trash-2, svg[class*="trash"]'),
    }))
    .filter((b) => /l/i.test(b.text) || b.aria));
  const headerButtons = detailButtons.filter((b) => /tạo lô mới|xoá lô|xóa lô/i.test(`${b.text} ${b.aria}`) || b.icon);
  const hasNew = headerButtons.some((b) => /tạo lô mới/i.test(`${b.text} ${b.aria}`));
  // "Xoá lô" is the lot-delete action (Trash2 icon) — match on the icon as well
  // as the wording, since the diacritic differs across builds.
  const hasDelete = headerButtons.some((b) => /xoá lô|xóa lô/i.test(`${b.text} ${b.aria}`) || b.icon);
  const shotDetail = await shot('01-chi-tiet-co-tao-lo-moi');
  record('item3-new-lot-button', hasNew && hasDelete ? 'PASS' : 'FAIL',
    `detail buttons = ${JSON.stringify(headerButtons)} · ${shotDetail}`);

  // ── Item 4: it opens the create form ──────────────────────────────────
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => /tạo lô mới/i.test((x.innerText || '').trim()));
    b?.click();
  });
  await sleep(3000);
  const afterNewUrl = page.url();
  const onCreate = afterNewUrl.endsWith('/shipments/new');
  const shotNew = await shot('02-nut-tao-lo-moi-ra-form');
  record('item4-opens-create-form', onCreate ? 'PASS' : 'FAIL',
    `url after "Tạo lô mới" = ${afterNewUrl} · ${shotNew}`);

  // ── Items 1-2: filling the whole FCL form and submitting must land on the
  //    new lot's detail page. The completeness panel names anything left. ──
  await pickIn('[data-field-id="shipment-customer"]', 'LONG MINH', 'LONG MINH');
  await sleep(2500);
  await page.evaluate(() => {
    const host = document.querySelector('[data-field-id="shipment-trade-direction"]');
    const c = host?.querySelector('[role="combobox"], select, button');
    if (c) { c.focus(); c.click(); }
  });
  await sleep(700);
  await page.evaluate(() => {
    const o = [...document.querySelectorAll('[role="option"]')]
      .find((el) => /nhập khẩu/i.test((el.innerText || '').trim()));
    o?.click();
  });
  await sleep(1500);
  await page.evaluate(() => {
    const c = document.querySelector('[data-field-id="shipment-booking-ref"] input');
    c?.focus();
  });
  await page.keyboard.type(`${TAG}-NEW`, { delay: 25 });
  await sleep(800);

  // Container row: type, factory, route, both ports.
  await fillCell('-type', '', "20'DC") || await fillCell('-type', '', '20');
  await sleep(700);
  await fillCell('-factory', '', 'Võ Cường');
  await sleep(700);
  await fillCell('-route', '', 'Hải Phòng');
  await sleep(700);
  await fillCell('-pickup-port', '', 'Hải Phòng');
  await sleep(700);
  await fillCell('-dropoff-port', '', 'Hải Phòng');
  await sleep(900);

  // The ninth required field is the container's Ngày giờ đóng/trả. The form
  // offers a bulk control for it ("Ngày giờ đóng trả cho tất cả cont" +
  // "Áp dụng cho N container"), which is the operator's own path and much
  // stabler than typing into the row's split datetime cell.
  await page.evaluate(() => {
    const set = (el, v) => {
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
      setter.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    const d = new Date(Date.now() + 86400000);
    const p2 = (n) => String(n).padStart(2, '0');
    const bulk = [...document.querySelectorAll('div,section')]
      .find((el) => /Ngày giờ đóng trả cho tất cả cont/i.test(el.innerText || ''));
    const scope = bulk ?? document;
    for (const i of scope.querySelectorAll('input')) {
      const ph = (i.placeholder || '').toUpperCase();
      if (ph.includes('HH')) set(i, '09:00');
      else if (ph.includes('DD')) set(i, `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()}`);
    }
  });
  await sleep(600);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')]
      .find((x) => /áp dụng cho \d+ container/i.test((x.innerText || '').trim()));
    b?.scrollIntoView({ block: 'center' });
    b?.click();
  });
  await sleep(1500);
  const chip = await chipText();
  const shotForm = await shot('03-form-truoc-khi-tao');
  record('form-progress', chip.includes('/') ? 'INFO' : 'FAIL', `chip before submit = ${JSON.stringify(chip)} · ${shotForm}`);

  // Fallback: if the bulk control did not land it, fill the row's own split
  // datetime cell directly.
  await page.evaluate(() => {
    const set = (el, v) => {
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
      setter.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    const now = new Date(Date.now() + 86400000);
    const p2 = (n) => String(n).padStart(2, '0');
    for (const i of [...document.querySelectorAll('input')]) {
      const holder = i.closest('[data-field-id*="appointment"]');
      if (!holder) continue;
      const ph = (i.placeholder || '').toUpperCase();
      if (ph.includes('HH')) set(i, '09:00');
      else if (ph.includes('DD')) set(i, `${p2(now.getDate())}/${p2(now.getMonth() + 1)}/${now.getFullYear()}`);
    }
  });
  await sleep(1200);
  const chip2 = await chipText();

  const submit = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => /^Tạo lô hàng$/i.test((x.innerText || '').trim()));
    if (!b || b.disabled || b.getAttribute('aria-disabled') === 'true') return { clicked: false, disabled: true };
    b.click();
    return { clicked: true, disabled: false };
  });
  await sleep(6000);

  const finalUrl = page.url();
  const landedOnDetail = /\/shipments\/\d+$/.test(finalUrl);
  const shotAfter = await shot('04-sau-khi-tao-lô');
  record('items1-2-redirect-after-create',
    submit.clicked && landedOnDetail ? 'PASS' : 'FAIL',
    `chip=${JSON.stringify(chip)} → ${JSON.stringify(chip2)} submit=${JSON.stringify(submit)} url=${finalUrl} · ${shotAfter}`);
} catch (e) {
  record('RUNNER', 'FAIL', String(e.message ?? e));
  await page.screenshot({ path: `${SHOTS}/99-error.png`, fullPage: true }).catch(() => {});
} finally {
  await browser.close();
}

const failed = results.filter((r) => r.verdict === 'FAIL');
console.log(`\n=== ${failed.length === 0 ? 'ALL RUNGS PASS' : failed.length + ' RUNG(S) FAILED'} ===`);
for (const r of results) console.log(`  ${r.verdict.padEnd(5)} ${r.rung}`);
process.exit(failed.length === 0 ? 0 : 1);
