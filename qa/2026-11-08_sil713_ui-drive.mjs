// SIL-713 (id 833) — rung-3 UI drive (AGENTS §9).
// /dispatch-detail (Kế hoạch Chi tiết Xe): the ⋯ row menu of a live EXTERNAL
// issued row carries 'Hoàn thành' (Spec I.4d). QA fail (build 9f900f39):
// 'Hoàn thành occurs 0 times anywhere on /dispatch-detail' — that sweep had
// NO external live row on the board (only OWN rows, whose trips the driver
// app closes; the status machine refuses the staff close for own trips —
// 409 'Chỉ hoàn thành bằng đường này với chuyến xe ngoài', see the 07:29
// run below in this log). This drive proves the verb IS in the menu on the
// current build for an external đã-phát-lệnh row: R42DIS-02 (SHP-2610-00156,
// trip 54 EXTERNAL CREATED, month 10/2026).
// Stack: frontend http://localhost:7189 → backend :3005 → dev DB :5441 (ss-prod-db).
import puppeteer from 'puppeteer-core';
import { mkdirSync, appendFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const BASE = 'http://localhost:7189';
const API = 'http://localhost:3005/api';
const ART = 'qa';
const LOG = 'qa/2026-11-08_sil713_ui-driver.log';
const SEARCH = 'R42DIS-02';
const TRIP_ID = 54;
mkdirSync(ART, { recursive: true });
const log = (line) => { const text = `${new Date().toISOString()} ${line}`; console.log(text); appendFileSync(LOG, `${text}\n`); };
appendFileSync(LOG, `\n=== run ${new Date().toISOString()} ===\n`);

const dbTrip = () => execSync(
  `docker exec ss-prod-db psql -U postgres -d silversea -t -A -c "select t.status, tci.carrier_type, coalesce(tci.external_plate_number,'null') from trips t join trip_carrier_info tci on tci.trip_id = t.id where t.id = ${TRIP_ID};"`,
).toString().trim();

const login = await fetch(`${API}/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: 'dungnv', password: 'Abc123' }),
});
const { token } = await login.json();
log(`login dungnv: ${token ? 'OK' : 'FAIL'}`);
log(`trip ${TRIP_ID} fixture: ${dbTrip()}`);

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--no-sandbox', '--window-size=1440,1000'],
  defaultViewport: { width: 1440, height: 1000 },
});
const page = await browser.newPage();
await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
page.on('dialog', (d) => void d.accept());

const shot = async (name) => { await page.screenshot({ path: `${ART}/2026-11-08_sil713_ui-${name}.png`, fullPage: false }); log(`shot ${name}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
const expect = (cond, what) => { log(`${cond ? 'PASS' : 'FAIL'} ${what}`); if (!cond) failures += 1; };

try {
  await page.goto(`${BASE}/dispatch-detail`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('.detailed-plan-grid__cell--actions', { timeout: 30000 });
  await sleep(800);

  // Month → 10/2026 (the fixture row runs in October).
  await page.evaluate(() => {
    const monthBtn = [...document.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') || '').startsWith('Chọn tháng'));
    monthBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  await sleep(600);
  await page.evaluate(() => {
    const t10 = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('T10') && b.textContent.includes('Tháng 10'));
    t10?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  await sleep(1500);

  // Narrow the board to the fixture row (board search matches Bill/Cont).
  await page.evaluate((term) => {
    const input = document.querySelector('input[placeholder*="Bill, Cont"]');
    if (!input) throw new Error('search box not found');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, term);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, SEARCH);
  await sleep(3500);

  // Open the row's ⋯ menu and read it.
  const opened = await page.evaluate((term) => {
    const rows = [...document.querySelectorAll('tbody tr')];
    const row = rows.find((r) => r.innerText.includes(term));
    if (!row) return { error: `row ${term} not found after search` };
    const kebab = [...row.querySelectorAll('button')]
      .find((b) => (b.getAttribute('aria-label') || '').startsWith('Thao tác dòng'));
    if (!kebab) return { error: 'no kebab on row' };
    kebab.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    return { ok: true };
  }, SEARCH);
  if (opened.error) throw new Error(opened.error);
  await page.waitForSelector('[role="menu"]', { timeout: 10000 });
  await sleep(400);
  const menu = await page.evaluate(() => {
    const list = document.querySelector('[role="menu"]');
    return {
      label: list.getAttribute('aria-label'),
      items: [...list.querySelectorAll('[role="menuitem"]')].map((b) => b.textContent.trim()),
    };
  });
  log(`menu ${menu.label}: [${menu.items.join(' · ')}]`);
  expect(menu.items.includes('Hủy phân xe'), 'external issued row menu carries Hủy phân xe');
  expect(menu.items.includes('Hoàn thành'), "external issued row menu carries Hoàn thành (Spec I.4d — the QA '0 occurrences' repro)");
  await shot('01-external-issued-row-menu');
} catch (error) {
  failures += 1;
  log(`DRIVE ERROR: ${error.message}`);
  await shot('99-error');
} finally {
  await browser.close();
  log(`DRIVER_EXIT:${failures === 0 ? 0 : 1} failures=${failures}`);
}
process.exit(failures === 0 ? 0 : 1);
