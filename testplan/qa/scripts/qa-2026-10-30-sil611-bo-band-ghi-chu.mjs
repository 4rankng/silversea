// SIL-611 (id 714) — bỏ band "Lịch & ghi chú", dời Ghi chú xuống dưới Thông
// tin hàng — rung 3 driver (§9).
// Regression: testplan/cases/case-SIL-611-bo-band-lich-ghi-chu.md
// Drives THIS worktree's dev server (fe :7177 — :7175 belongs to the
// fix-sil-592 worktree and is preserved; be :3002 shared local dev):
//   BAND-01:  no `#shipment-section-schedule` / heading "Lịch & ghi chú".
//   ORDER-02: .csc-form child order = mode → identity → cargo → notes;
//             notes is the form's LAST band (FCL default).
//   NOTES-03: notes holds exactly 2 textareas with the recipient labels.
//   COPY-04:  the copy-down button lives INSIDE #shipment-section-cargo,
//             appears once a row has a schedule (typed digits into the
//             date-first segments), and a real click fills every empty row.
//   LCL-05:   switching to Hàng lẻ drops the Ghi chú band (SIL-587 law).
//   READONLY: no POST /shipments during the drive; shipments count unchanged
//             before/after (§9 read-only identity proof).
// Artifacts: qa/2026-10-30_sil611_ui-{1440,768,390}.png
//            qa/2026-10-30_sil611_db-state.txt
//            qa/2026-10-30_sil611_ui-driver.log (this log, exit status last)
// Usage: node testplan/qa/scripts/qa-2026-10-30-sil611-bo-band-ghi-chu.mjs
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
const LOG_PATH = path.join(OUT, '2026-10-30_sil611_ui-driver.log');
const DB_PATH = path.join(OUT, '2026-10-30_sil611_db-state.txt');

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

(async () => {
  log('start', { base: BASE, api: API });

  // ── DB state BEFORE (read-only change proof) ─────────────────────────────
  const shipmentsBefore = q('SELECT count(*) FROM shipments;');
  log('db-before', { shipments: shipmentsBefore });

  const postUrls = [];
  let browser;
  try {
    // ── 1. token via API + pre-inject BEFORE any page load (spa-auth) ──────
    const loginRes = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: 'dieuvan', password: 'Abc123' }),
    });
    const loginBody = await loginRes.json().catch(() => ({}));
    const token = loginBody.token ?? loginBody.data?.token ?? loginBody.accessToken;
    if (!token) { fail('login', { status: loginRes.status, body: loginBody }); throw new Error('no token'); }
    ok('login', { status: loginRes.status, role: loginBody.user?.role ?? loginBody.data?.user?.role ?? 'unknown' });

    browser = await puppeteer.launch({
      headless: true,
      executablePath: process.env.QA_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      args: ['--no-sandbox', '--window-size=1440,900'],
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    page.on('pageerror', (err) => fail('pageerror', { message: String(err) }));
    page.on('request', (req) => {
      if (req.method() === 'POST' && /\/api\/shipments\b/.test(new URL(req.url()).pathname)) {
        postUrls.push(req.url());
      }
    });

    await page.evaluateOnNewDocument((t) => {
      localStorage.setItem('token', t);
    }, token);

    // ── 2. open the create form ────────────────────────────────────────────
    await page.goto(`${BASE}/shipments/new`, { waitUntil: 'networkidle2', timeout: 60000 });
    await sleep(1500);
    if (page.url().includes('/login')) { fail('auth-redirect', { url: page.url() }); throw new Error('redirected to login'); }
    ok('page-loaded', { url: page.url() });

    await page.waitForSelector('.csc-form', { timeout: 30000 });

    // BAND-01: the schedule band is gone.
    const scheduleCount = await page.evaluate(() => document.querySelectorAll('#shipment-section-schedule').length);
    const oldHeading = await page.evaluate(() => document.body.textContent.includes('Lịch & ghi chú'));
    if (scheduleCount !== 0 || oldHeading) {
      fail('BAND-01', { scheduleCount, oldHeading });
      throw new Error('schedule band still present');
    }
    ok('BAND-01', { scheduleCount, oldHeading });

    // ORDER-02: mode → identity → cargo → notes; notes is the LAST band.
    const order = await page.evaluate(() => {
      const form = document.querySelector('.csc-form');
      const ids = [...form.children].map((el) => el.id);
      const notes = document.querySelector('#shipment-section-notes');
      return {
        ids,
        notesIsLast: ids[ids.length - 1] === 'shipment-section-notes',
        notesHasCargoBefore: ids.indexOf('shipment-section-cargo') < ids.indexOf('shipment-section-notes'),
      };
    });
    if (!order.notesIsLast || !order.notesHasCargoBefore
      || order.ids[0] !== 'shipment-section-mode' || order.ids[1] !== 'shipment-section-identity') {
      fail('ORDER-02', order);
      throw new Error('unexpected section order');
    }
    ok('ORDER-02', order);

    // NOTES-03: exactly 2 note textareas with the recipient labels.
    const notesProbe = await page.evaluate(() => {
      const notes = document.querySelector('#shipment-section-notes');
      return {
        textareas: notes.querySelectorAll('textarea').length,
        customerLabel: notes.textContent.includes('Ghi chú cho khách hàng'),
        driverLabel: notes.textContent.includes('Ghi chú cho lái xe'),
        heading: notes.querySelector('h2')?.textContent?.trim(),
      };
    });
    if (notesProbe.textareas !== 2 || !notesProbe.customerLabel || !notesProbe.driverLabel || notesProbe.heading !== 'Ghi chú') {
      fail('NOTES-03', notesProbe);
      throw new Error('notes band shape wrong');
    }
    ok('NOTES-03', notesProbe);

    // COPY-04: with 3 rows and no schedule typed yet, no copy button.
    await page.click('button.csc-add-container');
    await sleep(250);
    await page.click('button.csc-add-container');
    await sleep(400);
    const copyBefore = await page.evaluate(() => document.querySelectorAll('button.csc-utility-button--dashed').length);
    // The factory quick-add is also a dashed utility button — count only the
    // copy one by name.
    const copyBtnBefore = await page.evaluate(() => [...document.querySelectorAll('button')].filter((b) => b.textContent.includes('Copy giờ hẹn xuống cont trống')).length);
    if (copyBtnBefore !== 0) { fail('COPY-04-idle', { copyBefore, copyBtnBefore }); throw new Error('copy button visible without a schedule'); }
    ok('COPY-04-idle', { copyBtnBefore });

    // Type a complete appointment into row 1 (date-first segments: dd→mm2→
    // yyyy→hh→mm; digits are FREE — every segment starts empty).
    await page.evaluate(() => {
      const cell = document.querySelector('.csc-container-row .csc-container-cell--appointment');
      cell.click();
    });
    await sleep(300);
    const activeSeg = await page.evaluate(() => document.activeElement?.getAttribute('data-seg') ?? null);
    if (activeSeg !== 'dd') { fail('COPY-04-focus', { activeSeg }); throw new Error('cell click did not land on the date day segment'); }
    ok('COPY-04-focus', { activeSeg });
    await page.keyboard.type('20102026', { delay: 60 });
    await sleep(250);
    const activeAfterDate = await page.evaluate(() => document.activeElement?.getAttribute('data-seg') ?? null);
    if (activeAfterDate !== 'hh') { fail('COPY-04-nam2gio', { activeAfterDate }); throw new Error('completed năm did not hand focus to giờ'); }
    ok('COPY-04-nam2gio', { activeAfterDate });
    await page.keyboard.type('0900', { delay: 60 });
    await sleep(500);

    const typed = await page.evaluate(() => {
      const segV = (row, key) => document
        .querySelectorAll('.csc-container-row')[row]
        ?.querySelector(`input[data-seg="${key}"]`)?.value ?? null;
      return {
        date: [segV(0, 'dd'), segV(0, 'mm2'), segV(0, 'yyyy')].join('/'),
        time: [segV(0, 'hh'), segV(0, 'mm')].join(':'),
      };
    });
    if (typed.date !== '20/10/2026' || typed.time !== '09:00') {
      fail('COPY-04-typed', typed);
      throw new Error('row-1 appointment did not commit');
    }
    ok('COPY-04-typed', typed);

    // The button must now exist INSIDE the cargo section.
    const copyProbe = await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Copy giờ hẹn xuống cont trống'));
      return { exists: Boolean(btn), inCargo: Boolean(btn?.closest('#shipment-section-cargo')) };
    });
    if (!copyProbe.exists || !copyProbe.inCargo) { fail('COPY-04-location', copyProbe); throw new Error('copy button missing or outside cargo'); }
    ok('COPY-04-location', copyProbe);

    // Click it — a real click on the relocated control.
    await page.evaluate(() => {
      [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Copy giờ hẹn xuống cont trống')).click();
    });
    await sleep(600);
    const copied = await page.evaluate(() => {
      const segV = (row, key) => document
        .querySelectorAll('.csc-container-row')[row]
        ?.querySelector(`input[data-seg="${key}"]`)?.value ?? null;
      const read = (row) => ({
        date: [segV(row, 'dd'), segV(row, 'mm2'), segV(row, 'yyyy')].join('/'),
        time: [segV(row, 'hh'), segV(row, 'mm')].join(':'),
      });
      return {
        r1: read(0),
        r2: read(1),
        r3: read(2),
        toast: document.body.textContent.includes('Đã copy ngày giờ đóng trả sang 2 container chưa có lịch'),
      };
    });
    const allFilled = [copied.r1, copied.r2, copied.r3].every((r) => r.date === '20/10/2026' && r.time === '09:00');
    if (!allFilled || !copied.toast) { fail('COPY-04-click', copied); throw new Error('copy-down did not fill every empty row'); }
    ok('COPY-04-click', copied);

    // Screenshot AFTER the click — the rung-3 money shot at 1440 (viewport)
    // plus the full-page capture that shows the Ghi chú band closing the
    // worksheet below the container table.
    await page.screenshot({ path: path.join(OUT, '2026-10-30_sil611_ui-1440.png') });
    // The app scrolls in an INNER scroller (not the body), so fullPage is
    // no taller than the viewport — stretch the viewport instead to show
    // the Ghi chú band closing the worksheet below the container table.
    await page.setViewport({ width: 1440, height: 2200 });
    await sleep(500);
    await page.screenshot({ path: path.join(OUT, '2026-10-30_sil611_ui-1440-full.png'), fullPage: true });
    ok('shot-1440');

    // LCL-05: Hàng lẻ drops the notes band. The typed rows carry mode data,
    // so the app opens the "Chuyển loại hàng?" confirm — accept it (the
    // driver owns the data loss, nothing is persisted).
    await page.evaluate(() => {
      [...document.querySelectorAll('input[type="radio"]')].find((r) => r.value === 'LCL' || r.closest('label')?.textContent.includes('Hàng lẻ')).click();
    });
    await sleep(400);
    const confirmBtn = await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Chuyển và xóa dữ liệu');
      btn?.click();
      return Boolean(btn);
    });
    if (!confirmBtn) { fail('LCL-05-confirm', { confirmBtn }); throw new Error('mode-switch confirm dialog did not appear'); }
    await sleep(500);
    const lclState = await page.evaluate(() => ({
      notes: document.querySelectorAll('#shipment-section-notes').length,
      schedule: document.querySelectorAll('#shipment-section-schedule').length,
      notesLabels: document.body.textContent.includes('Ghi chú cho khách hàng'),
    }));
    if (lclState.notes !== 0 || lclState.schedule !== 0 || lclState.notesLabels) {
      fail('LCL-05', lclState);
      throw new Error('LCL still renders a notes/schedule band');
    }
    ok('LCL-05', lclState);

    // Back to FCL for the remaining viewport sweep.
    await page.evaluate(() => {
      [...document.querySelectorAll('input[type="radio"]')].find((r) => r.value === 'FCL' || r.closest('label')?.textContent.includes('Hàng FCL')).click();
    });
    await sleep(500);

    // Viewport sweep 768 / 390 (drive changed screens at the three widths).
    await page.setViewport({ width: 768, height: 1024 });
    await sleep(600);
    await page.screenshot({ path: path.join(OUT, '2026-10-30_sil611_ui-768.png') });
    ok('shot-768');
    await page.setViewport({ width: 390, height: 844 });
    await sleep(600);
    await page.screenshot({ path: path.join(OUT, '2026-10-30_sil611_ui-390.png') });
    ok('shot-390');

    // READONLY: no lot was created during the drive.
    if (postUrls.length > 0) { fail('READONLY-posts', { postUrls }); throw new Error('unexpected POST /shipments'); }
    const shipmentsAfter = q('SELECT count(*) FROM shipments;');
    if (shipmentsAfter !== shipmentsBefore) {
      fail('READONLY-db', { before: shipmentsBefore, after: shipmentsAfter });
      throw new Error('shipments count changed during a read-only drive');
    }
    ok('READONLY', { posts: postUrls.length, before: shipmentsBefore, after: shipmentsAfter });
    fs.writeFileSync(DB_PATH, [
      `# SIL-611 ui-drive read-only proof (${new Date().toISOString()})`,
      `shipments before: ${shipmentsBefore}`,
      `shipments after:  ${shipmentsAfter}`,
      `POST /api/shipments fired: ${postUrls.length}`,
    ].join('\n') + '\n');
  } catch (err) {
    fail('fatal', { message: String(err) });
  } finally {
    await browser?.close();
  }

  fs.writeFileSync(LOG_PATH, LOG.map((e) => JSON.stringify(e)).join('\n') + '\n');
  log('done', { exitCode });
  process.exit(exitCode);
})();
