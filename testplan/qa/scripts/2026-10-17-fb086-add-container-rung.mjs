// FB-086 verify-fail round 2 (kanban card 171026113520) — the lot detail page
// must both LIST the containers that already exist and offer a "Thêm container"
// action in the container section head.
//
// The rung creates its OWN FCL lot (one container, tagged with the run hex)
// through the same endpoint the create form uses, so no fixture another lane
// owns is mutated by the add-container click.
//
// LOCAL ONLY: vite 7175 → api 3002. Role CUS (thanhdc), customer LONG MINH.
//   node testplan/qa/scripts/2026-10-17-fb086-add-container-rung.mjs
// Exit 0 = every rung PASS.

import puppeteer from 'puppeteer';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';

const BASE = process.env.BASE ?? 'http://localhost:7175';
const API = `${BASE}/api`;
const SHOTS = process.env.SHOTS ?? '/tmp/fb086';
fs.mkdirSync(SHOTS, { recursive: true });
const hex = Date.now().toString(16).slice(-6).toUpperCase();
const BL = `CLF-086-${hex}`;
// Container numbers are validated by the SERVER with the repo's own ISO 6346
// helper (shared/src/calculations/iso6346.ts): check digit = sum % 11, with a
// remainder of 10 mapped to 0. (NOT `11 - remainder` — that variant rejects
// every number this backend accepts.) Verified against a known-good row from
// this DB: MSKU386809 + check 1.
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

const serial = String(100000 + (Date.now() % 900000));
const CON1 = containerNumber('FBXU', serial);
const CON2 = containerNumber('FBXV', serial);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function record(rung, verdict, detail) {
  results.push({ rung, verdict, detail });
  console.log(`[${verdict}] ${rung} — ${detail}`);
}

async function call(method, path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (method !== 'GET') headers['Idempotency-Key'] = randomUUID();
  const res = await fetch(`${API}${path}`, { method, headers, body: body == null ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-json */ }
  return { status: res.status, ok: res.ok, json, text };
}

async function loginWithRetry(identifier, attempts = 3) {
  for (let i = 1; i <= attempts; i++) {
    const r = await call('POST', '/auth/login', { identifier, password: 'Abc123' });
    if (r.ok && r.json?.token) return r.json;
    await sleep(1500 * i);
  }
  throw new Error(`login ${identifier} failed`);
}

const login = await loginWithRetry('thanhdc');
const token = login.token;
console.log(`logged in as ${login.user?.username} (${login.user?.role}) · run tag ${hex}`);

// ── Own fixture: an FCL lot with exactly one container ─────────────────────
const created = await call('POST', '/shipments/quick', {
  customerId: 1,
  tradeDirection: 'IMPORT',
  cargoMode: 'FCL',
  blNumber: BL,
  expectedDeliveryDate: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
  containers: [{ containerTypeId: 1, containerNumber: CON1, cargoWeightKg: '1000' }],
}, token);
if (!created.ok) throw new Error(`create lot → ${created.status} ${created.text.slice(0, 300)}`);
const lotId = created.json.id;
console.log(`fixture: shipment ${lotId} (${BL}) with container ${CON1}`);

const browser = await puppeteer.launch({
  headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 1000 });
await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);

async function readSection() {
  return page.evaluate(() => {
    const heads = [...document.querySelectorAll('.shipment-detail__section-head')];
    const head = heads.find((h) => /Containers \(/.test(h.innerText || ''));
    const title = head?.querySelector('.shipment-detail__section-title')?.innerText?.trim() ?? null;
    const buttons = head ? [...head.querySelectorAll('button')].map((b) => ({
      text: (b.innerText || '').trim(), disabled: b.disabled || b.getAttribute('aria-disabled') === 'true',
    })) : [];
    const empty = (document.body.innerText || '').includes('Chưa có container nào.');
    const tableRows = [...document.querySelectorAll('table.shipment-detail__table tbody tr')]
      .map((tr) => (tr.innerText || '').replace(/\s+/g, ' ').trim()).filter(Boolean);
    return { title, buttons, empty, tableRows };
  });
}

async function shot(name) {
  await sleep(700);
  const path = `${SHOTS}/${name}.png`;
  await page.screenshot({ path });
  return path;
}

try {
  await page.goto(`${BASE}/shipments/${lotId}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('.shipment-detail__section-head', { timeout: 45000 });
  await sleep(3000);

  // ── Symptom 2: the container that exists must be listed ────────────────
  const before = await readSection();
  const shotBefore = await shot('01-ac-containers-listed');
  record('AC-listed', before.title === 'Containers (1)' && before.empty === false
    && before.tableRows.some((r) => r.includes(CON1)) ? 'PASS' : 'FAIL',
    `section=${JSON.stringify({ title: before.title, empty: before.empty, rows: before.tableRows.slice(0, 2) })} · ${shotBefore}`);

  // ── Symptom 1: the action must sit in that same section head ───────────
  const addBtn = before.buttons.find((b) => /Thêm container/i.test(b.text));
  record('AC-button', addBtn && !addBtn.disabled ? 'PASS' : 'FAIL',
    `head buttons = ${JSON.stringify(before.buttons)}`);

  // ── The action must actually work: add a second container ──────────────
  if (addBtn) {
    await page.evaluate(() => {
      const head = [...document.querySelectorAll('.shipment-detail__section-head')]
        .find((h) => /Containers \(/.test(h.innerText || ''));
      const b = [...(head?.querySelectorAll('button') ?? [])]
        .find((x) => /Thêm container/i.test(x.innerText || ''));
      b?.click();
    });
    await page.waitForSelector('[role="dialog"]', { timeout: 10000 }).catch(() => {});
    await sleep(800);
    const modalTitle = await page.evaluate(() => document.querySelector('[role="dialog"] h2, [role="dialog"] h3, [role="dialog"] strong')?.innerText?.trim() ?? null);
    const shotModal = await shot('02-ac-modal-them-container');

    // Type the new number into the modal's first text input, then confirm.
    await page.evaluate(() => {
      const d = document.querySelector('[role="dialog"]');
      const input = d?.querySelector('input[type="text"], input:not([type])');
      if (input) { input.focus(); }
    });
    await page.keyboard.type(CON2, { delay: 30 });
    await sleep(400);
    const confirmed = await page.evaluate(() => {
      const d = document.querySelector('[role="dialog"]');
      const b = [...(d?.querySelectorAll('button') ?? [])]
        .find((x) => /^Thêm container$/i.test((x.innerText || '').trim()));
      if (!b || b.disabled) return false;
      b.click();
      return true;
    });
    await sleep(3500);

    const after = await readSection();
    const shotAfter = await shot('03-ac-after-add');
    record('AC-add', confirmed && after.title === 'Containers (2)'
      && after.tableRows.some((r) => r.includes(CON2)) ? 'PASS' : 'FAIL',
    `modal=${JSON.stringify(modalTitle)} confirmed=${confirmed} → section=${JSON.stringify({ title: after.title, rows: after.tableRows.slice(0, 3) })} · ${shotModal} · ${shotAfter}`);
  } else {
    record('AC-add', 'FAIL', 'no add button → could not exercise the add flow');
  }

  // DB truth for the two containers, read straight from the API.
  const detail = await call('GET', `/shipments/${lotId}`, null, token);
  record('DB-truth', (detail.json?.containers?.length ?? 0) === 2 ? 'PASS' : 'FAIL',
    `GET /shipments/${lotId} → ${detail.json?.containers?.length} container(s): ${(detail.json?.containers ?? []).map((c) => c.containerNumber).join(', ')}`);
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
