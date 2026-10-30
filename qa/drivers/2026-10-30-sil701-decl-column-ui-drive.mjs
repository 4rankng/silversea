// SIL-701 UI DRIVEN (rung 3) — create form's Thông tin hàng SỐ TỜ KHAI column.
// C1 (structure @1440): header order STT · Số container · Số tờ khai · Nhà máy ·
//    Tuyến đường · Cảng nâng · Cảng hạ · Ngày giờ đóng trả · Thao tác; one
//    per-cont input per row; merged SỐ CONTAINER group intact; no lot-level
//    declaration UI.
// C2 (per-cont entry): type a number into row 1's SỐ TỜ KHAI input, then
//    STT-duplicate the row — the clone carries the number (explicit row copy,
//    same-lot repeats legal).
// C3 (persist): submit "Tạo lô hàng" → GET /api/shipments/:id shows BOTH
//    containers carrying the number; DB rows proofed separately via psql.
// C4 (responsive): screenshots of the table @1440 / @768 / @390 (card record).
// Cleanup: the created local lot is deleted via the API and the status logged.
import puppeteer from 'puppeteer';
import fs from 'node:fs';

const BASE = process.env.BASE ?? 'http://localhost:7175';
const API = `${BASE}/api`;
const OUT = process.env.EVIDENCE ?? 'qa/2026-10-30_sil701-decl-column';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DECL = 'TK-SIL701-R3';
const log = [];
const say = (l) => { log.push(l); console.log(l); };
let checks = 0; const fails = [];
const check = (name, ok, detail = '') => {
  checks += 1;
  say(`  ${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) fails.push(name);
};

let L = null;
for (let i = 1; i <= 3 && !L?.token; i++) {
  const t = await (await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: process.env.QA_USER ?? 'cus', password: 'Abc123' }),
  })).text();
  try { L = JSON.parse(t); } catch { await sleep(1200 * i); }
}
if (!L?.token) { console.log('LOGIN FAILED'); process.exit(1); }
say(`LOGIN OK (${process.env.QA_USER ?? 'cus'}) — evidence dir ${OUT}`);

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 1000 });
await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), L.token);
page.on('pageerror', (err) => say(`PAGEERROR: ${err.message}`));

const created = { id: null };

try {
  await page.goto(`${BASE}/shipments/new`, { waitUntil: 'networkidle2', timeout: 45000 });
  await page.waitForSelector('#shipment-section-cargo', { timeout: 20000 });
  await sleep(600);

  // ── C1 — DOM column structure + the changed control exists ──────────────
  say('C1 — column structure @1440');
  const structure = await page.evaluate(() => {
    const table = document.querySelector('.csc-container-table');
    const headers = [...(table?.querySelectorAll('thead th') ?? [])].map((th) => th.textContent.trim());
    // UUIInput (react-aria) owns the input's DOM id — the stable handles are
    // the accessible name and the cell's data-field-id (SIL-552 chrome).
    const inputs = [...(table?.querySelectorAll('tbody input[aria-label="Số tờ khai"]') ?? [])];
    const groupCell = table?.querySelector('.csc-contgroup-cell');
    const groupLines = [...(groupCell?.querySelectorAll('.csc-contgroup > *') ?? [])].length;
    const lotLevel = Boolean(document.querySelector('.csc-declaration-strip, [data-field-id="shipment-declarations"]'));
    return {
      headers,
      declInputCount: inputs.length,
      declFieldIdSample: table?.querySelector('[data-field-id$="-declaration"]')?.getAttribute('data-field-id') ?? null,
      declPlaceholder: inputs[0]?.placeholder ?? null,
      declMaxLength: inputs[0]?.maxLength ?? null,
      groupLines,
      lotLevelDeclarationUi: lotLevel,
      thOneLiner: [...(table?.querySelectorAll('thead th') ?? [])].every((th) => th.getBoundingClientRect().height <= 34),
    };
  });
  check('C1 header order exact', JSON.stringify(structure.headers) === JSON.stringify([
    'STT', 'Số container', 'Số tờ khai', 'Nhà máy', 'Tuyến đường', 'Cảng nâng', 'Cảng hạ', 'Ngày giờ đóng trả', 'Thao tác',
  ]), JSON.stringify(structure.headers));
  check('C1 one per-cont input on row 1 (placeholder Nhập số tờ khai, maxLength 50)',
    structure.declInputCount === 1 && structure.declPlaceholder === 'Nhập số tờ khai' && structure.declMaxLength === 50,
    JSON.stringify({ count: structure.declInputCount, ph: structure.declPlaceholder, max: structure.declMaxLength, fieldId: structure.declFieldIdSample }));
  check('C1 merged SỐ CONTAINER group intact (3 lines)', structure.groupLines === 3, `lines=${structure.groupLines}`);
  check('C1 no lot-level declaration UI', structure.lotLevelDeclarationUi === false);
  check('C1 headers stay one line', structure.thOneLiner === true);
  await page.screenshot({ path: `${OUT}/2026-10-30_sil701_ui-c1-table-1440.png`, fullPage: false });

  // ── C2 — fill row 1 fully + the declaration, then STT-duplicate ────────
  say('C2 — per-cont declaration entry + duplicate carries it');
  const pickFirstOption = async () => {
    await page.waitForSelector('[role="option"]', { timeout: 8000 });
    await sleep(250);
    await page.click('[role="option"]');
    await sleep(350);
  };
  const clearType = async (sel) => {
    await page.click(sel, { clickCount: 3 });
    await page.keyboard.down('Control');
    await page.keyboard.press('a');
    await page.keyboard.up('Control');
    await sleep(120);
    await page.keyboard.press('Backspace');
  };

  // customer + direction + Số Bill (row readiness: type/factory/ports/date too)
  await page.click('input[data-field="shipment-customer"], [data-field="shipment-customer"] input');
  await page.type('input[data-field="shipment-customer"], [data-field="shipment-customer"] input', 'a', { delay: 40 });
  await sleep(500);
  await pickFirstOption();
  // trade direction = USelectField (button trigger + listbox — the page tests
  // pick 'Nhập khẩu' via role=option). The trigger's accessible name comes
  // from label association, so anchor on the field-id container.
  await page.evaluate(() => {
    document.querySelector('[data-field-id="shipment-trade-direction"] button')?.click();
  });
  await sleep(500);
  await page.evaluate(() => {
    const opt = [...document.querySelectorAll('[role="option"]')].find((o) => o.textContent.trim() === 'Nhập khẩu');
    opt?.click();
  });
  await sleep(400);
  await page.type('[data-field-id="shipment-booking-ref"] input', 'BILL-SIL701', { delay: 20 });

  // row 1: số container (MSKU1234565 = ISO 6346 check-digit valid per the
  // shared iso6346 suite) + loại (floating editor keeps its input mounted)
  await page.type('[data-field-id$="-number"] input', 'MSKU1234565', { delay: 20 });
  const typeSel = '[data-field-id$="-type"] input';
  await page.waitForSelector(typeSel, { timeout: 10000 });
  await page.click(typeSel);
  await page.type(typeSel, '20', { delay: 40 });
  await sleep(600);
  await pickFirstOption();
  // factory → route authority resolves itself
  const factorySel = '[data-field-id$="-factory"] input';
  await page.click(factorySel);
  await page.type(factorySel, 'a', { delay: 40 });
  await sleep(600);
  await pickFirstOption();
  for (const port of ['-pickup-port', '-dropoff-port']) {
    const sel = `[data-field-id$="${port}"] input`;
    await page.click(sel);
    await page.type(sel, 'a', { delay: 40 });
    await sleep(600);
    await pickFirstOption();
  }
  await clearType('input[id$="-customer-appointment-date"]');
  await page.type('input[id$="-customer-appointment-date"]', '05112026', { delay: 60 });
  await clearType('input[id$="-customer-appointment-time"]');
  await page.type('input[id$="-customer-appointment-time"]', '0800', { delay: 60 });
  await page.click('body');
  await sleep(400);

  // THE CHANGED CONTROL: type the per-cont declaration on row 1.
  await page.type('tbody input[aria-label="Số tờ khai"]', DECL, { delay: 30 });
  await sleep(200);
  const afterType = await page.evaluate(() => document.querySelector('tbody input[aria-label="Số tờ khai"]')?.value ?? null);
  check('C2 row 1 declaration input accepts the number', afterType === DECL, `value=${afterType}`);
  await page.screenshot({ path: `${OUT}/2026-10-30_sil701_ui-c2-typed-1440.png`, fullPage: false });

  // STT duplicate — full-value clone below; the declaration rides along.
  await page.click('button[aria-label="Nhân bản container 1"]');
  await sleep(600);
  // The clone keeps the source's container number — give row 2 its own
  // ISO-valid identity (ALLU5216535) so the BE per-lot number gate is not
  // the thing under test here. Native value setter + input event: the
  // controlled react-aria input ignores keyboard selection quirks this way.
  await page.evaluate(() => {
    const inputs = [...document.querySelectorAll('input[aria-label="Số container"]')];
    const el = inputs[1];
    if (!el) return;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(el, 'ALLU5216535');
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await sleep(300);
  const dup = await page.evaluate(() => {
    const inputs = [...document.querySelectorAll('tbody input[aria-label="Số tờ khai"]')];
    return {
      count: inputs.length,
      values: inputs.map((i) => i.value),
      numbers: [...document.querySelectorAll('input[aria-label="Số container"]')].map((i) => i.value),
    };
  });
  check('C2 duplicate row carries the SAME declaration (in-lot repeat legal)',
    dup.count === 2 && dup.values.every((v) => v === DECL), JSON.stringify(dup));

  // ── C4 — responsive screenshots before submit ──────────────────────────
  say('C4 — responsive captures');
  for (const [w, h] of [[1440, 1000], [768, 900], [390, 844]]) {
    await page.setViewport({ width: w, height: h });
    await sleep(700);
    await page.screenshot({ path: `${OUT}/2026-10-30_sil701_ui-c4-table-${w}.png`, fullPage: true });
  }
  await page.setViewport({ width: 1440, height: 1000 });
  await sleep(400);

  // ── C3 — submit and prove persistence ──────────────────────────────────
  say('C3 — submit Tạo lô hàng');
  const apiSeen = [];
  page.on('response', (res) => {
    if (res.url().includes('/api/shipments')) apiSeen.push(`${res.request().method()} ${res.url().replace(/^.*\/api/, '/api')} → ${res.status()}`);
  });
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Tạo lô hàng');
    btn?.click();
  });
  await sleep(6000);
  const landed = await page.evaluate(() => ({
    url: location.pathname,
    summary: document.querySelector('.csc-validation-summary')?.textContent ?? null,
    alerts: [...document.querySelectorAll('[role="alert"], .csc-form-error')].map((e) => e.textContent.trim()).filter(Boolean).slice(0, 3),
    body: document.body.textContent.slice(0, 400),
  }));
  say(`after submit: url=${landed.url} summary=${landed.summary} alerts=${JSON.stringify(landed.alerts)}`);
  say(`api: ${JSON.stringify(apiSeen)}`);
  const idMatch = landed.url.match(/\/shipments\/(\d+)/);
  created.id = idMatch ? Number(idMatch[1]) : null;

  const persisted = await page.evaluate(async () => {
    const m = location.pathname.match(/\/shipments\/(\d+)/);
    if (!m) return { error: 'no lot id in URL', url: location.pathname };
    const res = await fetch(`/api/shipments/${m[1]}`, { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });
    const d = await res.json();
    return {
      lotId: Number(m[1]),
      status: res.status,
      containers: (d.containers ?? []).map((c) => ({ id: c.id, containerNumber: c.containerNumber, declarationNumber: c.declarationNumber })),
    };
  });
  say(`persisted: ${JSON.stringify(persisted)}`);
  const containers = persisted.containers ?? [];
  check('C3 BOTH containers persist the per-cont declaration at create time',
    containers.length === 2 && containers.every((c) => c.declarationNumber === DECL),
    JSON.stringify(containers));
  await page.screenshot({ path: `${OUT}/2026-10-30_sil701_ui-c3-created-detail.png`, fullPage: false });
  fs.writeFileSync(`${OUT}/c3-persisted.json`, JSON.stringify(persisted, null, 2));

  // ── Cleanup — remove the local evidence lot, log the outcome ───────────
  // SKIPPABLE: the DB-side proof runs against the live lot before deletion.
  if (created.id != null && process.env.SKIP_CLEANUP !== '1') {
    const admin = await (await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: 'admin', password: 'Abc123' }),
    })).json();
    const current = await (await fetch(`${API}/shipments/${created.id}`, {
      headers: { Authorization: `Bearer ${admin.token}` },
    })).json();
    const version = current?.shipment?.version ?? current?.version;
    const del = await fetch(`${API}/shipments/${created.id}?version=${version}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${admin.token}`, 'Idempotency-Key': `cleanup-sil701-${Date.now()}` },
    });
    say(`cleanup DELETE /api/shipments/${created.id}?version=${version} → ${del.status}`);
  }
} finally {
  fs.writeFileSync(`${OUT}/ui-driver.log`, log.join('\n') + `\nCHECKS ${checks - fails.length}/${checks} · FAILS: ${fails.join(', ') || 'none'}\n`);
  await browser.close();
  console.log(`CHECKS ${checks - fails.length}/${checks} · FAILS: ${fails.join(', ') || 'none'}`);
  if (fails.length > 0) process.exit(2);
}
