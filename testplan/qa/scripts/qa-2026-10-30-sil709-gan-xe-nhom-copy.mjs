// SIL-709 (id 709) — "Gán xe nhóm" popup copy layer — rung 3 driver.
// Regression: testplan/cases/case-SIL-709-gan-xe-nhom-copy-dedup.md
// Drives the LOCAL worktree stack (be :3002, fe :7177 — :7175 was held by the
// unrelated fix-sil-683-r2 worktree's dev server and preserved):
//   COPY-01: the cước law "Lô 1 giữ 100% cước trả ĐV · các lô còn lại 0₫"
//            renders EXACTLY ONCE — a small caption under "Cước trả ĐV Lô 1".
//   COPY-02: no lecturing paragraph (no "thắng giá tra được"), no
//            "(xe chạy chuyến)" gloss, subtitle is just "N lô lẻ".
//   COPY-03: lot lines number themselves once ("Lô 1 · …") — ol marker off.
//   STATE:   the two lots stay ungrouped after open+cancel (read-only change;
//            persisted state + API identity captured).
// Artifacts: qa/2026-10-30_sil709_ui-{1440,768,390}.png
//            qa/2026-10-30_sil709_db-state.txt
//            qa/2026-10-30_sil709_ui-driver.log (this log, exit status last)
// Usage: node testplan/qa/scripts/qa-2026-10-30-sil709-gan-xe-nhom-copy.mjs
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require2 = createRequire(import.meta.dirname + '/../../../package.json');
const puppeteer = require2('puppeteer-core');

const BASE = process.env.QA_BASE || 'http://localhost:7177';
const API = process.env.QA_API || 'http://localhost:3002/api';
const OUT = path.resolve(import.meta.dirname, '../../../qa');
fs.mkdirSync(OUT, { recursive: true });
const LOG_PATH = path.join(OUT, '2026-10-30_sil709_ui-driver.log');
const DB_PATH = path.join(OUT, '2026-10-30_sil709_db-state.txt');

const LOG = [];
let exitCode = 0;
const log = (step, obj = {}) => {
  const e = { at: new Date().toISOString(), step, ...obj };
  LOG.push(e);
  console.log(JSON.stringify(e));
};
const fail = (step, obj = {}) => { exitCode = 1; log(step, { verdict: 'FAIL', ...obj }); };
const ok = (step, obj = {}) => log(step, { verdict: 'PASS', ...obj });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const q = (sql) => execSync(
  `docker exec ss-prod-db psql -U postgres -d silversea -tAc "${sql}"`,
  { encoding: 'utf8' },
).trim();

function dbSnapshot(tag) {
  const state = {
    tag,
    groupedShipments: q('SELECT count(*) FROM shipments WHERE cost_group_id IS NOT NULL;'),
    lclShipmentsUngrouped: q("SELECT count(*) FROM shipments WHERE cargo_mode = 'LCL' AND cost_group_id IS NULL;"),
  };
  return state;
}

(async () => {
  log('start', { base: BASE, api: API });

  // ── DB state BEFORE (read-only change proof) ───────────────────────────────
  const dbBefore = dbSnapshot('before');
  log('db-before', dbBefore);

  // ── 1. token via API + pre-inject BEFORE any page load (spa-auth pattern) ──
  const loginRes = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: 'dieuvan', password: 'Abc123' }),
  });
  const loginBody = await loginRes.json().catch(() => ({}));
  const token = loginBody.token ?? loginBody.data?.token ?? loginBody.accessToken;
  if (!token) { fail('login', { status: loginRes.status, body: loginBody }); throw new Error('no token'); }
  ok('login', { status: loginRes.status });

  const browser = await puppeteer.launch({
    headless: true,
    executablePath: process.env.QA_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    args: ['--no-sandbox', '--window-size=1440,900'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  page.on('pageerror', (err) => fail('pageerror', { message: String(err) }));

  await page.evaluateOnNewDocument((t) => {
    localStorage.setItem('token', t);
  }, token);

  // ── 2. open Kế hoạch Chi tiết Xe + enable Gộp hàng ─────────────────────────
  await page.goto(`${BASE}/dispatch-detail`, { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(1500);
  if (page.url().includes('/login')) { fail('auth-redirect', { url: page.url() }); throw new Error('redirected to login'); }
  ok('page-loaded', { url: page.url() });

  // The [Gộp hàng] mode toggle (LclMergeModeToggle) reveals the CHỌN column.
  await page.waitForSelector('button.lcl-merge-toggle', { timeout: 30000 });
  await page.click('button.lcl-merge-toggle');
  await sleep(600);
  const pressed = await page.$eval('button.lcl-merge-toggle', (b) => b.getAttribute('aria-pressed'));
  if (pressed !== 'true') { fail('merge-toggle', { pressed }); throw new Error('merge mode did not activate'); }
  ok('merge-mode-on');

  // The grid page shows cont rows first (their checkboxes are refused by
  // design) — filter to the ticket's own ungrouped LCL lots (R42RV-D1/D2 in
  // the dev seed) via the quick search box.
  const SEARCH = process.env.QA_SEARCH || 'R42RV-D';
  await page.type('input[aria-label="Tìm nhanh"]', SEARCH, { delay: 20 });
  await sleep(1500);

  const pickLots = async () => page.evaluate(() => {
    const boxes = [...document.querySelectorAll('button[role="checkbox"][aria-label^="Chọn lô"]')]
      .filter((b) => !b.disabled && b.getAttribute('aria-disabled') !== 'true');
    return boxes.slice(0, 2).map((b) => b.getAttribute('aria-label'));
  });
  let picked = await pickLots();
  if (picked.length < 2) {
    // Fallback: widen the date scope once (tab label may carry a count).
    await page.evaluate(() => {
      const all = [...document.querySelectorAll('button')]
        .find((b) => (b.textContent ?? '').trim().startsWith('Tất cả') && b.closest('[role="tablist"]'));
      all?.click();
    });
    await sleep(1500);
    picked = await pickLots();
  }
  if (picked.length < 2) {
    const diag = await page.evaluate(() => [...document.querySelectorAll('button[role="checkbox"]')]
      .slice(0, 6).map((b) => b.getAttribute('aria-label')));
    fail('lots-missing', { picked, sampleCheckboxLabels: diag });
    throw new Error('< 2 selectable LCL lots');
  }
  ok('lots-found', { picked });

  await page.evaluate(() => {
    const boxes = [...document.querySelectorAll('button[role="checkbox"][aria-label^="Chọn lô"]')]
      .filter((b) => !b.disabled && b.getAttribute('aria-disabled') !== 'true');
    boxes.slice(0, 2).forEach((b) => b.click());
  });
  await sleep(500);

  // ── 3. open the Gán xe nhóm popup ──────────────────────────────────────────
  const assignClicked = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')]
      .find((b) => b.getAttribute('title') === 'Gán xe nhóm trả ĐV' && b.getAttribute('aria-disabled') !== 'true');
    btn?.click();
    return Boolean(btn);
  });
  if (!assignClicked) { fail('assign-button', { picked }); throw new Error('Gán xe nhóm button not clickable'); }
  await page.waitForSelector('[role="dialog"]', { timeout: 15000 });
  await sleep(800);

  // ── 4. COPY assertions (the ticket's acceptance) ───────────────────────────
  const checks = await page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"]');
    const text = dialog?.innerText ?? '';
    const note = document.querySelector('.assign-truck-group__note');
    const noteText = note?.textContent ?? '';
    const occurrences = text.split('giữ 100% cước trả ĐV · các lô còn lại 0₫').length - 1;
    const freight = [...dialog.querySelectorAll('input')]
      .find((i) => i.placeholder === 'Bỏ trống = tự tra bảng giá');
    const moneyBlock = document.querySelector('.assign-truck-group__money-block');
    const ol = document.querySelector('.assign-truck-group__lots');
    const firstLi = ol?.querySelector('li');
    return {
      occurrencesOfRule: occurrences,
      noteText,
      noteAfterFreight: Boolean(note && freight && moneyBlock && moneyBlock.contains(note) && moneyBlock.contains(freight)),
      hasSubtitleCount: /2 lô lẻ/.test(text),
      hasLecturingParagraph: /thắng giá tra được/.test(text),
      hasOldGloss: /xe chạy chuyến/.test(text),
      hasShortLabel: Boolean(dialog.querySelector('[aria-label="BKS thực"], label')) || /BKS thực/.test(text),
      listStyle: ol ? getComputedStyle(ol).listStyleType : null,
      firstLiText: firstLi?.textContent ?? '',
    };
  });
  log('copy-checks', checks);
  if (checks.occurrencesOfRule !== 1) fail('COPY-01-rule-once', checks); else ok('COPY-01-rule-once');
  if (!checks.noteAfterFreight || !checks.hasSubtitleCount) fail('COPY-01b-placement', checks); else ok('COPY-01b-placement');
  if (checks.hasLecturingParagraph || checks.hasOldGloss) fail('COPY-02-no-lecture', checks); else ok('COPY-02-no-lecture');
  if (!checks.hasShortLabel) fail('COPY-02b-label', checks); else ok('COPY-02b-label');
  if (checks.listStyle !== 'none' || !checks.firstLiText.startsWith('Lô 1 · ')) fail('COPY-03-lot-lines', checks); else ok('COPY-03-lot-lines');

  // ── 5. screenshots at the three contract widths ────────────────────────────
  for (const [w, h] of [[1440, 900], [768, 1024], [390, 844]]) {
    await page.setViewport({ width: w, height: h });
    await sleep(400);
    await page.screenshot({ path: path.join(OUT, `2026-10-30_sil709_ui-${w}.png`) });
    ok('screenshot', { width: w });
  }

  // ── 6. cancel + DB state AFTER (unchanged persisted state) ─────────────────
  await page.setViewport({ width: 1440, height: 900 });
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Hủy');
    btn?.click();
  });
  await sleep(800);
  const dbAfter = dbSnapshot('after');
  log('db-after', dbAfter);
  const unchanged = dbBefore.groupedShipments === dbAfter.groupedShipments
    && dbBefore.lclShipmentsUngrouped === dbAfter.lclShipmentsUngrouped;
  if (!unchanged) fail('STATE-unchanged', { dbBefore, dbAfter }); else ok('STATE-unchanged', { dbBefore, dbAfter });
  fs.writeFileSync(DB_PATH, [
    'SIL-709 UI drive — persisted state around the popup open+cancel (read-only copy change).',
    `API identity: ${API} · role DISPATCHER (dieuvan) · route /dispatch-detail · lots: ${JSON.stringify(picked)}`,
    `before: ${JSON.stringify(dbBefore)}`,
    `after:  ${JSON.stringify(dbAfter)}`,
    `unchanged: ${unchanged}`,
  ].join('\n'));

  await browser.close();
})().catch((err) => {
  fail('fatal', { message: String(err?.stack ?? err) });
}).finally(() => {
  log('done', { exitCode });
  fs.writeFileSync(LOG_PATH, LOG.map((e) => JSON.stringify(e)).join('\n') + `\nexit-status: ${exitCode}\n`);
  console.log(`driver log: ${LOG_PATH} · exit=${exitCode}`);
  process.exit(exitCode);
});
