// Round-14 Phase-0 probe 5 — FB-069/FB-074 multi-surface capture on lot 464:
// overview row, detail page, ledger expansion inputs, and any decimal echo.
import puppeteer from 'puppeteer';
import { appendFileSync, mkdirSync } from 'node:fs';

const BASE = 'https://vantai.tingting.vip';
const API = `${BASE}/api`;
const EV = '/Volumes/LexarSSD/projects/silversea-prod/testplan/qa/evidence/2026-10-11_round14-phase0';
const DRIVER_LOG = '/Volumes/LexarSSD/projects/silversea-prod/qa/2026-10-11_round14_phase0-ui-driver.log';
mkdirSync(EV, { recursive: true });
const step = (s, o = {}) => {
  const line = JSON.stringify({ at: new Date().toISOString(), step: s, ...o });
  appendFileSync(DRIVER_LOG, line + '\n');
  console.log(line);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const login = async (identifier) => {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password: 'Abc123' }),
  });
  if (!res.ok) throw new Error(`login ${identifier} failed: ${res.status}`);
  return (await res.json()).token;
};

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
const token = await login('thanhdc');
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 1000 });
await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);

// Overview list — the row for lots 463/464 and any decimal echo.
await page.goto(`${BASE}/shipments`, { waitUntil: 'networkidle0', timeout: 90000 }).catch(() => {});
await sleep(2500);
const overview = await page.evaluate(() => {
  const text = (document.body.innerText || '').replace(/\s+/g, ' ');
  return {
    decimalKg: (text.match(/[\d.,]+\.\d{2}\s*kg/g) || []).slice(0, 10),
    decimalAnywhere: (text.match(/\d+\.\d{2}/g) || []).slice(0, 15),
    rowsWith464: [...document.querySelectorAll('tr, [class*="row"]')].map((r) => (r.innerText || '').replace(/\s+/g, ' ')).filter((t) => /TEST-LCL|500/.test(t)).slice(0, 6),
  };
});
await page.screenshot({ path: `${EV}/fb069-10-overview-rows.png`, fullPage: true });
step('probe5-overview', overview);

// Detail page — expand container ledger / open per-container editors.
await page.goto(`${BASE}/shipments/464`, { waitUntil: 'networkidle0', timeout: 90000 }).catch(() => {});
await sleep(2500);
const before = await page.evaluate(() => ({
  decimalKg: ((document.body.innerText || '').match(/[\d.,]+\.\d{2}\s*kg/g) || []).slice(0, 10),
  decimalAnywhere: ((document.body.innerText || '').match(/\d+\.\d{2}/g) || []).slice(0, 15),
}));
// Try to open an edit affordance in the container ledger ("Sửa" / row click).
const opened = await page.evaluate(() => {
  const btns = [...document.querySelectorAll('button')].filter((b) => /^(Sửa|Chỉnh sửa|sửa)$/i.test((b.innerText || '').trim()) || /edit/i.test(b.getAttribute('aria-label') || ''));
  if (btns.length) { btns[0].click(); return btns[0].innerText.trim() || btns[0].getAttribute('aria-label'); }
  return null;
});
await sleep(1500);
const afterEdit = await page.evaluate((openLabel) => ({
  opened: openLabel,
  inputs: [...document.querySelectorAll('input')].map((i) => `${i.type}:${i.value}`).filter((v) => /\d/.test(v)).slice(0, 25),
  decimalVisible: ((document.body.innerText || '').match(/[\d.,]+\.\d{2}/g) || []).slice(0, 15),
}), opened);
await page.screenshot({ path: `${EV}/fb069-11-detail-editor.png`, fullPage: true });
step('probe5-detail', { before, opened, afterEdit });

// /shipments-detail — ShipmentContainersPage ("Chi tiết" containers view).
await page.goto(`${BASE}/shipments-detail`, { waitUntil: 'networkidle0', timeout: 90000 }).catch(() => {});
await sleep(3000);
const containersPage = await page.evaluate(() => {
  const text = (document.body.innerText || '').replace(/\s+/g, ' ');
  return {
    decimalKg: (text.match(/[\d.,]+\.\d{2}\s*kg/g) || []).slice(0, 15),
    decimalAnywhere: (text.match(/\d+\.\d{2}/g) || []).slice(0, 15),
    inputDecimals: [...document.querySelectorAll('input')].map((i) => i.value).filter((v) => /\d+\.\d{2}/.test(v)).slice(0, 15),
    sample: text.slice(0, 500),
  };
});
await page.screenshot({ path: `${EV}/fb069-12-containers-page.png`, fullPage: true });
step('probe5-containers-page', containersPage);

await browser.close();
step('probe5-complete');
