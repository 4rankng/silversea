/**
 * SIL-552 edge case — a LONG container number.
 *
 * The review asked whether a long value could spill over the row below it
 * (the rows were a fixed 36px). The rows are min-height now, so a wrapping
 * value grows its row — but the DOMAIN rule turns out to be stricter than the
 * schema: the backend only accepts `XXXXNNNNNNN` (4 letters + 7 digits), so a
 * 50-character container number is REJECTED with 400 "Sai định dạng".
 *
 * This drive records that: it tries the 50-character write, measures the rows
 * (no overlap, the value inside its own row) and restores the original value.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const BASE = process.argv[2] ?? 'http://localhost:7188';
const API = 'http://localhost:3002/api';
const OUT = 'qa/2026-10-28_sil552-tthang';
const LONG = 'TSTU' + '9'.repeat(46); // 50 chars — the schema cap
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

async function tryLogin(username) {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: username, password: 'Abc123' }),
  });
  if (!res.ok) return null;
  const body = await res.json();
  return body.token ?? null;
}
let token = await tryLogin('cus') ?? await tryLogin('admin');
if (!token) throw new Error('login failed');

mkdirSync(OUT, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'],
});
const report = { long: LONG, rows: null, restore: null };

try {
  const page = await browser.newPage();
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 2 });
  await page.goto(`${BASE}/shipments`, { waitUntil: 'networkidle0', timeout: 60000 });
  await page.waitForSelector('button[aria-label*="Mở chi tiết lô hàng"]', { timeout: 30000 });

  const buttons = await page.$$('button[aria-label*="Mở chi tiết lô hàng"]');
  let opened = false;
  for (let i = 0; i < Math.min(buttons.length, 12) && !opened; i += 1) {
    await buttons[i].click();
    try {
      await page.waitForSelector('.cus-lot-table', { timeout: 4000 });
      opened = true;
    } catch {
      await page.keyboard.press('Escape');
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  if (!opened) throw new Error('no lot with containers opened');
  await new Promise((r) => setTimeout(r, 1200));

  const drawerId = await page.evaluate(() => {
    const el = document.querySelector('[id^="cus-detail-drawer-"]');
    return el ? Number(el.id.replace('cus-detail-drawer-', '')) : null;
  });
  const original = await page.evaluate(async (shipmentId) => {
    const res = await fetch(`/api/shipments/cus-workspace/${shipmentId}`, { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });
    const detail = await res.json();
    const line = (detail.containers ?? [])[0];
    return line ? { shipmentId: detail.summary.id, containerId: line.id, number: line.containerNumber } : null;
  }, drawerId);

  // Write the long number straight through the API, then reload the drawer.
  const version = (await (await fetch(`${API}/shipments/cus-workspace/${original.shipmentId}`, { headers: { Authorization: `Bearer ${token}` } })).json()).summary.version;
  const write = await fetch(`${API}/shipments/cus-workspace/${original.shipmentId}/containers/${original.containerId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'Idempotency-Key': `long-${Date.now()}` },
    body: JSON.stringify({ expectedShipmentVersion: version, containerNumber: LONG }),
  });
  report.writeStatus = write.status;

  await page.reload({ waitUntil: 'networkidle0', timeout: 60000 });
  await page.waitForSelector('button[aria-label*="Mở chi tiết lô hàng"]', { timeout: 30000 });
  const buttons2 = await page.$$('button[aria-label*="Mở chi tiết lô hàng"]');
  for (let i = 0; i < Math.min(buttons2.length, 12); i += 1) {
    await buttons2[i].click();
    try {
      await page.waitForSelector('.cus-lot-table', { timeout: 4000 });
      break;
    } catch {
      await page.keyboard.press('Escape');
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  await new Promise((r) => setTimeout(r, 1500));

  report.rows = await page.evaluate(() => {
    const group = document.querySelector('.cus-lot-contgroup');
    const lines = group ? [...group.querySelectorAll('.cus-lot-line')] : [];
    const rects = lines.map((line) => {
      const r = line.getBoundingClientRect();
      return { h: Math.round(r.height * 100) / 100, top: Math.round(r.top), bottom: Math.round(r.bottom) };
    });
    // The value must stay inside its own row — no spill over the next line.
    const value = group?.querySelector('.cus-lot-line--number .cus-lot-line__value');
    const valueRect = value?.getBoundingClientRect();
    const firstRow = rects[0];
    return {
      rects,
      // Rows must not overlap each other.
      noOverlap: rects.every((r, i) => i === 0 || r.top >= rects[i - 1].bottom),
      // The long value fits INSIDE its row.
      valueInsideRow: valueRect && firstRow ? valueRect.bottom <= firstRow.bottom + 1 : null,
      valueHeight: valueRect ? Math.round(valueRect.height * 100) / 100 : null,
      firstRowHeight: firstRow?.h ?? null,
      text: value?.textContent?.trim() ?? null,
    };
  });

  await page.evaluate(() => {
    const card = [...document.querySelectorAll('.cus-lot-card')].find((el) => el.textContent.includes('Thông tin hàng'));
    card?.scrollIntoView({ block: 'start' });
  });
  await new Promise((r) => setTimeout(r, 400));
  await page.screenshot({ path: `${OUT}/sil552_long-number_1280.png`, fullPage: false });

  // Restore the original number.
  const currentVersion = (await (await fetch(`${API}/shipments/cus-workspace/${original.shipmentId}`, { headers: { Authorization: `Bearer ${token}` } })).json()).summary.version;
  const restore = await fetch(`${API}/shipments/cus-workspace/${original.shipmentId}/containers/${original.containerId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'Idempotency-Key': `restore-long-${Date.now()}` },
    body: JSON.stringify({ expectedShipmentVersion: currentVersion, containerNumber: original.number }),
  });
  const restored = (await (await fetch(`${API}/shipments/cus-workspace/${original.shipmentId}`, { headers: { Authorization: `Bearer ${token}` } })).json()).containers?.[0]?.containerNumber ?? null;
  report.restore = { status: restore.status, readBack: restored, original: original.number };

  writeFileSync(`${OUT}/sil552_long-number_report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
