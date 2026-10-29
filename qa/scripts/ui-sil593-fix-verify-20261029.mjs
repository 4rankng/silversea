// SIL-593 fix verification — UI DRIVEN (rung 3) on local dev (:7175).
// C1: dieuvan (DISPATCHER) opens /shipments/382 → lot renders.
// C2: admin opens /shipments/631 → lot renders.
// C3: /shipments/999999 (missing) → "Không tìm thấy lô hàng." without retry wording.
// C4: transient 500 on getShipmentDetail → keeps "Vui lòng thử lại." wording.
import puppeteer from 'puppeteer';
import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { resolve } from 'node:path';

const FE = process.env.QA_BASE_URL || 'http://localhost:7175';
const API = 'http://localhost:3002/api';
const OUT = resolve('qa');
const log = [];
const say = (l) => { log.push(l); console.log(l); };
let checks = 0; const fails = [];
const check = (name, ok, detail = '') => {
  checks += 1;
  say(`  ${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) fails.push(name);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

mkdirSync(OUT, { recursive: true });
const browser = await puppeteer.launch({ headless: 'new', protocolTimeout: 120000 });
try {
  // ── C1: DISPATCHER renders the lot ────────────────────────────────────────
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  await page.goto(`${FE}/login`, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.type('input[name="username"]', 'dieuvan');
  await page.type('input[name="password"]', 'Abc123');
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), page.click('button[type="submit"]')]);
  await sleep(1500);
  say('C1 — DISPATCHER /shipments/382');
  await page.goto(`${FE}/shipments/382`, { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(3000);
  const c1 = await page.evaluate(() => {
    const heading = [...document.querySelectorAll('h1,h2,h3')].some((h) => h.textContent?.includes('Chi tiết lô hàng'));
    const bill = document.querySelector('[data-field-id="shipment-booking-ref"] input');
    const alert = document.querySelector('[role="alert"]');
    return { heading, bill: bill?.value ?? null, alert: alert?.textContent ?? null };
  });
  check('C1 dispatch renders Chi tiết lô hàng + Số Bill', c1.heading && !!c1.bill && c1.alert == null, JSON.stringify(c1));
  await page.screenshot({ path: `${OUT}/2026-10-29_sil593_ui-c1-dispatch-382.png` });

  // ── C2: ADMIN renders the lot ─────────────────────────────────────────────
  await page.evaluate(() => { window.localStorage.clear(); });
  await page.goto(`${FE}/login`, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForSelector('input[name="username"]', { timeout: 20000 });
  await page.type('input[name="username"]', 'admin');
  await page.type('input[name="password"]', 'Abc123');
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), page.click('button[type="submit"]')]);
  await sleep(1500);
  say('C2 — ADMIN /shipments/631');
  await page.goto(`${FE}/shipments/631`, { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(3000);
  const c2 = await page.evaluate(() => {
    const heading = [...document.querySelectorAll('h1,h2,h3')].some((h) => h.textContent?.includes('Chi tiết lô hàng'));
    const bill = document.querySelector('[data-field-id="shipment-booking-ref"] input');
    const alert = document.querySelector('[role="alert"]');
    return { heading, bill: bill?.value ?? null, alert: alert?.textContent ?? null };
  });
  check('C2 admin renders Chi tiết lô hàng + Số Bill', c2.heading && !!c2.bill && c2.alert == null, JSON.stringify(c2));
  await page.screenshot({ path: `${OUT}/2026-10-29_sil593_ui-c2-admin-631.png` });

  // ── C3: missing lot → "Không tìm thấy lô hàng." (no retry wording) ───────
  say('C3 — missing lot /shipments/999999');
  await page.goto(`${FE}/shipments/999999`, { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(3000);
  const c3 = await page.evaluate(() => {
    const alert = document.querySelector('[role="alert"]');
    const text = alert?.textContent ?? '';
    return { text, hasNotFound: text.includes('Không tìm thấy lô hàng'), hasRetry: text.includes('Vui lòng thử lại') };
  });
  check('C3 404 wording = Không tìm thấy lô hàng, no retry', c3.hasNotFound && !c3.hasRetry, JSON.stringify(c3));
  await page.screenshot({ path: `${OUT}/2026-10-29_sil593_ui-c3-not-found.png` });

  // ── C4: transient 500 keeps the retry wording ────────────────────────────
  say('C4 — transient 500 on getShipmentDetail');
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    if (req.url().includes('/api/shipments/382') && req.method() === 'GET') {
      req.respond({ status: 500, contentType: 'application/json', body: '{"error":"boom"}' });
    } else {
      req.continue();
    }
  });
  await page.goto(`${FE}/shipments/382`, { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(3000);
  const c4 = await page.evaluate(() => {
    const alert = document.querySelector('[role="alert"]');
    const text = alert?.textContent ?? '';
    return { text, hasRetry: text.includes('Vui lòng thử lại') };
  });
  check('C4 transient keeps Vui lòng thử lại', c4.hasRetry, JSON.stringify(c4));
  await page.screenshot({ path: `${OUT}/2026-10-29_sil593_ui-c4-transient.png` });
  await page.close();

  // ── API identity + persisted-state proof (read-only change) ──────────────
  const login = await fetch(`${API}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: 'dieuvan', password: 'Abc123' }),
  }).then((r) => r.json());
  const detail = await fetch(`${API}/shipments/382`, {
    headers: { Authorization: `Bearer ${login.token}` },
  }).then((r) => r.json());
  const identity = {
    id: detail.shipment?.id, blNumber: detail.shipment?.blNumber,
    version: detail.shipment?.version, status: detail.shipment?.status,
    containers: detail.containers?.length,
  };
  say(`API identity /shipments/382: ${JSON.stringify(identity)}`);
  writeFileSync(`${OUT}/2026-10-29_sil593_db-api-identity.json`, JSON.stringify(identity, null, 2));
} finally {
  await browser.close();
}

say(`DONE checks=${checks} fails=${fails.length}`);
appendFileSync(`${OUT}/2026-10-29_sil593_ui-driver.log`, `${log.join('\n')}\n`);
process.exit(fails.length ? 1 : 0);
