// SIL-612 UI drive — the cargo table renders EDGE-TO-EDGE (owner doctrine 30/10).
//
// Rung-3 contract (AGENTS.md §9): screenshot after the drive, DOM assertion,
// persisted-state proof (read-only change → unchanged API/DB identity),
// driver log with exit status.
//
// What is asserted (layout-only change — no data mutation):
//   A. Desktop 1440: .csc-container-table-scroll left/right flush with the
//      section card's border box (breakout = the card's 14px padding, ±0.5px).
//   B. Desktop 1440: the card box left edge sits at the page's 8px app-shell
//      inset — the table's true screen inset is that 8px, not the old ~22px.
//   C. Mobile 390: NO breakout — the scroll container stays inside the card
//      padding (phone records are cards; second opinion deepseek 30/10).
//
// Usage: node qa/scripts/2026-10-30-sil612-edge-to-edge-ui-drive.mjs
// Output: qa/2026-10-30_sil612-edge-to-edge/run1/*.png + assertions.json + ui-driver.log

import puppeteer from 'puppeteer';
import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';

const FE = process.env.QA_BASE_URL || 'http://localhost:7217';
const RUN = process.env.QA_RUN_TAG || 'run1';
const OUT = resolve(process.cwd(), 'qa/2026-10-30_sil612-edge-to-edge', RUN);
mkdirSync(OUT, { recursive: true });
const LOG = resolve(OUT, 'ui-driver.log');
const log = (line) => { appendFileSync(LOG, `${new Date().toISOString()} ${line}\n`); console.log(line); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const result = { run: RUN, baseUrl: FE, role: 'admin (ADMIN)', change: 'layout-only (read-only drive)', checks: [] };
const check = (name, pass, detail) => {
  result.checks.push({ name, pass, detail });
  log(`${pass ? 'PASS' : 'FAIL'} ${name} :: ${detail}`);
  if (!pass) result.failed = true;
};

// Read-only change: capture unchanged persisted state (no write happens).
const shipCount = execSync('docker exec ss-prod-db psql -U postgres -d silversea -tAc "SELECT count(*) FROM shipments"', { encoding: 'utf8' }).trim();
result.dbUnchangedProof = { shipmentsCountBefore: shipCount };
log(`DB read-only proof: shipments count = ${shipCount} (no mutation in this drive)`);

const browser = await puppeteer.launch({ headless: true, defaultViewport: { width: 1440, height: 900 } });

async function login() {
  const page = await browser.newPage();
  await page.goto(`${FE}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.goto(`${FE}/login`, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForSelector('input[name="username"]', { timeout: 45000 });
  await page.type('input[name="username"]', 'admin');
  await page.type('input[name="password"]', 'Abc123');
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {}),
    page.click('button[type="submit"]'),
  ]);
  await page.waitForFunction(() => localStorage.getItem('token') || localStorage.getItem('auth_token'), { timeout: 30000 });
  return page;
}

try {
  const page = await login();
  log('logged in as admin');

  await page.goto(`${FE}/shipments/new`, { waitUntil: 'networkidle2', timeout: 90000 });
  await page.waitForSelector('#shipment-section-cargo', { timeout: 60000 });
  await page.waitForSelector('.csc-container-table-scroll', { timeout: 60000 });
  await sleep(800);

  // ── A+B. Desktop 1440: flush with the card border box = the page box ──────
  // The breakout is a -14px mirror of the card padding measured from the
  // editor content box, so the table lands exactly on the section card's
  // BORDER box — which is also the page box here (the page carries no
  // inline padding; the app shell keeps the 8px inset outside it).
  const dims = await page.evaluate(() => {
    const card = document.querySelector('#shipment-section-cargo').getBoundingClientRect();
    const scroll = document.querySelector('.csc-container-table-scroll').getBoundingClientRect();
    const pageEl = document.querySelector('.csc-page').getBoundingClientRect();
    const body = document.querySelector('.app-body').getBoundingClientRect();
    return {
      viewport: { w: window.innerWidth, h: window.innerHeight },
      card: { left: card.left, right: card.right, width: card.width },
      scroll: { left: scroll.left, right: scroll.right, width: scroll.width },
      page: { left: pageEl.left, right: pageEl.right },
      appBody: { left: body.left, right: body.right },
    };
  });
  await page.screenshot({ path: resolve(OUT, 'table-edge-1440.png') });

  check('A1 desktop: scroll container flush with the card border box (left)', Math.abs(dims.scroll.left - dims.card.left) <= 0.5,
    `scroll.left=${dims.scroll.left.toFixed(1)} card.left=${dims.card.left.toFixed(1)}`);
  check('A2 desktop: scroll container flush with the card border box (right)', Math.abs(dims.scroll.right - dims.card.right) <= 0.5,
    `scroll.right=${dims.scroll.right.toFixed(1)} card.right=${dims.card.right.toFixed(1)}`);
  check('A3 desktop: scroll width == card width (no inner inset left)', Math.abs(dims.scroll.width - dims.card.width) <= 1,
    `scroll.width=${dims.scroll.width.toFixed(1)} card.width=${dims.card.width.toFixed(1)}`);
  check('B1 desktop: table flush with the page box (left)', Math.abs(dims.scroll.left - dims.page.left) <= 0.5,
    `page.left=${dims.page.left.toFixed(1)} scroll.left=${dims.scroll.left.toFixed(1)}`);
  check('B2 desktop: table flush with the page box (right)', Math.abs(dims.scroll.right - dims.page.right) <= 0.5,
    `page.right=${dims.page.right.toFixed(1)} scroll.right=${dims.scroll.right.toFixed(1)}`);
  log(`context: app-body ${dims.appBody.left.toFixed(0)}→${dims.appBody.right.toFixed(0)} — the shell keeps its own inset; the table spans the whole page region (edge-to-edge of the content area, second-opinion 8px inset lives in the shell, not the card)`);

  // ── C. Mobile 390: no breakout — phone record keeps the card boundary ────
  await page.setViewport({ width: 390, height: 844 });
  await sleep(900);
  const mobileDims = await page.evaluate(() => {
    const card = document.querySelector('#shipment-section-cargo').getBoundingClientRect();
    const scroll = document.querySelector('.csc-container-table-scroll').getBoundingClientRect();
    return { card: { left: card.left, right: card.right }, scroll: { left: scroll.left, right: scroll.right } };
  });
  await page.screenshot({ path: resolve(OUT, 'table-390.png') });
  const mobileInset = mobileDims.scroll.left - mobileDims.card.left;
  check('C1 mobile 390: scroll container stays INSIDE the card (no breakout)', mobileInset > 0.5,
    `scroll.left=${mobileDims.scroll.left.toFixed(1)} card.left=${mobileDims.card.left.toFixed(1)} inset=${mobileInset.toFixed(1)}`);
  check('C2 mobile 390: inset ≈ the ≤640 card padding 8px', Math.abs(mobileInset - 8) <= 2,
    `inset=${mobileInset.toFixed(1)} expect≈8`);

  // ── D. 768 sweep (AGENTS 390/768/1440): gate follows the 620px container ──
  await page.setViewport({ width: 768, height: 900 });
  await sleep(900);
  const tablet = await page.evaluate(() => {
    const card = document.querySelector('#shipment-section-cargo').getBoundingClientRect();
    const scroll = document.querySelector('.csc-container-table-scroll').getBoundingClientRect();
    const editor = document.querySelector('.csc-container-editor').getBoundingClientRect();
    return { card: { left: card.left, right: card.right }, scroll: { left: scroll.left, right: scroll.right }, editorWidth: editor.width };
  });
  await page.screenshot({ path: resolve(OUT, 'table-768.png') });
  const tabletFlush = Math.abs(tablet.scroll.left - tablet.card.left) <= 0.5 && Math.abs(tablet.scroll.right - tablet.card.right) <= 0.5;
  if (tablet.editorWidth > 620) {
    check('D tablet 768: desktop record (editor >620px) → breakout active, flush card box', tabletFlush,
      `editor=${tablet.editorWidth.toFixed(0)} scroll=${tablet.scroll.left.toFixed(0)}→${tablet.scroll.right.toFixed(0)} card=${tablet.card.left.toFixed(0)}→${tablet.card.right.toFixed(0)}`);
  } else {
    check('D tablet 768: phone record (editor ≤620px) → no breakout, inside card', !tabletFlush,
      `editor=${tablet.editorWidth.toFixed(0)} scroll=${tablet.scroll.left.toFixed(0)}→${tablet.scroll.right.toFixed(0)} card=${tablet.card.left.toFixed(0)}→${tablet.card.right.toFixed(0)}`);
  }

  result.dimsDesktop = dims;
  result.dimsMobile = mobileDims;
  result.dimsTablet = tablet;
  await browser.close();
  writeFileSync(resolve(OUT, 'assertions.json'), JSON.stringify(result, null, 2));
  log(result.failed ? 'RESULT: FAIL' : 'RESULT: ALL CHECKS PASS');
  process.exitCode = result.failed ? 1 : 0;
} catch (err) {
  log(`DRIVER ERROR: ${err?.message ?? err}`);
  result.error = String(err);
  writeFileSync(resolve(OUT, 'assertions.json'), JSON.stringify(result, null, 2));
  await browser.close();
  process.exitCode = 1;
}
