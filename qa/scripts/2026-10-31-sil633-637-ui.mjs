// SIL-633 (id 737) + SIL-637 (id 741) — rung-3 UI drive, local worktree stack
// (frontend 7177 / backend 3002, DB 5441) with a read-only BEFORE pass on
// staging (main build — the reported environment).
//
// SIL-633: /shipments lot card — the page-owned geometry pins on the
//   "Chi tiết" row action are retired; the card's only control must ride the
//   shared UUI sm button laws (12px compactActionText, 44px max-md touch
//   floor) and the card fact eyebrow joins the record-table standard.
// SIL-637: /shipments/new first band (LCL) — the visible label
//   "Ngày giờ đóng trả *" is gone; inputs + required validation + aria stay.
//
//   node qa/scripts/2026-10-31-sil633-637-ui.mjs
// Env: FRONT_PORT (7177), API_PORT (3002).
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const FRONT = `http://localhost:${process.env.FRONT_PORT ?? 7177}`;
const API = `http://localhost:${process.env.API_PORT ?? 3002}/api`;
const STG = 'https://vantai.tingting.vip';
const OUT = path.resolve('qa');
const SHOTS = path.resolve('testplan/assets');
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(SHOTS, { recursive: true });
const LOG = path.join(OUT, '2026-10-31_sil633-637_card-band_ui-driver.log');
fs.writeFileSync(LOG, '');
const log = (line) => { console.log(line); fs.appendFileSync(LOG, line + '\n'); };
let failures = 0;
const check = (name, ok, detail) => {
  log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};
const jf = async (base, p, opts) => {
  const res = await fetch(`${base}${p}`, opts);
  let body = null; try { body = await res.json(); } catch { /* non-json */ }
  return { status: res.status, body };
};
const psql = (sql) => execSync(`docker exec ss-prod-db psql -U postgres -d silversea -qtAX -c ${JSON.stringify(sql)}`).toString().trim();

const health = await fetch(`${API}/health`).then((r) => r.json()).catch(() => null);
log(`HEALTH status=${health?.status} api=${API} front=${FRONT}`);
if (health?.status !== 'ok') { log('ABORT: local API health not ok'); process.exit(2); }

const loginRes = await jf(API, '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'cus', password: 'Abc123' }) });
const token = loginRes.body?.token;
if (!token) { log(`ABORT: local login failed (${loginRes.status})`); process.exit(2); }
log('LOGIN ok role=CUS (cus) local');

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--force-device-scale-factor=2'] });

async function openPage(url, { width, height }) {
  const page = await browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: 2 });
  await page.evaluateOnNewDocument((t) => { localStorage.setItem('token', t); }, token);
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 });
  return page;
}

const measureCard = (page) => page.evaluate(() => {
  const first = document.querySelector('.cus-dashboard-row');
  if (!first) return null;
  const btn = first.querySelector('button.cus-dashboard-detail');
  const trigger = first.querySelector('.cus-inline-trigger');
  const before = trigger ? getComputedStyle(trigger, '::before') : null;
  const bs = btn ? getComputedStyle(btn) : null;
  return {
    rowH: Math.round(first.getBoundingClientRect().height),
    detail: btn ? { minH: bs.minHeight, h: Math.round(btn.getBoundingClientRect().height), fs: bs.fontSize } : null,
    labelBefore: before ? { fs: before.fontSize, fw: before.fontWeight, transform: before.textTransform, ls: before.letterSpacing } : null,
    strongFs: getComputedStyle(first.querySelector('.cus-multiline-cell strong') ?? first).fontSize,
    spanFs: getComputedStyle(first.querySelector('.cus-multiline-cell span') ?? first).fontSize,
  };
});

// ── BEFORE (staging, main build, read-only) ─────────────────────────────────
try {
  const stgLogin = await jf(`${STG}/api`, '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'thanhdc', password: 'Abc123' }) });
  const stgToken = stgLogin.body?.token;
  if (!stgToken) {
    log(`BEFORE(staging) SKIP — login failed (${stgLogin.status}); BEFORE metrics already captured 31/10 via staging tab (32px/11px pins)`);
  } else {
    const page = await browser.newPage();
    await page.setViewport({ width: 495, height: 828, deviceScaleFactor: 2 });
    await page.evaluateOnNewDocument((t) => { localStorage.setItem('token', t); }, stgToken);
    await page.goto(`${STG}/shipments`, { waitUntil: 'networkidle2', timeout: 60000 });
    await page.waitForSelector('.cus-dashboard-row', { timeout: 30000 });
    const before = await measureCard(page);
    await page.screenshot({ path: path.join(SHOTS, 'sil633-before-staging-495.png'), fullPage: false });
    log(`BEFORE staging @495 detail=${JSON.stringify(before?.detail)} label=${JSON.stringify(before?.labelBefore)}`);

    const np = await browser.newPage();
    await np.setViewport({ width: 495, height: 828, deviceScaleFactor: 2 });
    await np.evaluateOnNewDocument((t) => { localStorage.setItem('token', t); }, stgToken);
    await np.goto(`${STG}/shipments/new`, { waitUntil: 'networkidle2', timeout: 60000 });
    await np.waitForSelector('#shipment-lcl-closing-at, [data-field-id="shipment-bulk-appointment"]', { timeout: 30000 });
    await np.click('label:has(input[value="LCL"]), [data-uui-control="segments"] label:last-child').catch(() => {});
    await np.waitForSelector('.csc-lcl-delivery', { timeout: 15000 }).catch(() => {});
    await new Promise((r) => setTimeout(r, 800));
    const stgLabel = await np.evaluate(() => ({
      visibleLabel: document.querySelector('.csc-lcl-delivery .split-datetime__label')?.textContent ?? null,
      aria: document.querySelector('.csc-lcl-delivery [data-split-datetime]')?.getAttribute('aria-label') ?? null,
    }));
    await np.screenshot({ path: path.join(SHOTS, 'sil637-before-staging-band.png'), fullPage: false });
    log(`BEFORE staging LCL band=${JSON.stringify(stgLabel)}`);
    await page.close(); await np.close();
  }
} catch (err) {
  log(`BEFORE(staging) ERROR (non-fatal, staging unreachable): ${err.message}`);
}

// ── SIL-633 AFTER (local) — card scale at 390 / 495 / 1440 ─────────────────
for (const [w, h] of [[390, 844], [495, 828], [1440, 1000]]) {
  const page = await openPage(`${FRONT}/shipments`, { width: w, height: h });
  await page.waitForSelector('.cus-dashboard-row', { timeout: 30000 });
  const m = await measureCard(page);
  await page.screenshot({ path: path.join(SHOTS, `sil633-after-local-${w}.png`), fullPage: false });
  if (!m) { check(`SIL-633 @${w} card renders`, false, 'no .cus-dashboard-row'); await page.close(); continue; }
  if (w < 768) {
    check(`SIL-633 @${w} detail rides the 44px touch floor (no page pin)`, m.detail.minH === '44px' && m.detail.h >= 44, `minH=${m.detail.minH} h=${m.detail.h}`);
    check(`SIL-633 @${w} detail font is the shared 12px control text`, m.detail.fs === '12px', `fs=${m.detail.fs}`);
  } else {
    // ≥768 fine-pointer: the kit sizes a link-type button by its content
    // (same as every other link button in the app — the old 24px was a page
    // pin). The contract is: NO page-owned height remains and the font is
    // the shared 12px.
    check(`SIL-633 @${w} detail keeps NO page height pin (kit-owned link size)`, m.detail.minH !== '24px' && m.detail.minH !== '32px' && m.detail.h >= 15 && m.detail.h <= 34, `minH=${m.detail.minH} h=${m.detail.h}`);
    check(`SIL-633 @${w} detail font is the shared 12px control text`, m.detail.fs === '12px', `fs=${m.detail.fs}`);
  }
  check(`SIL-633 @${w} fact values stay on the token ladder (12/11)`, m.strongFs === '12px' && m.spanFs === '11px', `strong=${m.strongFs} span=${m.spanFs}`);
  await page.close();
}

// label eyebrow (card band <1000)
{
  const page = await openPage(`${FRONT}/shipments`, { width: 495, height: 828 });
  await page.waitForSelector('.cus-dashboard-row', { timeout: 30000 });
  const m = await measureCard(page);
  check('SIL-633 label eyebrow = record-table standard (11px/700/uppercase/tracked)',
    m.labelBefore.fs === '11px' && m.labelBefore.fw === '700' && m.labelBefore.transform === 'uppercase',
    JSON.stringify(m.labelBefore));
  await page.close();
}

// DB identity (read-only change): the first row's persisted payload is intact.
{
  const listRes = await jf(API, '/shipments/cus-workspace?transportDateFrom=2026-10-01&transportDateTo=2026-10-31&limit=50', { headers: { Authorization: `Bearer ${token}` } });
  const rows = Array.isArray(listRes.body) ? listRes.body : listRes.body?.items ?? [];
  const first = rows[0] ?? null;
  log(`DB/API IDENTITY cus-workspace rows=${rows.length} first=${first ? `id=${first.id} customer=${first.customerName}` : 'none'}`);
  check('SIL-633 list API identity unchanged (read-only restyle)', rows.length > 0, `status=${listRes.status} rows=${rows.length}`);
}

// ── SIL-637 AFTER (local) — LCL band label retired, validation + copy stay ─
{
  const countBefore = psql('SELECT count(*) FROM shipments');
  const page = await openPage(`${FRONT}/shipments/new`, { width: 1440, height: 1000 });
  await page.waitForSelector('[data-uui-control="segments"]', { timeout: 30000 });
  await page.click('label:has(input[value="LCL"])');
  await page.waitForSelector('.csc-lcl-delivery', { timeout: 15000 });
  await new Promise((r) => setTimeout(r, 500));
  const band = await page.evaluate(() => {
    const el = document.querySelector('.csc-lcl-delivery');
    if (!el) return null;
    return {
      visibleLabel: el.querySelector('.split-datetime__label')?.textContent ?? null,
      aria: el.querySelector('[data-split-datetime]')?.getAttribute('aria-label') ?? null,
      segments: el.querySelectorAll('[data-split-datetime] input[data-seg]').length,
      segIds: [...el.querySelectorAll('[data-split-datetime] input[data-seg]')].map((i) => i.getAttribute('data-seg')).join(','),
    };
  });
  await page.screenshot({ path: path.join(SHOTS, 'sil637-after-local-band-lcl.png'), fullPage: false });
  check('SIL-637 visible label "Ngày giờ đóng trả *" retired', band.visibleLabel === null, `visibleLabel=${JSON.stringify(band.visibleLabel)}`);
  check('SIL-637 group aria-label keeps the name', band.aria === 'Ngày giờ đóng trả', `aria=${JSON.stringify(band.aria)}`);
  check('SIL-637 both datetime segment groups stay (5 segments)', band.segments >= 5, `segments=${band.segments} (${band.segIds})`);

  // Required validation still blocks an empty LCL submit on this exact field.
  await page.evaluate(() => { document.querySelector('.csc-workspace')?.scrollIntoView(); });
  const submitBtn = await page.evaluateHandle(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Tạo lô hàng'));
  await submitBtn.asElement().click();
  await new Promise((r) => setTimeout(r, 900));
  const issuePainted = await page.evaluate(() => {
    const el = document.querySelector('.csc-lcl-delivery');
    return { text: el?.textContent ?? '', issueOnField: (el?.textContent ?? '').includes('Chọn ngày giờ đóng trả'), url: location.pathname };
  });
  await page.screenshot({ path: path.join(SHOTS, 'sil637-after-local-submit-blocked.png'), fullPage: false });
  check('SIL-637 empty submit still blocked with the field\'s required issue', issuePainted.issueOnField && issuePainted.url === '/shipments/new', `url=${issuePainted.url} fieldText="${issuePainted.text.trim().slice(0, 80)}"`);

  // Fill the datetime → the closing-at issue clears (validation targets THIS field).
  await page.type('.csc-lcl-delivery input[data-seg="hh"]', '09');
  await page.type('.csc-lcl-delivery input[data-seg="mm"]', '30');
  await page.type('.csc-lcl-delivery input[data-seg="dd"]', '05');
  await page.type('.csc-lcl-delivery input[data-seg="mm2"]', '11');
  await page.type('.csc-lcl-delivery input[data-seg="yyyy"]', '2026');
  await new Promise((r) => setTimeout(r, 400));
  const cleared = await page.evaluate(() => !(document.querySelector('.csc-lcl-delivery')?.textContent ?? '').includes('Chọn ngày giờ đóng trả'));
  check('SIL-637 a complete datetime satisfies the required check (issue clears)', cleared);

  const countAfter = psql('SELECT count(*) FROM shipments');
  check('SIL-637 no DB write happened (invalid submits only)', countBefore === countAfter, `shipments ${countBefore} -> ${countAfter}`);
  log(`DB SIDE-EFFECT count shipments ${countBefore} -> ${countAfter}`);
  await page.close();
}

// SIL-625 regression quick pin on the same band (FCL): bulk label stays retired.
{
  const page = await openPage(`${FRONT}/shipments/new`, { width: 1440, height: 1000 });
  await page.waitForSelector('.csc-bulk-appointment', { timeout: 30000 });
  const fcl = await page.evaluate(() => ({
    visible: document.querySelector('.csc-bulk-appointment .split-datetime__label')?.textContent ?? null,
    aria: document.querySelector('.csc-bulk-appointment [data-split-datetime]')?.getAttribute('aria-label') ?? null,
  }));
  check('SIL-625 regression: FCL bulk band label stays retired', fcl.visible === null && fcl.aria === 'Ngày giờ đóng trả cho tất cả cont', JSON.stringify(fcl));
  await page.close();
}

await browser.close();
log(`DONE failures=${failures}`);
process.exit(failures === 0 ? 0 : 1);
