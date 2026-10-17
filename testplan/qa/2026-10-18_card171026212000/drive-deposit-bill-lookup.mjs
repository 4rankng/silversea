// Card 171026212000 (FB-096 verify-fail) — rung 3 driver: real click on
// Thêm cược → "Tra cứu Bill (4 số cuối)" → suggestions for a lot whose
// printed tail is NOT four digits (FB020-R21-RB1, digits tail 2021).
// Read-only flow: the dialog is closed without saving; API↔DB identity and
// unchanged deposit_tracker state prove the read changed nothing.
//
// Run from repo root against THIS worktree's servers:
//   backend :3090 (fixed code) · frontend :7176 (proxy → 3090)
//   node testplan/qa/2026-10-18_card171026212000/drive-deposit-bill-lookup.mjs
import puppeteer from 'puppeteer-core';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const API = 'http://localhost:3090/api';
const APP = 'http://localhost:7176';
const OUT = 'qa';
const STAMP = '2026-10-18_171026212000';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const logLines = [];
const log = (line) => { logLines.push(`[${new Date().toISOString()}] ${line}`); console.log(line); };
const die = (msg) => { log(`FATAL ${msg}`); fs.writeFileSync(`${OUT}/${STAMP}_ui-driver.log`, logLines.join('\n') + '\nEXIT=1\n'); process.exit(1); };

const psql = (sql) => execFileSync('docker', ['exec', 'ss-prod-db', 'psql', '-U', 'postgres', '-d', 'silversea', '-t', '-A', '-c', sql], { encoding: 'utf8' }).trim();

// ── login + persisted-state baseline ──
const loginRes = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'ketoan', password: 'Abc123' }) });
if (!loginRes.ok) die(`login -> ${loginRes.status}`);
const { token } = await loginRes.json();
const authJson = async (path) => (await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` } })).json();
const trackersBefore = psql('select count(*) from deposit_refund_trackers');
log(`baseline deposit_refund_trackers count = ${trackersBefore}`);

// ── API identity proof for the failing tail (pre-fix this returned []) ──
// FB020-R21-RB1's digit run is 020211 (the "1" in "RB1" counts), so the
// accountant's "4 số cuối" for it is 0211.
const apiSuggest = await authJson('/accounting/deposits/bill-suggestions?q=0211');
log(`API q=0211 items = ${JSON.stringify(apiSuggest.items.map((i) => ({ shipmentId: i.shipmentId, billNumber: i.billNumber, customerName: i.customerName })))}`);
const target = apiSuggest.items.find((i) => i.billNumber === 'FB020-R21-RB1');
if (!target) die('API q=0211 does not include FB020-R21-RB1');
const dbRow = psql(`select id || '|' || coalesce(bl_number,'') || '|' || coalesce(raw_customer_name,'') || '|' || coalesce(customer_id::text,'') from shipments where id = ${target.shipmentId}`);
log(`DB row shipmentId=${target.shipmentId} (id|bl_number|raw_customer_name|customer_id) = ${dbRow}`);
if (!dbRow.startsWith(`${target.shipmentId}|FB020-R21-RB1|`)) die('API↔DB identity mismatch');

// ── browser drive ──
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage', '--lang=vi'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
page.on('pageerror', (e) => log(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') log(`console.error: ${m.text().slice(0, 300)}`); });
await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
await page.goto(`${APP}/accounting/deposit-tracker`, { waitUntil: 'networkidle2', timeout: 30000 });
await page.waitForSelector('button', { timeout: 15000 });
const hasBtn = await page.evaluate(() => [...document.querySelectorAll('button')].some((b) => b.textContent?.trim() === 'Thêm cược'));
if (!hasBtn) die('Thêm cược button not found (login or route failed)');
await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Thêm cược')?.click());
await page.waitForSelector('[role="dialog"]', { timeout: 10000 });
log('dialog opened');

const lookup = 'input[placeholder="4 số cuối"]';
await page.waitForSelector(lookup, { timeout: 10000 });
await page.click(lookup);
await page.type(lookup, '0211', { delay: 60 });
await page.waitForSelector('.bill-suggestions__item', { timeout: 10000 });
await new Promise((r) => setTimeout(r, 400));
await page.screenshot({ path: `${OUT}/${STAMP}_ui-02-suggestions.png` });
const items = await page.evaluate(() => [...document.querySelectorAll('.bill-suggestions__item')].map((li) => li.textContent?.trim().replace(/\s+/g, ' ')));
log(`suggestion items = ${JSON.stringify(items)}`);
if (!items.some((t) => t.includes('FB020-R21-RB1'))) die('FB020-R21-RB1 not among rendered suggestions');

// pick → autofill (read-only: no save)
await page.evaluate(() => [...document.querySelectorAll('.bill-suggestions__item')].find((li) => li.textContent?.includes('FB020-R21-RB1'))?.click());
await new Promise((r) => setTimeout(r, 500));
const autofill = await page.evaluate(() => {
  const out = {};
  for (const label of document.querySelectorAll('[role="dialog"] label')) {
    const input = label.htmlFor ? document.getElementById(label.htmlFor) : label.parentElement?.querySelector('input');
    if (input) out[label.textContent?.trim()] = input.value;
  }
  return out;
});
log(`autofill = ${JSON.stringify(autofill)}`);
if (autofill['Số Bill'] !== 'FB020-R21-RB1') die(`Số Bill not autofilled: ${autofill['Số Bill']}`);
await page.screenshot({ path: `${OUT}/${STAMP}_ui-03-autofilled.png` });

// negative: tail with no lots → honest no-match line, not an error
await page.click(lookup);
await page.evaluate(() => { const el = document.querySelector('input[placeholder="4 số cuối"]'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(el, ''); el.dispatchEvent(new Event('input', { bubbles: true })); });
await page.type(lookup, '9091', { delay: 60 });
await page.waitForFunction(() => document.body.innerText.includes('Không có lô hàng nào kết thúc bằng 9091'), { timeout: 10000 });
await page.screenshot({ path: `${OUT}/${STAMP}_ui-04-nomatch.png` });
log('no-match line rendered for 9091');

// close without saving; persisted state unchanged
await page.evaluate(() => document.querySelector('[role="dialog"] button[aria-label], [role="dialog"] .modal__close, [role="dialog"] button')?.click());
await new Promise((r) => setTimeout(r, 500));
await page.keyboard.press('Escape').catch(() => {});
await new Promise((r) => setTimeout(r, 500));
const trackersAfter = psql('select count(*) from deposit_refund_trackers');
log(`post-drive deposit_refund_trackers count = ${trackersAfter} (unchanged: ${trackersAfter === trackersBefore})`);

await browser.close();
fs.writeFileSync(`${OUT}/${STAMP}_ui-driver.log`, logLines.join('\n') + '\nEXIT=0\n');
console.log('DRIVER OK');
process.exit(0);
