// SIL-166 — rung-3 UI drive (LOCAL ONLY): the CUS "Số tờ khai" ledger column
// on Chi tiết lô (/shipments/:id — the surface the customer's Zalo repro
// names: "khi nhấn vào Chi tiết ... Cột số tờ khai vẫn trống").
//   BEFORE — lot ${BEFORE_LOT} born PRE-fix through the worktree's own probe
//            repro run: containers carry NULL declaration_number (DB proof in
//            the log) → the column renders empty. This is the defect.
//   AFTER  — lot ${AFTER_LOT} born POST-fix (same create flow): the lot-level
//            tờ khai stamped every container → the column is filled.
// Both lots live in the shared local DB (:5441); this drive reads them through
// the FIXED worktree stack (frontend 7176 → backend 3005), so the ONLY
// variable between the two captures is the write-time code, not the FE.
// Run: node qa/scripts/2026-10-24-sil166-tokhai-ui-drive.mjs
// Env: FRONT_PORT (7176), API_PORT (3005), BEFORE_LOT (254), AFTER_LOT (268).
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const FRONT = `http://localhost:${process.env.FRONT_PORT ?? 7176}`;
const API = `http://localhost:${process.env.API_PORT ?? 3005}/api`;
const BEFORE_LOT = Number(process.env.BEFORE_LOT ?? 254);
const AFTER_LOT = Number(process.env.AFTER_LOT ?? 268);
const OUT = path.resolve('qa/2026-10-24-sil166');
fs.mkdirSync(OUT, { recursive: true });
const LOG = path.join(OUT, 'ui-driver.log');
fs.writeFileSync(LOG, '');
const log = (line) => { console.log(line); fs.appendFileSync(LOG, line + '\n'); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = (page, name) => page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: false });

let failures = 0;
const check = (name, ok, detail) => {
  log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

const health = await fetch(`${API}/health`).then((r) => r.json()).catch(() => null);
log(`HEALTH status=${health?.status} api=${API} front=${FRONT}`);
if (health?.status !== 'ok') { log('ABORT: local API health not ok'); process.exit(2); }

const loginRes = await fetch(`${API}/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: 'cus', password: 'Abc123' }),
});
if (!loginRes.ok) { log(`ABORT: login failed (${loginRes.status})`); process.exit(2); }
const { token } = await loginRes.json();
log('LOGIN ok role=cus');

// DB side-effect proof for both lots (the persisted truth behind each capture)
const dbRows = (sid) => execSync(
  `docker exec ss-prod-db psql -U postgres -d silversea -qtAX -c "select id || '|' || coalesce(declaration_number,'<NULL>') from shipment_containers where shipment_id=${sid} order by id"`,
).toString().trim();
const dbBefore = dbRows(BEFORE_LOT);
const dbAfter = dbRows(AFTER_LOT);
fs.writeFileSync(path.join(OUT, 'db-side-effect-proof.txt'),
  `BEFORE lot ${BEFORE_LOT} shipment_containers.declaration_number:\n${dbBefore}\n\nAFTER lot ${AFTER_LOT}:\n${dbAfter}\n`);
check('DB BEFORE lot born with NULL tờ khai (the defect, persisted)', dbBefore.split('\n').every((r) => r.endsWith('<NULL>')), dbBefore.replace(/\n/g, ' '));
check('DB AFTER lot born with lot tờ khai on every row (fixed)', dbAfter.split('\n').every((r) => r.includes('TK166-')), dbAfter.replace(/\n/g, ' '));

const readCells = (page) => page.evaluate(() => {
  const cells = [...document.querySelectorAll('.cus-container-table .cus-container-cell--declaration')];
  return cells.map((cell) => {
    const trigger = cell.querySelector('.cus-declaration-trigger');
    return {
      empty: trigger?.classList.contains('cus-declaration-trigger--empty') ?? true,
      text: (trigger?.textContent ?? '').trim(),
    };
  });
});

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
await page.evaluateOnNewDocument((t) => { if (location.origin.startsWith('http://localhost')) localStorage.setItem('token', t); }, token);
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });

// ── BEFORE: the reported bug on the real surface ────────────────────────────
await page.goto(`${FRONT}/shipments/${BEFORE_LOT}`, { waitUntil: 'networkidle2' });
await page.waitForSelector('.cus-container-table', { timeout: 30000 });
await page.$eval('.cus-container-ledger', (el) => el.scrollIntoView({ block: 'start' }));
await sleep(700);
await shot(page, 'ui-before-tokhai-trong');
const beforeCells = await readCells(page);
check('UI BEFORE cột Số tờ khai TRỐNG (bug tái hiện — placeholder, không số)',
  beforeCells.length > 0 && beforeCells.every((c) => c.empty), JSON.stringify(beforeCells));

// ── AFTER: same surface, lot born through the fixed write path ─────────────
await page.goto(`${FRONT}/shipments/${AFTER_LOT}`, { waitUntil: 'networkidle2' });
await page.waitForSelector('.cus-container-table', { timeout: 30000 });
await page.$eval('.cus-container-ledger', (el) => el.scrollIntoView({ block: 'start' }));
await sleep(700);
await shot(page, 'ui-after-tokhai-copy');
const afterCells = await readCells(page);
check('UI AFTER cột Số tờ khai ĐIỀN theo lô (fixed)', afterCells.length > 0 && afterCells.every((c) => !c.empty && c.text !== ''), JSON.stringify(afterCells));
const afterDomText = await page.evaluate(() => document.body.textContent ?? '');
check('UI AFTER header chứng từ cùng số (Tổng quan fact)', afterDomText.includes(afterCells[0]?.text ?? '___'), `cell0=${afterCells[0]?.text}`);

// Console hygiene for the two captures
check('Console không có lỗi mới', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | ') || 'clean');

await browser.close();
log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILURES`} — artifacts in ${OUT}`);
process.exit(failures === 0 ? 0 : 1);
