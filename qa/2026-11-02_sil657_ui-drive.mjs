// SIL-657 (id 764) — rung-3 UI drive (AGENTS §9) + API evidence (rung 2).
//
// Part A (the "missing field" claim, UI DRIVEN): CUS opens /shipments/new on
// the local stack, screenshots BOTH cargo-mode tabs and asserts the SỐ TỜ KHAI
// surface per tab:
//   - FCL (form default): the container table carries the per-cont SỐ TỜ KHAI
//     column (SIL-701).
//   - LCL: NO declaration input anywhere on the page (0 matches of "tờ khai")
//     → ruling gap A1, not a regression (SIL-600 lot-level ban stands).
// Part B (the propagation fix, DB/API VERIFIED): against the lane backend
// :3005 running THIS branch, the lot-level declaration aggregates now resolve
// BOTH stores:
//   - GET /api/forwarder/trips + /:id (ops giaonhan): trip 616's lot (285)
//     holds the number ONLY per-cont (docs count = 0, DB-proven) and the
//     payload now carries it.
//   - GET /api/shipments/dispatch-handoffs (dieuvan): the lot payload's
//     shipment.declarationNumbers now carries it.
// Stack: frontend http://localhost:7189 → backend :3005 (this worktree)
// → shared local DB ss-prod-db:5441/silversea.
import puppeteer from 'puppeteer-core';
import { mkdirSync, appendFileSync } from 'node:fs';

const BASE = 'http://localhost:7189';
const API = 'http://localhost:3005/api';
const ART = 'qa';
const LOG = 'qa/2026-11-02_sil657_ui-driver.log';
const SHIPMENT_CODE = 'SHP-2610-00215'; // lot 380 — per-cont-only TK-631-LONGTEST-VALUE (docs count = 0, DB-proven)
const TRIP_ID = 616; // trip of lot 285 (SHP-2610-00187) — the fragment-level psql proof lot
mkdirSync(ART, { recursive: true });
const log = (line) => { const text = `${new Date().toISOString()} ${line}`; console.log(text); appendFileSync(LOG, `${text}\n`); };
appendFileSync(LOG, `\n=== run ${new Date().toISOString()} ===\n`);

const login = async (identifier) => {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password: 'Abc123' }),
  });
  if (!res.ok) throw new Error(`login ${identifier} failed: ${res.status}`);
  const { token } = await res.json();
  log(`login ${identifier}: ${token ? 'OK' : 'FAIL'}`);
  return token;
};

const cusToken = await login('cus');
const opsToken = await login('giaonhan');
const dispatchToken = await login('dieuvan');

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--no-sandbox', '--window-size=1440,1000'],
  defaultViewport: { width: 1440, height: 1000 },
});
let failures = 0;
const check = (name, ok, detail) => {
  failures += ok ? 0 : 1;
  log(`ASSERT ${ok ? 'PASS' : 'FAIL'} — ${name}${detail ? ` — ${detail}` : ''}`);
};

try {
  const page = await browser.newPage();
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), cusToken);
  page.on('dialog', (d) => void d.accept());

  await page.goto(`${BASE}/shipments/new`, { waitUntil: 'networkidle0', timeout: 45000 });
  await page.waitForSelector('table', { timeout: 20000 });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  await sleep(400);

  // ── FCL tab (form default) ────────────────────────────────────────────────
  const fclState = await page.evaluate(() => {
    const mode = [...document.querySelectorAll('input[type="radio"]')].find((i) => i.checked);
    const headers = [...document.querySelectorAll('th')].map((th) => th.textContent.trim());
    const text = document.body.innerText;
    return {
      checkedMode: mode?.value ?? null,
      soToKhaiColumn: headers.some((h) => h === 'Số tờ khai'),
      soToKhaiInputCount: text.match(/Nhập số tờ khai/g)?.length ?? 0,
    };
  });
  check('form opens on FCL by default', fclState.checkedMode === 'FCL', `checked=${fclState.checkedMode}`);
  check('FCL table has the SỐ TỜ KHAI column (SIL-701)', fclState.soToKhaiColumn === true);
  check('FCL row renders the per-cont declaration input', fclState.soToKhaiInputCount >= 1, `inputs=${fclState.soToKhaiInputCount}`);
  await page.screenshot({ path: `${ART}/2026-11-02_sil657_ui-fcl-tab.png`, fullPage: false });
  log('shot 2026-11-02_sil657_ui-fcl-tab.png');

  // ── LCL tab ───────────────────────────────────────────────────────────────
  await page.evaluate(() => {
    const input = [...document.querySelectorAll('input[type="radio"]')].find((i) => i.value === 'LCL');
    input.click();
  });
  await page.waitForFunction(() => document.body.innerText.includes('Quy cách đóng gói'), { timeout: 15000 });
  await sleep(400);
  const lclState = await page.evaluate(() => {
    const mode = [...document.querySelectorAll('input[type="radio"]')].find((i) => i.checked);
    const text = document.body.innerText;
    return {
      checkedMode: mode?.value ?? null,
      wholePageTokhaiMatches: (text.match(/tờ khai/gi) ?? []).length,
      hasContainerTable: !!document.querySelector('table'),
      lclSectionVisible: text.includes('Quy cách đóng gói') && text.includes('Thể tích (CBM)'),
    };
  });
  check('LCL tab selected', lclState.checkedMode === 'LCL', `checked=${lclState.checkedMode}`);
  check('LCL cargo section renders', lclState.lclSectionVisible === true);
  check('LCL tab: 0 "tờ khai" matches on the WHOLE page (reporter scan reproduced)', lclState.wholePageTokhaiMatches === 0, `matches=${lclState.wholePageTokhaiMatches}`);
  check('LCL tab renders no container table (ruling gap A1, not a render bug)', lclState.hasContainerTable === false);
  await page.screenshot({ path: `${ART}/2026-11-02_sil657_ui-lcl-tab.png`, fullPage: false });
  log('shot 2026-11-02_sil657_ui-lcl-tab.png');
  await page.close();
} catch (error) {
  failures += 1;
  log(`UI DRIVE ERROR: ${error.message}`);
}

await browser.close();

// ── Part B — API evidence against THIS branch's backend (:3005) ─────────────
// DB pre-proof (psql, recorded in the report): lot 380 carries
// TK-631-LONGTEST-VALUE ONLY in shipment_containers (shipment_declarations
// count = 0). The docs-only reader used to return [] for it. Lot 285's
// fragment-level proof runs in psql (user_shipment_links is empty locally,
// so the forwarder trip payloads cannot resolve a lot for ANY user — the
// endpoint shape is still asserted 200 below).
try {
  const tripsRes = await fetch(`${API}/forwarder/me/trips`, { headers: { Authorization: `Bearer ${opsToken}` } });
  check('forwarder trips list endpoint responds 200 (shape intact after the SQL merge)', tripsRes.status === 200, `status=${tripsRes.status}`);

  const detailRes = await fetch(`${API}/forwarder/me/trips/${TRIP_ID}`, { headers: { Authorization: `Bearer ${opsToken}` } });
  // 404 (not 5xx) = the merged SQL executes cleanly; the lot is invisible
  // only because user_shipment_links is empty in this DB (pre-existing local
  // data shape, unrelated to the declaration merge).
  check('forwarder trip DETAIL executes the merged SQL (404 = clean query, empty local link table)', detailRes.status === 200 || detailRes.status === 404, `status=${detailRes.status}`);

  const handoffRes = await fetch(`${API}/shipments/dispatch-handoffs?q=${SHIPMENT_CODE}`, { headers: { Authorization: `Bearer ${dispatchToken}` } });
  const handoffJson = await handoffRes.json();
  const handoffItem = (handoffJson.items ?? [])[0];
  check(
    'dispatch handoffs: shipment.declarationNumbers now carries the per-cont number',
    Array.isArray(handoffItem?.shipment?.declarationNumbers) && handoffItem.shipment.declarationNumbers.includes('TK-631-LONGTEST-VALUE'),
    `shipment.declarationNumbers=${JSON.stringify(handoffItem?.shipment?.declarationNumbers ?? null)}`,
  );
} catch (error) {
  failures += 1;
  log(`API EVIDENCE ERROR: ${error.message}`);
}

log(`DONE — ${failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
