// SIL-630 — CUS drawer quick-edit probe (staging): edit the LOẠI line of an
// existing container via the drawer's UuiSelectField editor, then restore.
//   node qa/scripts/tmp-sil630/drawer-probe.mjs <front> <api> <lotId> <lotCode>
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const FRONT = process.argv[2] ?? 'http://localhost:7175';
const API = process.argv[3] ?? 'http://localhost:3003/api';
const LOT_ID = Number(process.argv[4] ?? 429);
const LOT_CODE = process.argv[5] ?? 'SHP-2610-00308';
const OUT = path.resolve('qa/2026-10-31_sil630/probe');
fs.mkdirSync(OUT, { recursive: true });
const log = (line) => { console.log(line); fs.appendFileSync(path.join(OUT, 'drawer.log'), line + '\n'); };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const { token } = await fetch(`${API}/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: FRONT.includes('tingting.vip') ? 'thanhdc' : 'cus', password: 'Abc123' }),
}).then((r) => r.json());

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
// Rewrite the bootstrap containerTypes into the STAGING array order
// [1,2,6,3,4,5,7] so the local drawer runs against staging data order.
if (process.env.REORDER === '1') {
  await page.setRequestInterception(true);
  const bootstrap = await fetch(`${API}/catalogs/bootstrap`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json());
  const byId = new Map(bootstrap.containerTypes.map((ct) => [ct.id, ct]));
  bootstrap.containerTypes = [1, 2, 6, 3, 4, 5, 7].map((id) => byId.get(id)).filter(Boolean);
  page.on('request', (req) => {
    if (req.url().includes('/catalogs/bootstrap')) {
      req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(bootstrap) }).catch(() => {});
    } else if (req.url().includes('/cus-workspace/')) {
      req.continue();
    } else req.continue();
  });
}
const shot = (name) => page.screenshot({ path: path.join(OUT, `drawer-${name}.png`) });

await page.goto(`${FRONT}/shipments?searchSuffix=${encodeURIComponent(LOT_CODE)}`, { waitUntil: 'networkidle2', timeout: 60000 });
await page.waitForSelector(`#cus-dashboard-detail-${LOT_ID}`, { timeout: 30000 });
await page.click(`#cus-dashboard-detail-${LOT_ID}`);
await sleep(800);
// Expand the row's inline summary, then open the full lot view ("Chi tiết").
await page.evaluate(() => {
  const hit = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Chi tiết' && b.offsetParent !== null);
  hit?.click();
});
await sleep(1500);
await shot('0-drawer');
const btnDump = await page.evaluate(() => [...document.querySelectorAll('button')].map((b) => b.textContent?.trim()).filter((t) => t && t.length < 30).slice(0, 40));
log('buttons after drawer open: ' + JSON.stringify(btnDump));
log('drawer open');

const readTypeLine = () => page.evaluate(() => {
  const line = [...document.querySelectorAll('.cus-lot-line--type')][0];
  return {
    value: line?.querySelector('.cus-lot-line__value')?.textContent?.trim() ?? null,
    triggerExpanded: line?.querySelector('button')?.getAttribute('aria-expanded') ?? null,
  };
});
log('type line at rest: ' + JSON.stringify(await readTypeLine()));

// Open the LOẠI editor line (trigger aria-label from CusLotView).
const opened = await page.evaluate(() => {
  const trigger = document.querySelector('button[aria-label="Chỉnh sửa loại container — dòng 1"]')
    ?? [...document.querySelectorAll('.cus-lot-line--type button')][0];
  trigger?.click();
  return Boolean(trigger);
});
log(`type trigger found: ${opened}`);
await sleep(600);
await shot('1-editor-open');

// The editor holds a UuiSelectField (plain select) — trigger button inside
// [role="dialog"].cus-lot-editor.
const menuDump = await page.evaluate(() => {
  const editor = document.querySelector('.cus-lot-editor');
  if (!editor) return { editor: false, options: [] };
  const btn = editor.querySelector('button[data-uui-control="select"]');
  if (btn) btn.click();
  return { editor: true, clicked: Boolean(btn) };
});
log('editor dump: ' + JSON.stringify(menuDump));
await sleep(500);
const options = await page.evaluate(() => [...document.querySelectorAll('[role="listbox"] [role="option"]')]
  .filter((el) => el instanceof HTMLElement && el.offsetParent !== null)
  .map((el) => ({ text: el.textContent?.trim(), dataValue: el.getAttribute('data-value') ?? el.id })));
log('type menu: ' + JSON.stringify(options));
await shot('2-menu-open');

// Pick 40DC.
const picked = await page.evaluate(() => {
  const hit = [...document.querySelectorAll('[role="listbox"] [role="option"]')]
    .find((el) => el.textContent?.trim() === '40DC' && el instanceof HTMLElement && el.offsetParent !== null);
  if (!hit) return false;
  hit.click();
  return true;
});
log(`picked 40DC: ${picked}`);
await sleep(1500);
await shot('3-after-pick');
log('type line after 40DC pick: ' + JSON.stringify(await readTypeLine()));

// Verify via API what the line now stores.
const detail = await fetch(`${API}/shipments/cus-workspace/${LOT_ID}`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json()).catch(() => null);
if (detail?.containers) {
  log('API containers: ' + JSON.stringify(detail.containers.map((c) => ({ n: c.containerNumber, t: c.containerTypeId, code: c.containerTypeCode ?? c.containerTypeLabel }))));
} else {
  log('API cus-workspace detail unavailable: ' + JSON.stringify(detail).slice(0, 200));
}

// Restore 20DC.
await page.evaluate(() => {
  const line = [...document.querySelectorAll('.cus-lot-line--type')][0];
  line?.querySelector('button')?.click();
});
await sleep(600);
await page.evaluate(() => {
  const editor = document.querySelector('.cus-lot-editor');
  editor?.querySelector('button[data-uui-control="select"]')?.click();
});
await sleep(500);
await page.evaluate(() => {
  const hit = [...document.querySelectorAll('[role="listbox"] [role="option"]')]
    .find((el) => el.textContent?.trim() === '20DC' && el instanceof HTMLElement && el.offsetParent !== null);
  hit?.click();
});
await sleep(1500);
log('type line after restore: ' + JSON.stringify(await readTypeLine()));
const after = await fetch(`${API}/shipments/cus-workspace/${LOT_ID}`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json()).catch(() => null);
if (after?.containers) log('API containers after restore: ' + JSON.stringify(after.containers.map((c) => ({ n: c.containerNumber, t: c.containerTypeId, code: c.containerTypeCode ?? c.containerTypeLabel }))));
await browser.close();
